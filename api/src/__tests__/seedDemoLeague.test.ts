import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DEMO_EMAIL, seedDemo } from '../scripts/seedDemoLeague.js';
import { startTestDb, type TestDb } from './testDb.js';
import { buildApp } from './testHelpers.js';

let testDb: TestDb;
beforeAll(async () => {
  testDb = await startTestDb();
}, 60_000);
afterAll(async () => {
  await testDb.teardown();
});

describe('seedDemo', () => {
  it('builds leagues the real API serves, in each phase the screenshots need, and is re-runnable', async () => {
    await seedDemo(testDb.pool, 'demo-password-1');
    await seedDemo(testDb.pool, 'demo-password-1'); // wipes and rebuilds without a unique violation
    const { app, pushChannel, emailChannel } = buildApp(testDb.pool);

    const login = await request(app).post('/sessions').send({ email: DEMO_EMAIL, password: 'demo-password-1' });
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.token}` };

    const mine = (await request(app).get('/leagues/mine').set(auth)).body.leagues;
    expect(mine.map((l: { name: string }) => l.name).sort()).toEqual(['Friday Night Mixtape', 'Office Jukebox', 'Summer Road Trip']);
    expect(mine.find((l: { name: string }) => l.name === 'Summer Road Trip').concluded).toBe(true);

    const phases = await testDb.pool.query(
      `SELECT l.invite_code, r.round_number,
              CASE WHEN now() < r.submission_deadline THEN 'submission' WHEN now() < r.guessing_deadline THEN 'guessing' ELSE 'results' END AS phase
       FROM rounds r JOIN leagues l ON l.id = r.league_id WHERE l.invite_code IN ('DEMOFRI', 'DEMOJUKE') ORDER BY 1, 2`,
    );
    expect(phases.rows.map((r) => `${r.invite_code}:${r.round_number}:${r.phase}`)).toEqual([
      'DEMOFRI:1:results', 'DEMOFRI:2:results', 'DEMOFRI:3:guessing', 'DEMOFRI:4:submission',
      'DEMOJUKE:1:results', 'DEMOJUKE:2:submission', 'DEMOJUKE:3:submission',
    ]);

    // Results screen: a finished round has scores and nobody won by guessing everything or nothing.
    const round = await testDb.pool.query("SELECT r.id FROM rounds r JOIN leagues l ON l.id = r.league_id WHERE l.invite_code = 'DEMOFRI' AND round_number = 1");
    const results = await request(app).get(`/rounds/${round.rows[0].id}/results`).set(auth);
    expect(results.status).toBe(200);
    const scores = results.body.scores.map((s: { score: number }) => s.score);
    expect(Math.max(...scores)).toBeGreaterThan(Math.min(...scores));

    // Demo has not submitted to Office Jukebox round 2 and has not guessed in Friday Night round 3.
    const open = await testDb.pool.query(
      `SELECT (SELECT count(*) FROM submissions s JOIN accounts a ON a.id = s.account_id JOIN rounds r ON r.id = s.round_id JOIN leagues l ON l.id = r.league_id
                WHERE a.email = $1 AND l.invite_code = 'DEMOJUKE' AND r.round_number = 2) AS submitted,
              (SELECT count(*) FROM guesses g JOIN accounts a ON a.id = g.guesser_account_id JOIN submissions s ON s.id = g.submission_id
                JOIN rounds r ON r.id = s.round_id JOIN leagues l ON l.id = r.league_id
                WHERE a.email = $1 AND l.invite_code = 'DEMOFRI' AND r.round_number = 3) AS guessed`,
      [DEMO_EMAIL],
    );
    expect(open.rows[0]).toEqual({ submitted: '0', guessed: '0' });

    // The sweep must not email or push anyone: every demo account opts out and every round is flagged handled.
    const swept = await request(app).post('/internal/sweep').set('x-sweep-secret', 'test-sweep-secret');
    expect(swept.status).toBeLessThan(300);
    expect(emailChannel.sent).toHaveLength(0);
    expect(pushChannel.sent).toHaveLength(0);
  });
});
