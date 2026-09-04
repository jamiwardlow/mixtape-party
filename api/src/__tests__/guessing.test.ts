import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startTestDb, type TestDb } from './testDb.js';
import {
  buildApp as buildTestApp,
  closeSubmissionWindow as closeSubmissionWindowFor,
  createLeagueWithPlayers,
  linkFakeSpotify,
  signUp,
} from './testHelpers.js';
import { FAKE_BANDCAMP_URL } from '../adapters/fakeAdapter.js';

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
  return buildTestApp(testDb.pool);
}

async function closeSubmissionWindow(roundId: string) {
  await closeSubmissionWindowFor(testDb.pool, roundId);
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

  it('flags a bandcamp track as excluded from export and still resolves its playback handle', async () => {
    const { app, spotifyAdapter } = buildApp();
    const host = await signUp(app, `host-${Date.now()}@example.com`);
    const created = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        name: 'Bandcamp League',
        seasonLength: 8,
        theme: 'One-hit wonders',
        submissionDeadline: '2030-01-10T00:00:00.000Z',
        guessingDeadline: '2030-01-17T00:00:00.000Z',
      });
    const roundId = created.body.round.id as string;
    const players = [];
    for (let i = 0; i < 3; i++) {
      const player = await signUp(app, `bcplayer-${i}-${Date.now()}@example.com`);
      await linkFakeSpotify(app, spotifyAdapter, player.token);
      await request(app).post(`/leagues/invite/${created.body.inviteCode}/join`).set('Authorization', `Bearer ${player.token}`);
      players.push(player);
    }
    await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ service: 'bandcamp', url: FAKE_BANDCAMP_URL });
    for (const player of players) {
      await request(app)
        .post(`/rounds/${roundId}/submissions`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ externalId: `track-${player.accountId}`, title: `Song by ${player.accountId}`, artist: 'Artist' });
    }
    await closeSubmissionWindow(roundId);

    const res = await request(app)
      .get(`/rounds/${roundId}/guessing`)
      .set('Authorization', `Bearer ${players[0].token}`);

    expect(res.status).toBe(200);
    const bandcampTrack = res.body.tracks.find((t: { service: string }) => t.service === 'bandcamp');
    expect(bandcampTrack.excludedFromExport).toBe(true);
    expect(bandcampTrack.playback.deepLink).toBeTruthy();
    const spotifyTrack = res.body.tracks.find((t: { service: string }) => t.service === 'spotify');
    expect(spotifyTrack.excludedFromExport).toBe(false);
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
