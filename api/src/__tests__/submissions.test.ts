import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { FAKE_BANDCAMP_URL, SEARCH_UNAVAILABLE_QUERY } from '../adapters/fakeAdapter.js';
import { startTestDb, type TestDb } from './testDb.js';
import { buildApp as sharedBuildApp, closeSubmissionWindow } from './testHelpers.js';

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

// The shared helper is the single place AppDeps is assembled for tests.
const buildApp = () => sharedBuildApp(testDb.pool);

async function signUp(app: Express, email: string) {
  const res = await request(app).post('/accounts').send({ email, password: 'password123' });
  return { accountId: res.body.accountId as string, token: res.body.token as string };
}

const round1 = {
  theme: 'One-hit wonders',
  submissionDeadline: '2030-01-10T00:00:00.000Z',
  guessingDeadline: '2030-01-17T00:00:00.000Z',
};

async function createLeagueWithPlayer(
  app: Express,
  roundOverrides: Partial<typeof round1> = {},
) {
  const host = await signUp(app, `host-${Date.now()}-${Math.random()}@example.com`);
  const created = await request(app)
    .post('/leagues')
    .set('Authorization', `Bearer ${host.token}`)
    .send({ name: 'Office League', seasonLength: 8, ...round1, ...roundOverrides });
  const roundId = created.body.round.id as string;

  const player = await signUp(app, `player-${Date.now()}-${Math.random()}@example.com`);
  await request(app)
    .post(`/leagues/invite/${created.body.inviteCode}/join`)
    .set('Authorization', `Bearer ${player.token}`);

  return { roundId, player };
}

describe('GET /search', () => {
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

  it('rejects a missing service', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'searcher7@example.com');
    const res = await request(app)
      .get('/search')
      .query({ q: 'never gonna give you up' })
      .set('Authorization', `Bearer ${host.token}`);
    expect(res.status).toBe(400);
  });

  it('searches YouTube Music catalog when service=youtube_music', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'searcher4@example.com');

    const res = await request(app)
      .get('/search')
      .query({ q: 'never gonna give you up', service: 'youtube_music' })
      .set('Authorization', `Bearer ${host.token}`);

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      expect.objectContaining({ title: 'never gonna give you up', service: 'youtube_music' }),
    ]);
  });

  it('surfaces a search-unavailable error instead of crashing when YouTube Music is unreachable', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'searcher5@example.com');

    const res = await request(app)
      .get('/search')
      .query({ q: SEARCH_UNAVAILABLE_QUERY, service: 'youtube_music' })
      .set('Authorization', `Bearer ${host.token}`);

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('search unavailable');
  });

  it('rejects a bandcamp search since bandcamp has no search API', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'searcher6@example.com');

    const res = await request(app)
      .get('/search')
      .query({ q: 'never gonna give you up', service: 'bandcamp' })
      .set('Authorization', `Bearer ${host.token}`);

    expect(res.status).toBe(400);
  });
});

describe('POST /rounds/:roundId/submissions', () => {
  const track = {
    externalId: 'fake-track-99',
    title: 'Never Gonna Give You Up',
    artist: 'Rick Astley',
    service: 'youtube_music',
  };

  it('accepts a player submission without attributing it to them in the response', async () => {
    const { app } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app);

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send(track);

    expect(res.status).toBe(201);
    expect(res.body.submissionId).toBeTruthy();
    expect(res.body.accountId).toBeUndefined();
  });

  it('stores a trimmed comment, clears it on a comment-less resubmit, and rejects an over-long one', async () => {
    const { app } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app);
    const post = (body: object) =>
      request(app).post(`/rounds/${roundId}/submissions`).set('Authorization', `Bearer ${player.token}`).send(body);
    const stored = async () =>
      (await testDb.pool.query('SELECT comment FROM submissions WHERE round_id = $1', [roundId])).rows[0].comment;

    expect((await post({ ...track, comment: '  my fave  ' })).status).toBe(201);
    expect(await stored()).toBe('my fave');
    expect((await post(track)).status).toBe(201);
    expect(await stored()).toBeNull();
    expect((await post({ ...track, comment: 'x'.repeat(501) })).status).toBe(400);
  });

  it('edits only the comment of an existing track', async () => {
    const { app } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app);
    const auth = { Authorization: `Bearer ${player.token}` };
    const patch = (comment: string) =>
      request(app).patch(`/rounds/${roundId}/submissions/mine`).set(auth).send({ comment });
    expect((await patch('hi')).status).toBe(404);
    await request(app).post(`/rounds/${roundId}/submissions`).set(auth).send(track);

    expect((await patch('  hi  ')).status).toBe(204);
    const row = (await testDb.pool.query('SELECT title, comment FROM submissions WHERE round_id = $1', [roundId])).rows[0];
    expect(row).toEqual({ title: track.title, comment: 'hi' });
    expect((await patch('x'.repeat(501))).status).toBe(400);
  });

  it('rejects requests without a session', async () => {
    const { app } = buildApp();
    const { roundId } = await createLeagueWithPlayer(app);

    const res = await request(app).post(`/rounds/${roundId}/submissions`).send(track);
    expect(res.status).toBe(401);
  });

  /** One row per player per round is the invariant; a passing status over two rows is the bug. */
  async function submissionsOf(roundId: string, accountId: string) {
    const res = await testDb.pool.query(
      `SELECT id, service, external_id, title, artist, isrc FROM submissions
       WHERE round_id = $1 AND account_id = $2`,
      [roundId, accountId],
    );
    return res.rows;
  }

  it('replaces a player’s track when they submit again in the same round', async () => {
    const { app } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app);

    const first = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send(track);
    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({
        externalId: 'fake-track-100',
        title: 'Tubthumping',
        artist: 'Chumbawamba',
        service: 'youtube_music',
      });

    expect(res.status).toBe(201);
    expect(await submissionsOf(roundId, player.accountId)).toEqual([
      {
        // Updated in place: guesses.submission_id is ON DELETE CASCADE, so the row must survive.
        id: first.body.submissionId,
        service: 'youtube_music',
        external_id: 'fake-track-100',
        title: 'Tubthumping',
        artist: 'Chumbawamba',
        isrc: null,
      },
    ]);
  });

  it('clears the old isrc when the replacement comes from a service that has none', async () => {
    const { app } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app);

    await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ ...track, isrc: 'GBARL9300135' });
    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ service: 'bandcamp', url: FAKE_BANDCAMP_URL });

    expect(res.status).toBe(201);
    const rows = await submissionsOf(roundId, player.accountId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ service: 'bandcamp', title: 'Fake Bandcamp Song', isrc: null });
  });

  it('rejects a replacement once the submission deadline has passed', async () => {
    const { app } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app);

    await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send(track);
    await closeSubmissionWindow(testDb.pool, roundId);

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ ...track, externalId: 'fake-track-100', title: 'Too Late' });

    expect(res.status).toBe(403);
    expect(await submissionsOf(roundId, player.accountId)).toMatchObject([{ title: track.title }]);
  });

  it('rejects a submission from someone who has not joined the league', async () => {
    const { app } = buildApp();
    const { roundId } = await createLeagueWithPlayer(app);
    const outsider = await signUp(app, 'outsider@example.com');

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send(track);

    expect(res.status).toBe(403);
  });

  it('keeps round N+1 closed to submissions until round N guessing ends, then rolls over', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'rollover-host@example.com');
    const created = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Rollover League', seasonLength: 3, ...round1 });
    const leagueId = created.body.leagueId as string;
    const round1Id = created.body.round.id as string;
    const { rows } = await testDb.pool.query<{ id: string }>(
      'SELECT id FROM rounds WHERE league_id = $1 AND round_number = 2',
      [leagueId],
    );
    const round2Id = rows[0].id;
    const submit = () =>
      request(app).post(`/rounds/${round2Id}/submissions`).set('Authorization', `Bearer ${host.token}`).send(track);

    const early = await submit();
    expect(early.status).toBe(403);
    expect(early.body.error).toContain('not opened');
    const schedule = await testDb.pool.query<{ opens: Date; guessing: Date }>(
      `SELECT r2.submission_opens_at AS opens, r1.guessing_deadline AS guessing
       FROM rounds r1 JOIN rounds r2 ON r2.league_id = r1.league_id AND r2.round_number = 2
       WHERE r1.id = $1`,
      [round1Id],
    );
    expect(schedule.rows[0].opens).toEqual(schedule.rows[0].guessing);

    // Round 1's guessing ends: pull its deadlines, and round 2's opening with them, into the past.
    await testDb.pool.query(
      `UPDATE rounds SET submission_deadline = now() - interval '2 hours', guessing_deadline = now() - interval '1 minute'
       WHERE id = $1`,
      [round1Id],
    );
    await testDb.pool.query("UPDATE rounds SET submission_opens_at = now() - interval '1 minute' WHERE id = $1", [round2Id]);

    const late = await submit();
    expect(late.status).toBe(201);

    const overview = await request(app).get(`/leagues/${leagueId}/overview`).set('Authorization', `Bearer ${host.token}`);
    expect(overview.body.rounds.find((r: { isCurrent: boolean }) => r.isCurrent)).toMatchObject({
      number: 2,
      phase: 'submission',
    });
  });

  it('404s for an unknown round', async () => {
    const { app } = buildApp();
    const { player } = await createLeagueWithPlayer(app);

    const res = await request(app)
      .post('/rounds/00000000-0000-0000-0000-000000000000/submissions')
      .set('Authorization', `Bearer ${player.token}`)
      .send(track);

    expect(res.status).toBe(404);
  });

  it('rejects a missing title or artist', async () => {
    const { app } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app);

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ externalId: 'fake-track-99' });

    expect(res.status).toBe(400);
  });

  it('rejects a submission after the round submission deadline has passed', async () => {
    const { app } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app, {
      submissionDeadline: '2020-01-10T00:00:00.000Z',
    });

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send(track);

    expect(res.status).toBe(403);
  });

  it('rejects a track that does not match the catalog', async () => {
    const { app } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app);

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ ...track, title: 'NO_MATCH' });

    expect(res.status).toBe(400);
  });

  it('a player chooses YouTube Music for this submission', async () => {
    const { app } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app);

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ ...track, service: 'youtube_music' });

    expect(res.status).toBe(201);
    expect(res.body.submissionId).toBeTruthy();

    const row = await testDb.pool.query('SELECT service FROM submissions WHERE id = $1', [res.body.submissionId]);
    expect(row.rows[0].service).toBe('youtube_music');
  });

  it('a player submits a bandcamp track by pasting its URL', async () => {
    const { app } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app);

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ service: 'bandcamp', url: FAKE_BANDCAMP_URL });

    expect(res.status).toBe(201);
    expect(res.body.submissionId).toBeTruthy();

    const row = await testDb.pool.query('SELECT service, title, artist FROM submissions WHERE id = $1', [
      res.body.submissionId,
    ]);
    expect(row.rows[0]).toMatchObject({
      service: 'bandcamp',
      title: 'Fake Bandcamp Song',
      artist: 'Fake Bandcamp Artist',
    });
  });

  it('rejects a bandcamp submission missing a url', async () => {
    const { app } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app);

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ service: 'bandcamp' });

    expect(res.status).toBe(400);
  });

  it('rejects a bandcamp submission whose url cannot be resolved', async () => {
    const { app } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app);

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ service: 'bandcamp', url: 'https://notbandcamp.example.com/track/1' });

    expect(res.status).toBe(400);
  });

  it('accepts a bandcamp track the device resolved itself, without a url', async () => {
    const { app } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app);

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ service: 'bandcamp', externalId: 'track=123', title: 'Song', artist: 'Band', artId: 456 });

    expect(res.status).toBe(201);
    const row = await testDb.pool.query('SELECT external_id, title, art_id FROM submissions WHERE id = $1', [res.body.submissionId]);
    expect(row.rows[0]).toMatchObject({ external_id: 'track=123', title: 'Song', art_id: '456' });
  });

  it('rejects device-resolved bandcamp metadata with a malformed externalId', async () => {
    const { app } = buildApp();
    const { roundId, player } = await createLeagueWithPlayer(app);

    const res = await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ service: 'bandcamp', externalId: 'https://evil.example', title: 'Song', artist: 'Band' });

    expect(res.status).toBe(400);
  });
});
