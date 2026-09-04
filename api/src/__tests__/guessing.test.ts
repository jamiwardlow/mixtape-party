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

async function createLeagueWithPlayers(
  app: Express,
  spotifyAdapter: FakeMusicServiceAdapter,
  playerCount: number,
  roundOverrides: Partial<typeof round1> = {},
) {
  const host = await signUp(app, `host-${Date.now()}-${Math.random()}@example.com`);
  const created = await request(app)
    .post('/leagues')
    .set('Authorization', `Bearer ${host.token}`)
    .send({ name: 'Office League', seasonLength: 8, ...round1, ...roundOverrides });
  const roundId = created.body.round.id as string;
  const inviteCode = created.body.inviteCode as string;

  const members = [host];
  for (let i = 1; i < playerCount; i++) {
    const player = await signUp(app, `player-${i}-${Date.now()}-${Math.random()}@example.com`);
    await linkFakeSpotify(app, spotifyAdapter, player.token);
    await request(app).post(`/leagues/invite/${inviteCode}/join`).set('Authorization', `Bearer ${player.token}`);
    members.push(player);
  }

  const submissions: Array<{ accountId: string; submissionId: string }> = [];
  for (const member of members) {
    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ externalId: `track-${member.accountId}`, title: `Song by ${member.accountId}`, artist: 'Artist' });
    submissions.push({ accountId: member.accountId, submissionId: res.body.submissionId });
  }

  return { roundId, leagueId: created.body.leagueId as string, members, submissions };
}

async function closeSubmissionWindow(roundId: string) {
  await testDb.pool.query("UPDATE rounds SET submission_deadline = '2000-01-01T00:00:00Z' WHERE id = $1", [roundId]);
}

describe('GET /rounds/:roundId/guessing', () => {
  it('lists every other submitted track, anonymized and tagged with service', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, spotifyAdapter, 4);
    await closeSubmissionWindow(roundId);

    const res = await request(app)
      .get(`/rounds/${roundId}/guessing`)
      .set('Authorization', `Bearer ${members[0].token}`);

    expect(res.status).toBe(200);
    expect(res.body.tracks).toHaveLength(3);
    for (const track of res.body.tracks) {
      expect(track.service).toBe('spotify');
      expect(typeof track.title).toBe('string');
      expect(track.playback.deepLink).toBeTruthy();
      expect(track.accountId).toBeUndefined();
    }
  });

  it('includes the other league members as guessable players', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, spotifyAdapter, 4);
    await closeSubmissionWindow(roundId);

    const res = await request(app)
      .get(`/rounds/${roundId}/guessing`)
      .set('Authorization', `Bearer ${members[0].token}`);

    expect(res.body.players).toHaveLength(3);
    expect(res.body.players.map((p: { accountId: string }) => p.accountId)).not.toContain(members[0].accountId);
  });

  it('never includes the requester own submission', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, members, submissions } = await createLeagueWithPlayers(app, spotifyAdapter, 4);
    await closeSubmissionWindow(roundId);
    const ownSubmissionId = submissions.find((s) => s.accountId === members[0].accountId)?.submissionId;

    const res = await request(app)
      .get(`/rounds/${roundId}/guessing`)
      .set('Authorization', `Bearer ${members[0].token}`);

    expect(res.body.tracks.map((t: { submissionId: string }) => t.submissionId)).not.toContain(ownSubmissionId);
  });

  it('rejects requests without a session', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId } = await createLeagueWithPlayers(app, spotifyAdapter, 4);
    await closeSubmissionWindow(roundId);

    const res = await request(app).get(`/rounds/${roundId}/guessing`);
    expect(res.status).toBe(401);
  });

  it('404s for an unknown round', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { members } = await createLeagueWithPlayers(app, spotifyAdapter, 4);

    const res = await request(app)
      .get('/rounds/00000000-0000-0000-0000-000000000000/guessing')
      .set('Authorization', `Bearer ${members[0].token}`);
    expect(res.status).toBe(404);
  });

  it('rejects a requester who has not joined the league', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId } = await createLeagueWithPlayers(app, spotifyAdapter, 4);
    await closeSubmissionWindow(roundId);
    const outsider = await signUp(app, 'outsider@example.com');

    const res = await request(app)
      .get(`/rounds/${roundId}/guessing`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(res.status).toBe(403);
  });

  it('rejects guessing before the submission window has closed', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, spotifyAdapter, 4);

    const res = await request(app)
      .get(`/rounds/${roundId}/guessing`)
      .set('Authorization', `Bearer ${members[0].token}`);
    expect(res.status).toBe(403);
  });

  it('rejects guessing when the round has fewer than 4 players', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, spotifyAdapter, 3);
    await closeSubmissionWindow(roundId);

    const res = await request(app)
      .get(`/rounds/${roundId}/guessing`)
      .set('Authorization', `Bearer ${members[0].token}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /rounds/:roundId/submissions/:submissionId/guesses', () => {
  it('records a guess', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, members, submissions } = await createLeagueWithPlayers(app, spotifyAdapter, 4);
    await closeSubmissionWindow(roundId);
    const target = submissions.find((s) => s.accountId !== members[0].accountId)!;

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions/${target.submissionId}/guesses`)
      .set('Authorization', `Bearer ${members[0].token}`)
      .send({ guessedAccountId: members[1].accountId });

    expect(res.status).toBe(201);
    expect(res.body.guessId).toBeTruthy();
  });

  it('rejects a guesser guessing their own submission', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, members, submissions } = await createLeagueWithPlayers(app, spotifyAdapter, 4);
    await closeSubmissionWindow(roundId);
    const own = submissions.find((s) => s.accountId === members[0].accountId)!;

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions/${own.submissionId}/guesses`)
      .set('Authorization', `Bearer ${members[0].token}`)
      .send({ guessedAccountId: members[1].accountId });

    expect(res.status).toBe(403);
  });

  it('rejects a second guess on the same track by the same guesser', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, members, submissions } = await createLeagueWithPlayers(app, spotifyAdapter, 4);
    await closeSubmissionWindow(roundId);
    const target = submissions.find((s) => s.accountId !== members[0].accountId)!;

    await request(app)
      .post(`/rounds/${roundId}/submissions/${target.submissionId}/guesses`)
      .set('Authorization', `Bearer ${members[0].token}`)
      .send({ guessedAccountId: members[1].accountId });
    const res = await request(app)
      .post(`/rounds/${roundId}/submissions/${target.submissionId}/guesses`)
      .set('Authorization', `Bearer ${members[0].token}`)
      .send({ guessedAccountId: members[2].accountId });

    expect(res.status).toBe(409);
  });

  it('rejects requests without a session', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, submissions } = await createLeagueWithPlayers(app, spotifyAdapter, 4);
    await closeSubmissionWindow(roundId);

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions/${submissions[0].submissionId}/guesses`)
      .send({ guessedAccountId: submissions[1].accountId });
    expect(res.status).toBe(401);
  });

  it('404s for an unknown submission', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, spotifyAdapter, 4);
    await closeSubmissionWindow(roundId);

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions/00000000-0000-0000-0000-000000000000/guesses`)
      .set('Authorization', `Bearer ${members[0].token}`)
      .send({ guessedAccountId: members[1].accountId });
    expect(res.status).toBe(404);
  });

  it('rejects a missing guessedAccountId', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, members, submissions } = await createLeagueWithPlayers(app, spotifyAdapter, 4);
    await closeSubmissionWindow(roundId);
    const target = submissions.find((s) => s.accountId !== members[0].accountId)!;

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions/${target.submissionId}/guesses`)
      .set('Authorization', `Bearer ${members[0].token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects a guessedAccountId that is not a member of the league', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, members, submissions } = await createLeagueWithPlayers(app, spotifyAdapter, 4);
    await closeSubmissionWindow(roundId);
    const target = submissions.find((s) => s.accountId !== members[0].accountId)!;
    const outsider = await signUp(app, 'outsider2@example.com');

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions/${target.submissionId}/guesses`)
      .set('Authorization', `Bearer ${members[0].token}`)
      .send({ guessedAccountId: outsider.accountId });
    expect(res.status).toBe(400);
  });

  it('rejects guessing when the round has fewer than 4 players', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { roundId, members, submissions } = await createLeagueWithPlayers(app, spotifyAdapter, 3);
    await closeSubmissionWindow(roundId);
    const target = submissions.find((s) => s.accountId !== members[0].accountId)!;

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions/${target.submissionId}/guesses`)
      .set('Authorization', `Bearer ${members[0].token}`)
      .send({ guessedAccountId: members[1].accountId });
    expect(res.status).toBe(403);
  });
});
