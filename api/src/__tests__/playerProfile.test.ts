import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startTestDb, type TestDb } from './testDb.js';
import { buildApp, closeGuessingWindow, closeSubmissionWindow, createLeagueWithPlayers, guess, signUp } from './testHelpers.js';

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

const auth = (m: { token: string }) => ({ Authorization: `Bearer ${m.token}` });

describe('GET /players/:id (#177)', () => {
  it('requires a session and 404s on unknown ids', async () => {
    const { app } = buildApp(testDb.pool);
    const me = await signUp(app, 'me@example.com');
    expect((await request(app).get(`/players/${me.accountId}`)).status).toBe(401);
    expect((await request(app).get('/players/not-a-uuid').set(auth(me))).status).toBe(404);
    expect((await request(app).get('/players/00000000-0000-4000-8000-000000000000').set(auth(me))).status).toBe(404);
  });

  it('shows public fields only, with empty sections for a new player', async () => {
    const { app } = buildApp(testDb.pool);
    const me = await signUp(app, 'me@example.com');
    const other = await signUp(app, 'other@example.com');
    await testDb.pool.query("UPDATE accounts SET display_name = 'Sam', pronouns = 'they/them', about_me = 'Hi' WHERE id = $1", [other.accountId]);
    const res = await request(app).get(`/players/${other.accountId}`).set(auth(me));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accountId: other.accountId,
      displayName: 'Sam',
      avatarUrl: null,
      pronouns: 'they/them',
      aboutMe: 'Hi',
      leagues: [],
      favorites: [],
      besties: { guessedMe: [], iGuessed: [] },
    });
    expect(JSON.stringify(res.body)).not.toContain('other@example.com');
  });

  it('carries league history, favorites and besties, and masks blocked besties', async () => {
    const { app } = buildApp(testDb.pool);
    const league = await createLeagueWithPlayers(app, 3);
    const [a, b, c] = league.members;
    await closeSubmissionWindow(testDb.pool, league.roundId);
    for (const [g, s] of [[a, 1], [b, 0], [c, 0]] as const) {
      await guess(app, league.roundId, league.submissions[s].submissionId, g.token, league.submissions[s].accountId);
    }
    await closeGuessingWindow(testDb.pool, league.roundId);
    await request(app).post(`/submissions/${league.submissions[1].submissionId}/favorite`).set(auth(a));

    const res = await request(app).get(`/players/${a.accountId}`).set(auth(b));
    expect(res.body.leagues).toHaveLength(1);
    expect(Object.keys(res.body.leagues[0]).sort()).toEqual(['concluded', 'id', 'joinedAt', 'name', 'seasonLength']);
    expect(res.body.favorites).toHaveLength(1);
    expect(res.body.favorites[0].submissionId).toBe(league.submissions[1].submissionId);
    expect(res.body.favorites[0]).not.toHaveProperty('favoritedAt');
    expect(res.body.besties.guessedMe.map((x: { accountId: string }) => x.accountId).sort()).toEqual([b.accountId, c.accountId].sort());

    await request(app).put(`/blocks/${c.accountId}`).set(auth(b));
    const masked = await request(app).get(`/players/${a.accountId}`).set(auth(b));
    expect(masked.body.besties.guessedMe.find((x: { accountId: string }) => x.accountId === c.accountId).displayName).toBe('Blocked player');
  });

  it('404s for a player the viewer has blocked', async () => {
    const { app } = buildApp(testDb.pool);
    const me = await signUp(app, 'me@example.com');
    const other = await signUp(app, 'other@example.com');
    await testDb.pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [me.accountId, other.accountId]);
    expect((await request(app).get(`/players/${other.accountId}`).set(auth(me))).status).toBe(404);
  });
});
