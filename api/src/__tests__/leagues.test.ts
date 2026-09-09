import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { FakeBandcampAdapter, FakeMusicServiceAdapter } from '../adapters/fakeAdapter.js';
import { FakeEmailChannel, FakePushChannel } from '../notifications/fakeChannels.js';
import { startTestDb, type TestDb } from './testDb.js';
import { closeGuessingWindow as closeGuessingWindowFor } from './testHelpers.js';

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
  const appleMusicAdapter = new FakeMusicServiceAdapter('apple_music');
  const youtubeMusicAdapter = new FakeMusicServiceAdapter('youtube_music');
  const app = createApp({
    pool: testDb.pool,
    sessionSecret: 'test-secret',
    appleMusicAdapter,
    youtubeMusicAdapter,
    bandcampAdapter: new FakeBandcampAdapter(),
    pushChannel: new FakePushChannel(),
    emailChannel: new FakeEmailChannel(),
  });
  return { app, appleMusicAdapter };
}

async function closeGuessingWindow(roundId: string) {
  await closeGuessingWindowFor(testDb.pool, roundId);
}

async function signUp(app: Express, email: string) {
  const res = await request(app).post('/accounts').send({ email, password: 'password123' });
  return { accountId: res.body.accountId as string, token: res.body.token as string };
}

async function linkFakeAppleMusic(app: Express, appleMusicAdapter: FakeMusicServiceAdapter, token: string) {
  const musicUserToken = `mut-${token}`;
  appleMusicAdapter.validMusicUserTokens.set(musicUserToken, { serviceUserId: `apple-music-${token}` });
  await request(app)
    .post('/auth/apple-music/callback')
    .set('Authorization', `Bearer ${token}`)
    .send({ musicUserToken });
}

const round1 = {
  theme: 'One-hit wonders',
  submissionDeadline: '2026-01-10T00:00:00.000Z',
  guessingDeadline: '2026-01-17T00:00:00.000Z',
};

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
        submissionDeadline: '2026-01-17T00:00:00.000Z',
        guessingDeadline: '2026-01-10T00:00:00.000Z',
      });

    expect(res.status).toBe(400);
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
    expect(res.body.currentRound.theme).toBe(round1.theme);
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

  it('rejects joining without a linked music service', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'host6@example.com');
    const inviteCode = await createLeague(app, host);
    const player = await signUp(app, 'player@example.com');

    const res = await request(app)
      .post(`/leagues/invite/${inviteCode}/join`)
      .set('Authorization', `Bearer ${player.token}`);

    expect(res.status).toBe(403);
  });

  it('joins immediately once a music service is linked, with no host approval step', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const host = await signUp(app, 'host7@example.com');
    const inviteCode = await createLeague(app, host);
    const player = await signUp(app, 'player2@example.com');
    await linkFakeAppleMusic(app, appleMusicAdapter, player.token);

    const res = await request(app)
      .post(`/leagues/invite/${inviteCode}/join`)
      .set('Authorization', `Bearer ${player.token}`);

    expect(res.status).toBe(200);
    expect(res.body.leagueId).toBeTruthy();

    const preview = await request(app).get(`/leagues/invite/${inviteCode}`);
    expect(preview.body.playerCount).toBe(2);
  });

  it('is idempotent when the same player joins twice', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const host = await signUp(app, 'host8@example.com');
    const inviteCode = await createLeague(app, host);
    const player = await signUp(app, 'player3@example.com');
    await linkFakeAppleMusic(app, appleMusicAdapter, player.token);

    await request(app).post(`/leagues/invite/${inviteCode}/join`).set('Authorization', `Bearer ${player.token}`);
    await request(app).post(`/leagues/invite/${inviteCode}/join`).set('Authorization', `Bearer ${player.token}`);

    const preview = await request(app).get(`/leagues/invite/${inviteCode}`);
    expect(preview.body.playerCount).toBe(2);
  });

  it('404s for an unknown invite code', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const player = await signUp(app, 'player4@example.com');
    await linkFakeAppleMusic(app, appleMusicAdapter, player.token);

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
        seasonLength: 8,
        theme: round1.theme,
        submissionDeadline: '2000-01-01T00:00:00.000Z',
        guessingDeadline: '2030-01-17T00:00:00.000Z',
      });

    const guessingRes = await request(app).get('/leagues/mine').set('Authorization', `Bearer ${host.token}`);
    expect(guessingRes.body.leagues[0].round.phase).toBe('guessing');

    await closeGuessingWindow(created.body.round.id);
    const resultsRes = await request(app).get('/leagues/mine').set('Authorization', `Bearer ${host.token}`);
    expect(resultsRes.body.leagues[0].round.phase).toBe('results');
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

describe('POST /leagues/:leagueId/rounds', () => {
  const futureRound1 = {
    theme: 'One-hit wonders',
    submissionDeadline: '2030-01-10T00:00:00.000Z',
    guessingDeadline: '2030-01-17T00:00:00.000Z',
  };
  const round2 = {
    theme: 'Covers',
    submissionDeadline: '2030-02-10T00:00:00.000Z',
    guessingDeadline: '2030-02-17T00:00:00.000Z',
  };

  async function createLeague(app: Express, host: { token: string }) {
    const res = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Office League', seasonLength: 2, ...futureRound1 });
    return { leagueId: res.body.leagueId as string, roundId: res.body.round.id as string };
  }

  it('rejects requests without a session', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'rounds-host1@example.com');
    const { leagueId } = await createLeague(app, host);

    const res = await request(app).post(`/leagues/${leagueId}/rounds`).send(round2);
    expect(res.status).toBe(401);
  });

  it('404s for an unknown league', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'rounds-host2@example.com');

    const res = await request(app)
      .post('/leagues/00000000-0000-0000-0000-000000000000/rounds')
      .set('Authorization', `Bearer ${host.token}`)
      .send(round2);
    expect(res.status).toBe(404);
  });

  it('rejects a non-host member', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const host = await signUp(app, 'rounds-host3@example.com');
    const { leagueId } = await createLeague(app, host);
    const player = await signUp(app, 'rounds-player3@example.com');
    await linkFakeAppleMusic(app, appleMusicAdapter, player.token);

    const res = await request(app)
      .post(`/leagues/${leagueId}/rounds`)
      .set('Authorization', `Bearer ${player.token}`)
      .send(round2);
    expect(res.status).toBe(403);
  });

  it('rejects starting the next round before the current round is revealed', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'rounds-host4@example.com');
    const { leagueId } = await createLeague(app, host);

    const res = await request(app)
      .post(`/leagues/${leagueId}/rounds`)
      .set('Authorization', `Bearer ${host.token}`)
      .send(round2);
    expect(res.status).toBe(403);
  });

  it('rejects with the not-revealed error, not the concluded error, when the final round is not yet revealed', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'rounds-host4b@example.com');
    const { leagueId, roundId } = await createLeague(app, host); // seasonLength: 2
    await closeGuessingWindow(roundId);
    await request(app)
      .post(`/leagues/${leagueId}/rounds`)
      .set('Authorization', `Bearer ${host.token}`)
      .send(round2); // round 2 is now the final round, not yet revealed

    const res = await request(app)
      .post(`/leagues/${leagueId}/rounds`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        theme: 'Round 3',
        submissionDeadline: '2030-03-10T00:00:00.000Z',
        guessingDeadline: '2030-03-17T00:00:00.000Z',
      });
    expect(res.status).toBe(403);
  });

  it('rejects an invalid round body', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'rounds-host5@example.com');
    const { leagueId, roundId } = await createLeague(app, host);
    await closeGuessingWindow(roundId);

    const res = await request(app)
      .post(`/leagues/${leagueId}/rounds`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ theme: '', submissionDeadline: round2.submissionDeadline, guessingDeadline: round2.guessingDeadline });
    expect(res.status).toBe(400);
  });

  it('starts round 2 once round 1 is revealed', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'rounds-host6@example.com');
    const { leagueId, roundId } = await createLeague(app, host);
    await closeGuessingWindow(roundId);

    const res = await request(app)
      .post(`/leagues/${leagueId}/rounds`)
      .set('Authorization', `Bearer ${host.token}`)
      .send(round2);

    expect(res.status).toBe(201);
    expect(res.body.round).toMatchObject({ number: 2, theme: round2.theme });
  });

  it('refuses to start another round once the season has concluded', async () => {
    const { app } = buildApp();
    const host = await signUp(app, 'rounds-host7@example.com');
    const { leagueId, roundId } = await createLeague(app, host); // seasonLength: 2
    await closeGuessingWindow(roundId);
    const round2Res = await request(app)
      .post(`/leagues/${leagueId}/rounds`)
      .set('Authorization', `Bearer ${host.token}`)
      .send(round2);
    await closeGuessingWindow(round2Res.body.round.id);

    const res = await request(app)
      .post(`/leagues/${leagueId}/rounds`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        theme: 'Round 3',
        submissionDeadline: '2030-03-10T00:00:00.000Z',
        guessingDeadline: '2030-03-17T00:00:00.000Z',
      });
    expect(res.status).toBe(409);
  });
});
