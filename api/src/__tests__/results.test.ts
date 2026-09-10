import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { startTestDb, type TestDb } from './testDb.js';
import {
  buildApp as buildTestApp,
  closeGuessingWindow as closeGuessingWindowFor,
  closeSubmissionWindow as closeSubmissionWindowFor,
  createLeagueWithPlayers,
  signUp,
} from './testHelpers.js';

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

async function closeGuessingWindow(roundId: string) {
  await closeGuessingWindowFor(testDb.pool, roundId);
}

async function guess(app: Express, roundId: string, submissionId: string, token: string, guessedAccountId: string) {
  return request(app)
    .post(`/rounds/${roundId}/submissions/${submissionId}/guesses`)
    .set('Authorization', `Bearer ${token}`)
    .send({ guessedAccountId });
}

describe('GET /rounds/:roundId/results', () => {
  it('404s for an unknown round', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { members } = await createLeagueWithPlayers(app, appleMusicAdapter, 4);

    const res = await request(app)
      .get('/rounds/00000000-0000-0000-0000-000000000000/results')
      .set('Authorization', `Bearer ${members[0].token}`);
    expect(res.status).toBe(404);
  });

  it('rejects requests without a session', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { roundId } = await createLeagueWithPlayers(app, appleMusicAdapter, 4);
    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);

    const res = await request(app).get(`/rounds/${roundId}/results`);
    expect(res.status).toBe(401);
  });

  it('rejects a requester who has not joined the league', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { roundId } = await createLeagueWithPlayers(app, appleMusicAdapter, 4);
    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);
    const outsider = await signUp(app, 'outsider@example.com');

    const res = await request(app)
      .get(`/rounds/${roundId}/results`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(res.status).toBe(403);
  });

  it('rejects results before the guessing deadline passes', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, appleMusicAdapter, 4);
    await closeSubmissionWindow(roundId);

    const res = await request(app)
      .get(`/rounds/${roundId}/results`)
      .set('Authorization', `Bearer ${members[0].token}`);
    expect(res.status).toBe(403);
  });

  it('reveals every track with its true submitter and who guessed correctly', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { roundId, members, submissions } = await createLeagueWithPlayers(app, appleMusicAdapter, 4);
    await closeSubmissionWindow(roundId);

    const target = submissions.find((s) => s.accountId === members[1].accountId)!;
    await guess(app, roundId, target.submissionId, members[0].token, members[1].accountId);
    await guess(app, roundId, target.submissionId, members[2].token, members[3].accountId);
    await closeGuessingWindow(roundId);

    const res = await request(app)
      .get(`/rounds/${roundId}/results`)
      .set('Authorization', `Bearer ${members[0].token}`);

    expect(res.status).toBe(200);
    expect(res.body.tracks).toHaveLength(4);
    const revealed = res.body.tracks.find((t: { submissionId: string }) => t.submissionId === target.submissionId);
    expect(revealed.submitter.accountId).toBe(members[1].accountId);
    expect(revealed.correctGuessers.map((g: { accountId: string }) => g.accountId)).toEqual([members[0].accountId]);
  });

  it('scores guessers per correct guess and does not score submitters for being guessed correctly', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { roundId, members, submissions } = await createLeagueWithPlayers(app, appleMusicAdapter, 4);
    await closeSubmissionWindow(roundId);

    // members[0] correctly guesses members[1]'s and members[2]'s tracks.
    const track1 = submissions.find((s) => s.accountId === members[1].accountId)!;
    const track2 = submissions.find((s) => s.accountId === members[2].accountId)!;
    await guess(app, roundId, track1.submissionId, members[0].token, members[1].accountId);
    await guess(app, roundId, track2.submissionId, members[0].token, members[2].accountId);
    await closeGuessingWindow(roundId);

    const res = await request(app)
      .get(`/rounds/${roundId}/results`)
      .set('Authorization', `Bearer ${members[0].token}`);

    const scoreFor = (accountId: string) =>
      res.body.scores.find((s: { accountId: string }) => s.accountId === accountId).score;
    expect(scoreFor(members[0].accountId)).toBe(2);
    expect(scoreFor(members[1].accountId)).toBe(0);
    expect(scoreFor(members[2].accountId)).toBe(0);
  });

  it('shares the win on exact score ties with no tiebreaker', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { roundId, members, submissions } = await createLeagueWithPlayers(app, appleMusicAdapter, 4);
    await closeSubmissionWindow(roundId);

    const track2 = submissions.find((s) => s.accountId === members[2].accountId)!;
    const track3 = submissions.find((s) => s.accountId === members[3].accountId)!;
    await guess(app, roundId, track2.submissionId, members[0].token, members[2].accountId);
    await guess(app, roundId, track3.submissionId, members[1].token, members[3].accountId);
    await closeGuessingWindow(roundId);

    const res = await request(app)
      .get(`/rounds/${roundId}/results`)
      .set('Authorization', `Bearer ${members[0].token}`);

    expect(res.body.winners.map((w: { accountId: string }) => w.accountId).sort()).toEqual(
      [members[0].accountId, members[1].accountId].sort(),
    );
  });

  it('declares no winners when nobody guessed correctly', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, appleMusicAdapter, 4);
    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);

    const res = await request(app)
      .get(`/rounds/${roundId}/results`)
      .set('Authorization', `Bearer ${members[0].token}`);

    expect(res.status).toBe(200);
    expect(res.body.scores.every((s: { score: number }) => s.score === 0)).toBe(true);
    expect(res.body.winners).toEqual([]);
  });
});

describe('GET /leagues/:leagueId/standings', () => {
  it('404s for an unknown league', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { members } = await createLeagueWithPlayers(app, appleMusicAdapter, 4, { seasonLength: 1 });

    const res = await request(app)
      .get('/leagues/00000000-0000-0000-0000-000000000000/standings')
      .set('Authorization', `Bearer ${members[0].token}`);
    expect(res.status).toBe(404);
  });

  it('rejects a requester who has not joined the league', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { leagueId, roundId } = await createLeagueWithPlayers(app, appleMusicAdapter, 4, { seasonLength: 1 });
    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);
    const outsider = await signUp(app, 'standings-outsider@example.com');

    const res = await request(app)
      .get(`/leagues/${leagueId}/standings`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(res.status).toBe(403);
  });

  it('rejects standings before the season concludes', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { leagueId, roundId, members } = await createLeagueWithPlayers(app, appleMusicAdapter, 4, {
      seasonLength: 1,
    });
    await closeSubmissionWindow(roundId);

    const res = await request(app)
      .get(`/leagues/${leagueId}/standings`)
      .set('Authorization', `Bearer ${members[0].token}`);
    expect(res.status).toBe(403);
  });

  it('aggregates correct guesses across the season once concluded', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { leagueId, roundId, members, submissions } = await createLeagueWithPlayers(app, appleMusicAdapter, 4, {
      seasonLength: 1,
    });
    await closeSubmissionWindow(roundId);

    const track1 = submissions.find((s) => s.accountId === members[1].accountId)!;
    await guess(app, roundId, track1.submissionId, members[0].token, members[1].accountId);
    await closeGuessingWindow(roundId);

    const res = await request(app)
      .get(`/leagues/${leagueId}/standings`)
      .set('Authorization', `Bearer ${members[0].token}`);

    expect(res.status).toBe(200);
    const scoreFor = (accountId: string) =>
      res.body.scores.find((s: { accountId: string }) => s.accountId === accountId).score;
    expect(scoreFor(members[0].accountId)).toBe(1);
    expect(res.body.winners.map((w: { accountId: string }) => w.accountId)).toEqual([members[0].accountId]);
  });
});
