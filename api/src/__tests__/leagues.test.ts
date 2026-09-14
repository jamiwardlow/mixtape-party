import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { startTestDb, type TestDb } from './testDb.js';
import {
  buildApp as sharedBuildApp,
  closeGuessingWindow as closeGuessingWindowFor,
  closeSubmissionWindow,
  markRemindersSent,
  round1,
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

// The shared helper is the single place AppDeps is assembled for tests.
const buildApp = () => sharedBuildApp(testDb.pool);

async function closeGuessingWindow(roundId: string) {
  await closeGuessingWindowFor(testDb.pool, roundId);
}

/** Every round of a league, oldest first -- the schedule POST /leagues derived. */
async function scheduleOf(leagueId: string) {
  const res = await testDb.pool.query<{
    id: string;
    round_number: number;
    theme: string | null;
    submission_opens_at: Date;
    submission_deadline: Date;
    guessing_deadline: Date;
    submission_reminder_sent_at: Date | null;
    guessing_reminder_sent_at: Date | null;
  }>(
    `SELECT id, round_number, theme, submission_opens_at, submission_deadline, guessing_deadline,
            submission_reminder_sent_at, guessing_reminder_sent_at
     FROM rounds WHERE league_id = $1 ORDER BY round_number`,
    [leagueId],
  );
  return res.rows;
}

/** A host plus the whole pre-created season (#74), oldest round first. */
async function createSeason(app: Express, email: string, seasonLength = 4) {
  const host = await signUp(app, email);
  const created = await request(app)
    .post('/leagues')
    .set('Authorization', `Bearer ${host.token}`)
    .send({ name: 'Office League', seasonLength, ...round1 });
  const leagueId = created.body.leagueId as string;
  return { host, leagueId, inviteCode: created.body.inviteCode as string, rounds: await scheduleOf(leagueId) };
}

describe('POST /leagues', () => {
  it('creates a league with its first round and an invite code in one call', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'host@example.com');

    const res = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Office League', seasonLength: 8, ...round1 });

    expect(res.status).toBe(201);
    expect(res.body.leagueId).toBeTruthy();
    expect(res.body.inviteCode).toBeTruthy();
    expect(res.body.round).toMatchObject({ number: 1, theme: round1.theme });
  });

  it('rejects requests without a session', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/leagues').send({ name: 'Office League', seasonLength: 8, ...round1 });
    expect(res.status).toBe(401);
  });

  it('rejects a missing name or season length', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'host2@example.com');

    const res = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ seasonLength: 8, ...round1 });

    expect(res.status).toBe(400);
  });

  it('rejects a guessing deadline that is not after the submission deadline', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'host3@example.com');

    const res = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        name: 'Office League',
        seasonLength: 8,
        theme: round1.theme,
        submissionDeadline: '2030-01-17T00:00:00.000Z',
        guessingDeadline: '2030-01-10T00:00:00.000Z',
      });

    expect(res.status).toBe(400);
  });

  it('rejects a season longer than the cap, now that seasonLength is a row count', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'host-long-season@example.com');

    const res = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Forever League', seasonLength: 1_000_000, ...round1 });

    expect(res.status).toBe(400);
    expect((await testDb.pool.query('SELECT 1 FROM rounds')).rowCount).toBe(0);
  });

  it('schedules the whole season back-to-back from round 1', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'host-season@example.com');

    const created = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Office League', seasonLength: 4, ...round1 });

    const rounds = await scheduleOf(created.body.leagueId);
    expect(rounds.map((r) => r.round_number)).toEqual([1, 2, 3, 4]);

    const window = Date.parse(round1.guessingDeadline) - Date.parse(round1.submissionDeadline);
    for (const round of rounds) {
      expect(round.guessing_deadline.getTime() - round.submission_deadline.getTime()).toBe(window);
    }
    // Round 1 takes submissions from the moment the league exists; every round after it takes
    // them while the previous round is being guessed, so they all get the same window.
    expect(rounds[0].submission_opens_at.getTime()).toBeLessThanOrEqual(Date.now());
    for (const round of rounds.slice(1)) {
      expect(round.submission_deadline.getTime() - round.submission_opens_at.getTime()).toBe(window);
    }

    expect(rounds[0].submission_deadline).toEqual(new Date(round1.submissionDeadline));
    expect(rounds[0].guessing_deadline).toEqual(new Date(round1.guessingDeadline));
    expect(rounds[2].submission_deadline).toEqual(rounds[1].guessing_deadline);
    expect(rounds[3].submission_deadline).toEqual(rounds[2].guessing_deadline);
  });

  it('leaves rounds 2..N unnamed, keeping the theme the host submitted on round 1', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'host-themes@example.com');

    const created = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Office League', seasonLength: 4, ...round1 });

    expect((await scheduleOf(created.body.leagueId)).map((r) => r.theme)).toEqual([
      round1.theme,
      null,
      null,
      null,
    ]);
  });
});

describe('GET /leagues/invite/:code', () => {
  it('shows a preview without requiring auth', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'host4@example.com');
    const created = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Office League', seasonLength: 8, ...round1 });

    const res = await request(app).get(`/leagues/invite/${created.body.inviteCode}`);

    expect(res.status).toBe(200);
    expect(res.body.league.name).toBe('Office League');
    expect(res.body.currentRound).toMatchObject({ number: 1, theme: round1.theme });
    expect(res.body.playerCount).toBe(1);
  });

  it('404s for an unknown invite code', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/leagues/invite/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('POST /leagues/invite/:code/join', () => {
  async function createLeague(app: Express, host: { token: string }) {
    const created = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Office League', seasonLength: 8, ...round1 });
    return created.body.inviteCode as string;
  }

  it('rejects requests without a session', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'host5@example.com');
    const inviteCode = await createLeague(app, host);

    const res = await request(app).post(`/leagues/invite/${inviteCode}/join`);
    expect(res.status).toBe(401);
  });

  // A linked service is export credential storage, not a precondition -- and since the linking
  // screen was deleted, requiring one here locked every invitee out of every league.
  it('joins with no linked music service', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'host6@example.com');
    const inviteCode = await createLeague(app, host);
    const player = await signUp(app, 'player@example.com');

    const res = await request(app)
      .post(`/leagues/invite/${inviteCode}/join`)
      .set('Authorization', `Bearer ${player.token}`);

    expect(res.status).toBe(200);

    const preview = await request(app).get(`/leagues/invite/${inviteCode}`);
    expect(preview.body.playerCount).toBe(2);
  });

  it('joins immediately, with no host approval step', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'host7@example.com');
    const inviteCode = await createLeague(app, host);
    const player = await signUp(app, 'player2@example.com');

    const res = await request(app)
      .post(`/leagues/invite/${inviteCode}/join`)
      .set('Authorization', `Bearer ${player.token}`);

    expect(res.status).toBe(200);
    expect(res.body.leagueId).toBeTruthy();

    const preview = await request(app).get(`/leagues/invite/${inviteCode}`);
    expect(preview.body.playerCount).toBe(2);
  });

  it('is idempotent when the same player joins twice', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'host8@example.com');
    const inviteCode = await createLeague(app, host);
    const player = await signUp(app, 'player3@example.com');

    await request(app).post(`/leagues/invite/${inviteCode}/join`).set('Authorization', `Bearer ${player.token}`);
    await request(app).post(`/leagues/invite/${inviteCode}/join`).set('Authorization', `Bearer ${player.token}`);

    const preview = await request(app).get(`/leagues/invite/${inviteCode}`);
    expect(preview.body.playerCount).toBe(2);
  });

  it('404s for an unknown invite code', async () => {
    const { app } = buildApp();
    const player = await signUp(app, 'player4@example.com');

    const res = await request(app)
      .post('/leagues/invite/does-not-exist/join')
      .set('Authorization', `Bearer ${player.token}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /leagues/mine', () => {
  it('rejects requests without a session', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/leagues/mine');
    expect(res.status).toBe(401);
  });

  it('lists the caller\'s leagues with the current round phase', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'mine-host@example.com');
    await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        name: 'Office League',
        seasonLength: 8,
        theme: round1.theme,
        submissionDeadline: '2030-01-10T00:00:00.000Z',
        guessingDeadline: '2030-01-17T00:00:00.000Z',
      });

    const res = await request(app).get('/leagues/mine').set('Authorization', `Bearer ${host.token}`);

    expect(res.status).toBe(200);
    expect(res.body.leagues).toHaveLength(1);
    expect(res.body.leagues[0]).toMatchObject({
      name: 'Office League',
      round: { number: 1, theme: round1.theme, phase: 'submission' },
    });
  });

  it('reports guessing and results phases once their deadlines pass', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'mine-host2@example.com');
    const created = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        name: 'Guessing League',
        seasonLength: 1,
        theme: round1.theme,
        submissionDeadline: '2000-01-01T00:00:00.000Z',
        guessingDeadline: '2030-01-17T00:00:00.000Z',
      });

    const guessingRes = await request(app).get('/leagues/mine').set('Authorization', `Bearer ${host.token}`);
    expect(guessingRes.body.leagues[0].round.phase).toBe('guessing');

    // A one-round season has nothing to move on to, so the last round stays current once revealed.
    await closeGuessingWindow(created.body.round.id);
    const resultsRes = await request(app).get('/leagues/mine').set('Authorization', `Bearer ${host.token}`);
    expect(resultsRes.body.leagues[0].round.phase).toBe('results');
  });

  it('stays on round 1 while it is open, even though the whole season already exists', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'mine-host-round1@example.com');
    const created = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Office League', seasonLength: 8, ...round1 });

    const res = await request(app).get('/leagues/mine').set('Authorization', `Bearer ${host.token}`);

    expect(res.body.leagues[0].round).toMatchObject({
      id: created.body.round.id,
      number: 1,
      theme: round1.theme,
      phase: 'submission',
    });
  });

  it('moves on to round 2 once round 1 is revealed', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'mine-host-round2@example.com');
    const created = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Office League', seasonLength: 8, ...round1 });

    await closeGuessingWindow(created.body.round.id);
    const res = await request(app).get('/leagues/mine').set('Authorization', `Bearer ${host.token}`);

    expect(res.body.leagues[0].round).toMatchObject({ number: 2, theme: null });
  });

  it('omits leagues the caller is not a member of', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'mine-host3@example.com');
    await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Other League', seasonLength: 8, ...round1 });
    const other = await signUp(app, 'mine-other@example.com');

    const res = await request(app).get('/leagues/mine').set('Authorization', `Bearer ${other.token}`);

    expect(res.status).toBe(200);
    expect(res.body.leagues).toHaveLength(0);
  });
});

describe('PATCH /rounds/:roundId', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('rejects requests without a session', async () => {
    const { app } = buildApp();
    const { rounds } = await createSeason(app, 'patch-anon@example.com');
    const res = await request(app).patch(`/rounds/${rounds[2].id}`).send({ theme: 'Deep cuts' });
    expect(res.status).toBe(401);
  });

  it('404s for an unknown round', async () => {
    const { app } = buildApp();
    const { host } = await createSeason(app, 'patch-404@example.com');
    const res = await request(app)
      .patch('/rounds/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ theme: 'Deep cuts' });
    expect(res.status).toBe(404);
  });

  it('lets the host name a future round and move both of its deadlines', async () => {
    const { app } = buildApp();
    const { host, leagueId, rounds } = await createSeason(app, 'patch-host@example.com');
    // Round 3's window pulled in a day at each end -- the preset has it flush against rounds 2
    // and 4, so shrinking is the only move that does not cross a neighbour.
    const submissionDeadline = new Date(rounds[2].submission_deadline.getTime() + DAY).toISOString();
    const guessingDeadline = new Date(rounds[2].guessing_deadline.getTime() - DAY).toISOString();

    const res = await request(app)
      .patch(`/rounds/${rounds[2].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ theme: 'Deep cuts', submissionDeadline, guessingDeadline });

    expect(res.status).toBe(200);
    expect(res.body.rounds[0]).toMatchObject({ id: rounds[2].id, number: 3, theme: 'Deep cuts' });
    expect(new Date(res.body.rounds[0].submissionDeadline)).toEqual(new Date(submissionDeadline));
    expect(new Date(res.body.rounds[0].guessingDeadline)).toEqual(new Date(guessingDeadline));

    const after = await scheduleOf(leagueId);
    expect(after[2].theme).toBe('Deep cuts');
    expect(after[2].submission_deadline).toEqual(new Date(submissionDeadline));
    expect(after[2].guessing_deadline).toEqual(new Date(guessingDeadline));
  });

  it('shows a renamed current round in GET /leagues/mine', async () => {
    const { app } = buildApp();
    const { host, rounds } = await createSeason(app, 'patch-mine@example.com');

    await request(app)
      .patch(`/rounds/${rounds[0].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ theme: 'Songs about rain' });

    const res = await request(app).get('/leagues/mine').set('Authorization', `Bearer ${host.token}`);
    expect(res.body.leagues[0].round).toMatchObject({ number: 1, theme: 'Songs about rain' });
  });

  it('403s a league member who is not the host', async () => {
    const { app } = buildApp();
    const { inviteCode, rounds } = await createSeason(app, 'patch-member-host@example.com');
    const player = await signUp(app, 'patch-member@example.com');
    await request(app).post(`/leagues/invite/${inviteCode}/join`).set('Authorization', `Bearer ${player.token}`);

    const res = await request(app)
      .patch(`/rounds/${rounds[2].id}`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ theme: 'Deep cuts' });

    expect(res.status).toBe(403);
  });

  it('403s someone outside the league', async () => {
    const { app } = buildApp();
    const { rounds } = await createSeason(app, 'patch-outsider-host@example.com');
    const outsider = await signUp(app, 'patch-outsider@example.com');

    const res = await request(app)
      .patch(`/rounds/${rounds[2].id}`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ theme: 'Deep cuts' });

    expect(res.status).toBe(403);
  });

  it('rejects a guessing deadline that is not after the submission deadline', async () => {
    const { app } = buildApp();
    const { host, rounds } = await createSeason(app, 'patch-order@example.com');

    const res = await request(app)
      .patch(`/rounds/${rounds[2].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ guessingDeadline: new Date(rounds[2].submission_deadline.getTime() - DAY).toISOString() });

    expect(res.status).toBe(400);
  });

  it('rejects a submission deadline that backs into the previous round', async () => {
    const { app } = buildApp();
    const { host, leagueId, rounds } = await createSeason(app, 'patch-back@example.com');

    const res = await request(app)
      .patch(`/rounds/${rounds[2].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ submissionDeadline: new Date(rounds[1].guessing_deadline.getTime() - DAY).toISOString() });

    expect(res.status).toBe(400);
    expect((await scheduleOf(leagueId))[2].submission_deadline).toEqual(rounds[2].submission_deadline);
  });

  // #79: guessing_deadline is the boundary between round N and round N+1, so moving it slides
  // the rest of the season instead of being refused for crossing round N+1. A season that can
  // only ever be shrunk is not a schedule that flexes.
  //
  // Round N+1 is the one round that does not slide whole: its submission window opens at round
  // N's *submission* deadline, which the host did not move, so it grows by the same delta round
  // N's guessing phase does. Round N+1 collects submissions while round N is being guessed.
  it.each([
    ['later', 7 * DAY],
    ['earlier', -3 * DAY],
  ])('slides the rest of the season when a round boundary moves %s', async (label, delta) => {
    const { app } = buildApp();
    const { host, leagueId, rounds } = await createSeason(app, `patch-slide-${label}@example.com`);
    const guessingDeadline = new Date(rounds[1].guessing_deadline.getTime() + delta).toISOString();

    const res = await request(app)
      .patch(`/rounds/${rounds[1].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ guessingDeadline });

    expect(res.status).toBe(200);
    const after = await scheduleOf(leagueId);

    // Round 1 is before the boundary and must not have moved at all.
    expect(after[0]).toEqual(rounds[0]);
    // Round 2's own guessing phase resizes by the delta; its submission phase is untouched.
    expect(after[1].submission_deadline).toEqual(rounds[1].submission_deadline);
    expect(after[1].guessing_deadline).toEqual(new Date(guessingDeadline));

    for (const index of [2, 3]) {
      expect(after[index].submission_deadline).toEqual(new Date(rounds[index].submission_deadline.getTime() + delta));
      expect(after[index].guessing_deadline).toEqual(new Date(rounds[index].guessing_deadline.getTime() + delta));
      // Guessing window length preserved for every slid round.
      expect(after[index].guessing_deadline.getTime() - after[index].submission_deadline.getTime()).toBe(
        rounds[index].guessing_deadline.getTime() - rounds[index].submission_deadline.getTime(),
      );
    }
    // Round 3 keeps collecting from round 2's submission deadline, so its submission window grows
    // by the delta; round 4 slid whole and keeps its length.
    expect(after[2].submission_opens_at).toEqual(rounds[2].submission_opens_at);
    expect(after[3].submission_opens_at).toEqual(new Date(rounds[3].submission_opens_at.getTime() + delta));
    expect(after[3].submission_deadline.getTime() - after[3].submission_opens_at.getTime()).toBe(
      rounds[3].submission_deadline.getTime() - rounds[3].submission_opens_at.getTime(),
    );
    // Back-to-back all the way down: the schedule is still flush after the slide.
    expect(after[2].submission_deadline).toEqual(after[1].guessing_deadline);
    expect(after[3].submission_deadline).toEqual(after[2].guessing_deadline);
  });

  // A one-round patch that silently moves the season's end date is a surprise, and the schedule
  // screen has to redraw every round it moved.
  it('answers with every round the slide moved', async () => {
    const { app } = buildApp();
    const { host, rounds } = await createSeason(app, 'patch-slide-response@example.com');

    const res = await request(app)
      .patch(`/rounds/${rounds[1].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ guessingDeadline: new Date(rounds[1].guessing_deadline.getTime() + DAY).toISOString() });

    expect(res.body.rounds[0]).toMatchObject({ id: rounds[1].id, number: 2 });
    expect(res.body.rounds.map((r: { number: number }) => r.number)).toEqual([2, 3, 4]);
  });

  // The sweep sends each reminder once (`... IS NULL`), so a slid round whose flag is still set
  // fires its reminder against a time that no longer exists -- or never fires it at all.
  it('clears both reminder flags on every round the slide moved', async () => {
    const { app } = buildApp();
    const { host, leagueId, rounds } = await createSeason(app, 'patch-slide-reminders@example.com');
    await markRemindersSent(testDb.pool, leagueId);

    await request(app)
      .patch(`/rounds/${rounds[1].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ guessingDeadline: new Date(rounds[1].guessing_deadline.getTime() + DAY).toISOString() });

    const after = await scheduleOf(leagueId);
    for (const index of [2, 3]) {
      expect(after[index].submission_reminder_sent_at).toBeNull();
      expect(after[index].guessing_reminder_sent_at).toBeNull();
    }
    // Round 2's guessing window moved so its guessing reminder is due again, but nothing touched
    // its submission window -- and round 1 is before the boundary entirely.
    expect(after[1].guessing_reminder_sent_at).toBeNull();
    expect(after[1].submission_reminder_sent_at).not.toBeNull();
    expect(after[0].submission_reminder_sent_at).not.toBeNull();
    expect(after[0].guessing_reminder_sent_at).not.toBeNull();
  });

  // The split point inside a round cascades to nothing but the next round's submission window --
  // the asymmetry is the point, and this is the behaviour #75 shipped.
  it('slides nothing when only the submission deadline moves', async () => {
    const { app } = buildApp();
    const { host, leagueId, rounds } = await createSeason(app, 'patch-no-slide@example.com');

    const res = await request(app)
      .patch(`/rounds/${rounds[1].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ submissionDeadline: new Date(rounds[1].submission_deadline.getTime() + DAY).toISOString() });

    expect(res.status).toBe(200);
    const after = await scheduleOf(leagueId);
    expect(after[1].guessing_deadline).toEqual(rounds[1].guessing_deadline);
    expect(after[2].submission_deadline).toEqual(rounds[2].submission_deadline);
    expect(after[2].guessing_deadline).toEqual(rounds[2].guessing_deadline);
    expect(after[3]).toEqual(rounds[3]);
  });

  it('rejects a submission deadline past the round\'s own guessing deadline', async () => {
    const { app } = buildApp();
    const { host, leagueId, rounds } = await createSeason(app, 'patch-split-past-end@example.com');

    const res = await request(app)
      .patch(`/rounds/${rounds[1].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ submissionDeadline: new Date(rounds[1].guessing_deadline.getTime() + DAY).toISOString() });

    expect(res.status).toBe(400);
    expect((await scheduleOf(leagueId))[1]).toEqual(rounds[1]);
  });

  // The slide runs off the end of the season here: nothing follows round 4 to move.
  it('patches the last round of the season with nothing after it to slide', async () => {
    const { app } = buildApp();
    const { host, leagueId, rounds } = await createSeason(app, 'patch-slide-last@example.com');
    const guessingDeadline = new Date(rounds[3].guessing_deadline.getTime() + 7 * DAY).toISOString();

    const res = await request(app)
      .patch(`/rounds/${rounds[3].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ guessingDeadline });

    expect(res.status).toBe(200);
    expect(res.body.rounds.map((r: { number: number }) => r.number)).toEqual([4]);
    const after = await scheduleOf(leagueId);
    expect(after[3].guessing_deadline).toEqual(new Date(guessingDeadline));
    expect(after.slice(0, 3)).toEqual(rounds.slice(0, 3));
  });

  // A hand-edited or legacy league need not be monotonic, so the guarantee that a slide only ever
  // touches future rounds is asserted rather than assumed.
  it('409s a slide that would move a round that is already over', async () => {
    const { app } = buildApp();
    const { host, leagueId, rounds } = await createSeason(app, 'patch-slide-played@example.com');
    await closeGuessingWindow(rounds[3].id);

    const res = await request(app)
      .patch(`/rounds/${rounds[1].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ guessingDeadline: new Date(rounds[1].guessing_deadline.getTime() + DAY).toISOString() });

    expect(res.status).toBe(409);
    expect((await scheduleOf(leagueId))[1]).toEqual(rounds[1]);
  });

  it('409s a round whose guessing deadline has already passed', async () => {
    const { app } = buildApp();
    const { host, rounds } = await createSeason(app, 'patch-over@example.com');
    await closeGuessingWindow(rounds[2].id);

    const res = await request(app)
      .patch(`/rounds/${rounds[2].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ theme: 'Deep cuts' });

    expect(res.status).toBe(409);
  });

  it('409s a move to a submission window that has already closed', async () => {
    const { app } = buildApp();
    const { host, rounds } = await createSeason(app, 'patch-shut-window@example.com');
    await closeSubmissionWindow(testDb.pool, rounds[2].id);

    const res = await request(app)
      .patch(`/rounds/${rounds[2].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ submissionDeadline: new Date(Date.now() + DAY).toISOString() });

    // Reopening it would take submissions while the round is already being guessed.
    expect(res.status).toBe(409);
  });

  it('still names a round that is already being guessed', async () => {
    const { app } = buildApp();
    const { host, rounds } = await createSeason(app, 'patch-guessing-theme@example.com');
    await closeSubmissionWindow(testDb.pool, rounds[2].id);

    const res = await request(app)
      .patch(`/rounds/${rounds[2].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ theme: 'Deep cuts' });

    expect(res.status).toBe(200);
    expect(res.body.rounds[0].theme).toBe('Deep cuts');
  });

  it('rejects a submission deadline in the past', async () => {
    const { app } = buildApp();
    const { host, rounds } = await createSeason(app, 'patch-past@example.com');

    const res = await request(app)
      .patch(`/rounds/${rounds[0].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ submissionDeadline: '2000-01-01T00:00:00.000Z' });

    expect(res.status).toBe(400);
  });

  // Concluding the round on the spot publishes results and fires the playlist export (#7) at a
  // checkpoint nobody reached -- and the round is frozen afterwards.
  it('rejects a guessing deadline in the past', async () => {
    const { app } = buildApp();
    const { host, rounds } = await createSeason(app, 'patch-past-guessing@example.com');
    await closeSubmissionWindow(testDb.pool, rounds[2].id);

    const res = await request(app)
      .patch(`/rounds/${rounds[2].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ guessingDeadline: '2020-01-01T00:00:00.000Z' });

    expect(res.status).toBe(400);
  });

  // new Date(null) is the epoch, not an invalid date, so a null slides past a validity check.
  it('rejects a deadline that is not a string', async () => {
    const { app } = buildApp();
    const { host, leagueId, rounds } = await createSeason(app, 'patch-null@example.com');

    const res = await request(app)
      .patch(`/rounds/${rounds[0].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ submissionDeadline: null });

    expect(res.status).toBe(400);
    expect((await scheduleOf(leagueId))[0].submission_deadline).toEqual(rounds[0].submission_deadline);
  });

  it('rejects a deadline that is not a date at all', async () => {
    const { app } = buildApp();
    const { host, rounds } = await createSeason(app, 'patch-garbage@example.com');

    const res = await request(app)
      .patch(`/rounds/${rounds[0].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ guessingDeadline: 'next tuesday-ish' });

    expect(res.status).toBe(400);
  });

  // The sweep sends each reminder once (`... IS NULL`), so a flag left set from the old window
  // would mean the moved deadline is never announced.
  it('clears the reminder already sent against a window it moves', async () => {
    const { app } = buildApp();
    const { host, leagueId, rounds } = await createSeason(app, 'patch-reminders@example.com');
    await markRemindersSent(testDb.pool, leagueId);

    await request(app)
      .patch(`/rounds/${rounds[1].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ submissionDeadline: new Date(rounds[1].submission_deadline.getTime() + DAY).toISOString() });

    const after = await scheduleOf(leagueId);
    // Round 2's submission window moved, and round 3's opened with it.
    expect(after[1].submission_reminder_sent_at).toBeNull();
    expect(after[2].submission_reminder_sent_at).toBeNull();
    // Nothing touched round 2's guessing window, or round 4 at all.
    expect(after[1].guessing_reminder_sent_at).not.toBeNull();
    expect(after[3].submission_reminder_sent_at).not.toBeNull();
  });

  it('leaves both deadlines untouched on a theme-only patch', async () => {
    const { app } = buildApp();
    const { host, leagueId, rounds } = await createSeason(app, 'patch-theme-only@example.com');

    await request(app)
      .patch(`/rounds/${rounds[2].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ theme: 'Deep cuts' });

    const after = await scheduleOf(leagueId);
    expect(after[2].submission_deadline).toEqual(rounds[2].submission_deadline);
    expect(after[2].guessing_deadline).toEqual(rounds[2].guessing_deadline);
    expect(after[2].submission_opens_at).toEqual(rounds[2].submission_opens_at);
  });

  it('keeps the theme on a deadline-only patch', async () => {
    const { app } = buildApp();
    const { host, leagueId, rounds } = await createSeason(app, 'patch-deadline-only@example.com');

    const res = await request(app)
      .patch(`/rounds/${rounds[0].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ guessingDeadline: new Date(rounds[0].guessing_deadline.getTime() - DAY).toISOString() });

    expect(res.status).toBe(200);
    expect(res.body.rounds[0].theme).toBe(round1.theme);
    expect((await scheduleOf(leagueId))[0].theme).toBe(round1.theme);
  });

  // Round N+1 takes submissions while round N is being guessed, so its window opens at round N's
  // submission deadline. The notification sweep reads the reminder as a fraction of that window.
  it('moves the next round\'s submission window with the patched round', async () => {
    const { app } = buildApp();
    const { host, leagueId, rounds } = await createSeason(app, 'patch-opens-at@example.com');
    const submissionDeadline = new Date(rounds[1].submission_deadline.getTime() + DAY).toISOString();

    await request(app)
      .patch(`/rounds/${rounds[1].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ submissionDeadline });

    const after = await scheduleOf(leagueId);
    expect(after[2].submission_opens_at).toEqual(new Date(submissionDeadline));
    // The last round has no successor to shift, and shifting must not run off the end.
    expect(after[3].submission_opens_at).toEqual(rounds[3].submission_opens_at);
  });

  // The other half of that invariant: a successor's window opens at the patched round's
  // submission deadline, so moving only the guessing deadline must leave it where it is.
  it('leaves the next round\'s submission window alone when only guessing moves', async () => {
    const { app } = buildApp();
    const { host, leagueId, rounds } = await createSeason(app, 'patch-opens-at-held@example.com');

    await request(app)
      .patch(`/rounds/${rounds[1].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ guessingDeadline: new Date(rounds[1].guessing_deadline.getTime() - DAY).toISOString() });

    expect((await scheduleOf(leagueId))[2].submission_opens_at).toEqual(rounds[2].submission_opens_at);
  });

  it('accepts a patch to the final round of a season', async () => {
    const { app } = buildApp();
    const { host, rounds } = await createSeason(app, 'patch-last@example.com', 2);

    const res = await request(app)
      .patch(`/rounds/${rounds[1].id}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ guessingDeadline: new Date(rounds[1].guessing_deadline.getTime() + 5 * DAY).toISOString() });

    expect(res.status).toBe(200);
  });
});

// The schedule screen (#77) needs every round of the league, not just the current one, plus
// whether the viewer is the host -- a member who sees edit affordances only finds out on the 403.
describe('GET /leagues/:leagueId/rounds', () => {
  it('rejects requests without a session', async () => {
    const { app } = buildApp();
    const { leagueId } = await createSeason(app, 'rounds-anon@example.com');
    expect((await request(app).get(`/leagues/${leagueId}/rounds`)).status).toBe(401);
  });

  it('404s for an unknown league', async () => {
    const { app } = buildApp();
    const { host } = await createSeason(app, 'rounds-404@example.com');
    const res = await request(app)
      .get('/leagues/00000000-0000-0000-0000-000000000000/rounds')
      .set('Authorization', `Bearer ${host.token}`);
    expect(res.status).toBe(404);
  });

  it('403s someone who is not in the league', async () => {
    const { app } = buildApp();
    const { leagueId } = await createSeason(app, 'rounds-outsider-host@example.com');
    const outsider = await signUp(app, 'rounds-outsider@example.com');
    const res = await request(app).get(`/leagues/${leagueId}/rounds`).set('Authorization', `Bearer ${outsider.token}`);
    expect(res.status).toBe(403);
  });

  it('returns the whole season in round order, with only round 1 themed', async () => {
    const { app } = buildApp();
    const { host, leagueId } = await createSeason(app, 'rounds-host@example.com');

    const res = await request(app).get(`/leagues/${leagueId}/rounds`).set('Authorization', `Bearer ${host.token}`);

    expect(res.status).toBe(200);
    expect(res.body.isHost).toBe(true);
    expect(res.body.rounds.map((r: { number: number }) => r.number)).toEqual([1, 2, 3, 4]);
    expect(res.body.rounds.map((r: { theme: string | null }) => r.theme)).toEqual([
      'One-hit wonders',
      null,
      null,
      null,
    ]);
    // Back-to-back: each round's submission deadline is the previous round's guessing deadline.
    expect(res.body.rounds[1].submissionDeadline).toBe(res.body.rounds[0].guessingDeadline);
  });

  it('tells a member they are not the host', async () => {
    const { app } = buildApp();
    const { leagueId, inviteCode } = await createSeason(app, 'rounds-member-host@example.com');
    const player = await signUp(app, 'rounds-member@example.com');
    await request(app).post(`/leagues/invite/${inviteCode}/join`).set('Authorization', `Bearer ${player.token}`);

    const res = await request(app).get(`/leagues/${leagueId}/rounds`).set('Authorization', `Bearer ${player.token}`);

    expect(res.status).toBe(200);
    expect(res.body.isHost).toBe(false);
    expect(res.body.rounds).toHaveLength(4);
  });

  // Round metadata only -- submissions stay anonymous until guesses lock (PRODUCT.md, Principle 1).
  it('leaks nothing beyond round metadata', async () => {
    const { app } = buildApp();
    const { host, leagueId } = await createSeason(app, 'rounds-shape@example.com');

    const res = await request(app).get(`/leagues/${leagueId}/rounds`).set('Authorization', `Bearer ${host.token}`);

    expect(Object.keys(res.body.rounds[0]).sort()).toEqual([
      'guessingDeadline',
      'id',
      'number',
      'submissionDeadline',
      'theme',
    ]);
  });
});
