import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startTestDb, type TestDb } from './testDb.js';
import { buildApp, createLeagueWithPlayers, signUp } from './testHelpers.js';

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

const del = (app: ReturnType<typeof buildApp>['app'], token: string, body: object = { password: 'password123' }) =>
  request(app).delete('/accounts/me').set('Authorization', `Bearer ${token}`).send(body);
const count = async (sql: string, params: unknown[] = []) => Number((await testDb.pool.query(sql, params)).rows[0].n);

describe('DELETE /accounts/me', () => {
  it('requires a session', async () => {
    const { app } = buildApp(testDb.pool);
    expect((await request(app).delete('/accounts/me').send({ password: 'password123' })).status).toBe(401);
  });

  it('refuses a missing or wrong password and deletes nothing', async () => {
    const { app } = buildApp(testDb.pool);
    const me = await signUp(app, 'me@example.com');
    expect((await del(app, me.token, {})).status).toBe(400);
    expect((await del(app, me.token, { password: 'nope-nope-nope' })).status).toBe(403);
    expect((await request(app).get('/accounts/me').set('Authorization', `Bearer ${me.token}`)).status).toBe(200);
  });

  it('removes what identifies the person and ends every session', async () => {
    const { app } = buildApp(testDb.pool);
    const me = await signUp(app, 'leaver@example.com');
    const otherDevice = await request(app).post('/sessions').send({ email: 'leaver@example.com', password: 'password123' });
    await testDb.pool.query("UPDATE accounts SET display_name = 'Sam', avatar = '\\x00', avatar_content_type = 'image/png', avatar_updated_at = now(), google_sub = 'g-1' WHERE id = $1", [me.accountId]);
    await testDb.pool.query("INSERT INTO push_tokens (account_id, platform, token) VALUES ($1, 'expo', 't')", [me.accountId]);
    await testDb.pool.query('INSERT INTO notification_settings (account_id) VALUES ($1)', [me.accountId]);
    await testDb.pool.query("INSERT INTO notifications (account_id, type, title, body) VALUES ($1, 'results_ready', 't', 'b')", [me.accountId]);

    expect((await del(app, me.token)).status).toBe(204);

    const row = (await testDb.pool.query('SELECT * FROM accounts WHERE id = $1', [me.accountId])).rows[0];
    expect(row).toMatchObject({ password_hash: null, display_name: null, avatar: null, avatar_updated_at: null, google_sub: null });
    expect(row.email).not.toContain('leaver');
    expect(row.deleted_at).not.toBeNull();
    for (const table of ['push_tokens', 'notification_settings', 'notifications']) {
      expect(await count(`SELECT count(*) n FROM ${table} WHERE account_id = $1`, [me.accountId])).toBe(0);
    }
    // Stateless tokens: the one that deleted, and one from another device, both stop working.
    expect((await request(app).get('/accounts/me').set('Authorization', `Bearer ${me.token}`)).status).toBe(401);
    expect((await request(app).get('/accounts/me').set('Authorization', `Bearer ${otherDevice.body.token}`)).status).toBe(401);
    expect((await request(app).post('/sessions').send({ email: 'leaver@example.com', password: 'password123' })).status).toBe(401);
    // The address is free again.
    expect((await request(app).post('/accounts').send({ email: 'leaver@example.com', password: 'password123' })).status).toBe(201);
  });

  it('leaves the league’s submissions, guesses and membership intact for everyone else', async () => {
    const { app } = buildApp(testDb.pool);
    const league = await createLeagueWithPlayers(app, 3);
    const leaver = league.members[1];
    await testDb.pool.query(
      'INSERT INTO guesses (submission_id, guesser_account_id, guessed_account_id) VALUES ($1, $2, $3)',
      [league.submissions[0].submissionId, leaver.accountId, league.members[2].accountId],
    );
    await testDb.pool.query('INSERT INTO favorites (account_id, submission_id) VALUES ($1, $2)', [leaver.accountId, league.submissions[0].submissionId]);
    const before = {
      submissions: await count('SELECT count(*) n FROM submissions'),
      guesses: await count('SELECT count(*) n FROM guesses'),
      members: await count('SELECT count(*) n FROM league_members'),
    };

    expect((await del(app, leaver.token)).status).toBe(204);

    expect({
      submissions: await count('SELECT count(*) n FROM submissions'),
      guesses: await count('SELECT count(*) n FROM guesses'),
      members: await count('SELECT count(*) n FROM league_members'),
    }).toEqual(before);
    expect(await count('SELECT count(*) n FROM favorites WHERE account_id = $1', [leaver.accountId])).toBe(0);
    const overview = await request(app).get(`/rounds/${league.roundId}/overview`).set('Authorization', `Bearer ${league.members[0].token}`);
    expect(overview.status).toBe(200);
  });

  it('blocks the host of a season still in progress, naming the problem', async () => {
    const { app } = buildApp(testDb.pool);
    const league = await createLeagueWithPlayers(app, 2);
    const res = await del(app, league.members[0].token);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/host/i);
    expect(await count('SELECT count(*) n FROM accounts WHERE deleted_at IS NOT NULL')).toBe(0);
  });

  it('lets a host go once the season is over', async () => {
    const { app } = buildApp(testDb.pool);
    const league = await createLeagueWithPlayers(app, 2);
    await testDb.pool.query("UPDATE rounds SET guessing_deadline = '2000-01-01T00:00:00Z' WHERE league_id = $1", [league.leagueId]);
    expect((await del(app, league.members[0].token)).status).toBe(204);
  });

  it('lets a host who has no other players go', async () => {
    const { app } = buildApp(testDb.pool);
    const league = await createLeagueWithPlayers(app, 1);
    expect((await del(app, league.members[0].token)).status).toBe(204);
  });

  it('asks a passwordless account to type its email instead', async () => {
    const { app } = buildApp(testDb.pool);
    const me = await signUp(app, 'magic@example.com');
    await testDb.pool.query('UPDATE accounts SET password_hash = NULL WHERE id = $1', [me.accountId]);
    expect((await del(app, me.token, {})).status).toBe(400);
    expect((await del(app, me.token, { confirmEmail: 'someone@else.com' })).status).toBe(403);
    expect((await del(app, me.token, { confirmEmail: 'Magic@Example.com' })).status).toBe(204);
  });
});
