import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { startTestDb, type TestDb } from './testDb.js';
import {
  buildApp as sharedBuildApp,
  closeGuessingWindow as closeGuessingWindowFor,
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
    round_number: number;
    theme: string | null;
    submission_opens_at: Date;
    submission_deadline: Date;
    guessing_deadline: Date;
  }>(
    `SELECT round_number, theme, submission_opens_at, submission_deadline, guessing_deadline
     FROM rounds WHERE league_id = $1 ORDER BY round_number`,
    [leagueId],
  );
  return res.rows;
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
