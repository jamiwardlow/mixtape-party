import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { FakeMusicServiceAdapter } from '../adapters/fakeAdapter.js';
import { startTestDb, type TestDb } from './testDb.js';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, 60_000);

afterEach(async () => {
  await testDb.reset();
});

afterAll(async () => {
  await testDb.teardown();
});

function buildApp() {
  const spotifyAdapter = new FakeMusicServiceAdapter();
  const app = createApp({ pool: testDb.pool, sessionSecret: 'test-secret', spotifyAdapter });
  return { app, spotifyAdapter };
}

async function signUp(app: Express, email: string) {
  const res = await request(app).post('/accounts').send({ email, password: 'password123' });
  return { accountId: res.body.accountId as string, token: res.body.token as string };
}

async function linkFakeSpotify(app: Express, spotifyAdapter: FakeMusicServiceAdapter, token: string) {
  const authorize = await request(app)
    .get('/auth/spotify/authorize-url')
    .query({ redirectUri: 'mixtapeparty://spotify-callback' })
    .set('Authorization', `Bearer ${token}`);
  const code = `code-${token}`;
  spotifyAdapter.validAuthCodes.set(code, { serviceUserId: `spotify-${token}` });
  await request(app)
    .post('/auth/spotify/callback')
    .set('Authorization', `Bearer ${token}`)
    .send({ code, state: authorize.body.state });
}

const round1 = {
  theme: 'One-hit wonders',
  submissionDeadline: '2030-01-10T00:00:00.000Z',
  guessingDeadline: '2030-01-17T00:00:00.000Z',
};

async function createLeagueWithPlayer(
  app: Express,
  spotifyAdapter: FakeMusicServiceAdapter,
  roundOverrides: Partial<typeof round1> = {},
) {
  const host = await signUp(app, `host-${Date.now()}-${Math.random()}@example.com`);
  const created = await request(app)
    .post('/leagues')
    .set('Authorization', `Bearer ${host.token}`)
    .send({ name: 'Office League', seasonLength: 8, ...round1, ...roundOverrides });
  const roundId = created.body.round.id as string;

  const player = await signUp(app, `player-${Date.now()}-${Math.random()}@example.com`);
  await linkFakeSpotify(app, spotifyAdapter, player.token);
  await request(app)
    .post(`/leagues/invite/${created.body.inviteCode}/join`)
    .set('Authorization', `Bearer ${player.token}`);

  return { roundId, player };
}

describe('GET /search', () => {
  it('returns catalog results shaped as tracks', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'searcher@example.com');

    const res = await request(app)
      .get('/search')
      .query({ q: 'never gonna give you up' })
      .set('Authorization', `Bearer ${host.token}`);

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      expect.objectContaining({ title: 'never gonna give you up', service: 'spotify' }),
    ]);
  });

  it('rejects requests without a session', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/search').query({ q: 'test' });
    expect(res.status).toBe(401);
  });

  it('rejects a missing query', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'searcher2@example.com');
    const res = await request(app).get('/search').set('Authorization', `Bearer ${host.token}`);
    expect(res.status).toBe(400);
  });
});

describe('POST /rounds/:roundId/submissions', () => {
  const track = { externalId: 'fake-track-99', title: 'Never Gonna Give You Up', artist: 'Rick Astley' };

  it('accepts a player submission without attributing it to them in the response', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app, spotifyAdapter);

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send(track);

    expect(res.status).toBe(201);
    expect(res.body.submissionId).toBeTruthy();
    expect(res.body.accountId).toBeUndefined();
  });

  it('rejects requests without a session', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId } = await createLeagueWithPlayer(app, spotifyAdapter);

    const res = await request(app).post(`/rounds/${roundId}/submissions`).send(track);
    expect(res.status).toBe(401);
  });

  it('rejects a second submission by the same player in the same round', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app, spotifyAdapter);

    await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send(track);
    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ ...track, externalId: 'fake-track-100' });

    expect(res.status).toBe(409);
  });

  it('rejects a submission from someone who has not joined the league', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId } = await createLeagueWithPlayer(app, spotifyAdapter);
    const outsider = await signUp(app, 'outsider@example.com');

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send(track);

    expect(res.status).toBe(403);
  });

  it('404s for an unknown round', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { player } = await createLeagueWithPlayer(app, spotifyAdapter);

    const res = await request(app)
      .post('/rounds/00000000-0000-0000-0000-000000000000/submissions')
      .set('Authorization', `Bearer ${player.token}`)
      .send(track);

    expect(res.status).toBe(404);
  });

  it('rejects a missing title or artist', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app, spotifyAdapter);

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ externalId: 'fake-track-99' });

    expect(res.status).toBe(400);
  });

  it('rejects a submission after the round submission deadline has passed', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app, spotifyAdapter, {
      submissionDeadline: '2020-01-10T00:00:00.000Z',
    });

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send(track);

    expect(res.status).toBe(403);
  });

  it('rejects a track that does not match Spotify catalog', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app, spotifyAdapter);

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ ...track, title: 'NO_MATCH' });

    expect(res.status).toBe(400);
  });
});
