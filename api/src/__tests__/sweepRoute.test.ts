import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startTestDb, type TestDb } from './testDb.js';
import { buildApp } from './testHelpers.js';

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

// A round past 80% of its submission window with a member who hasn't submitted: the sweep's
// observable effect is the reminder notification it inserts.
async function seedDueReminder() {
  const { rows } = await testDb.pool.query<{ id: string }>(
    "INSERT INTO accounts (email, password_hash) VALUES ('s@example.com', 'hash') RETURNING id",
  );
  const league = await testDb.pool.query<{ id: string }>(
    "INSERT INTO leagues (name, season_length, host_account_id, invite_code) VALUES ('L', 8, $1, 'code') RETURNING id",
    [rows[0].id],
  );
  await testDb.pool.query('INSERT INTO league_members (league_id, account_id) VALUES ($1, $2)', [league.rows[0].id, rows[0].id]);
  const now = Date.now();
  await testDb.pool.query(
    `INSERT INTO rounds (league_id, round_number, theme, submission_deadline, guessing_deadline, created_at)
     VALUES ($1, 1, 'T', $2, $3, $4)`,
    [league.rows[0].id, new Date(now + 3_600_000), new Date(now + 7 * 86_400_000), new Date(now - 86_400_000)],
  );
}

const count = async () => Number((await testDb.pool.query('SELECT count(*) FROM notifications')).rows[0].count);

describe('POST /internal/sweep', () => {
  it('401s without the header', async () => {
    const { app } = buildApp(testDb.pool);
    expect((await request(app).post('/internal/sweep')).status).toBe(401);
  });

  it('401s with the wrong header, and does not sweep', async () => {
    const { app } = buildApp(testDb.pool);
    await seedDueReminder();
    const res = await request(app).post('/internal/sweep').set('x-sweep-secret', 'nope');
    expect(res.status).toBe(401);
    expect(await count()).toBe(0);
  });

  it('503s when no secret is configured, even with a header', async () => {
    const { app } = buildApp(testDb.pool, { sweepSecret: null });
    expect((await request(app).post('/internal/sweep').set('x-sweep-secret', '')).status).toBe(503);
    expect((await request(app).post('/internal/sweep').set('x-sweep-secret', 'anything')).status).toBe(503);
  });

  it('200s and runs the sweep with the right header', async () => {
    const { app } = buildApp(testDb.pool);
    await seedDueReminder();
    const res = await request(app).post('/internal/sweep').set('x-sweep-secret', 'test-sweep-secret');
    expect(res.status).toBe(200);
    expect(await count()).toBeGreaterThan(0);
  });
});
