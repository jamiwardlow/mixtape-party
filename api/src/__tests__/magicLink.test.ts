import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, resetTokenFrom, signInTokenFrom, signUp } from './testHelpers.js';
import { startTestDb, type TestDb } from './testDb.js';

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

describe('POST /magic-links', () => {
  it('creates a passwordless account for an unknown email and signs it in', async () => {
    const { app, emailChannel } = buildApp(testDb.pool);

    const requested = await request(app).post('/magic-links').send({ email: 'newcomer@example.com' });
    expect(requested.status).toBe(204);
    expect(emailChannel.sent).toHaveLength(1);

    const exchanged = await request(app)
      .post('/sessions/token')
      .send({ token: signInTokenFrom(emailChannel.sent[0].payload.body) });

    expect(exchanged.status).toBe(200);
    const me = await request(app).get('/accounts/me').set('Authorization', `Bearer ${exchanged.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(exchanged.body.accountId);

    const { rows } = await testDb.pool.query<{ password_hash: string | null }>(
      'SELECT password_hash FROM accounts WHERE email = $1',
      ['newcomer@example.com'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].password_hash).toBeNull();
  });

  it('signs into the existing account for a known email without creating a second one', async () => {
    const { app, emailChannel } = buildApp(testDb.pool);
    const existing = await signUp(app, 'known@example.com');

    await request(app).post('/magic-links').send({ email: 'known@example.com' });
    const exchanged = await request(app)
      .post('/sessions/token')
      .send({ token: signInTokenFrom(emailChannel.sent[0].payload.body) });

    expect(exchanged.body.accountId).toBe(existing.accountId);
    const { rows } = await testDb.pool.query('SELECT id FROM accounts WHERE email = $1', ['known@example.com']);
    expect(rows).toHaveLength(1);
  });

  it('rejects a password sign-in for a passwordless account instead of crashing', async () => {
    const { app } = buildApp(testDb.pool);
    await request(app).post('/magic-links').send({ email: 'no-password@example.com' });

    const res = await request(app).post('/sessions').send({ email: 'no-password@example.com', password: 'anything' });

    expect(res.status).toBe(401);
  });

  it('returns 204 for an unknown email without leaking that it was unknown', async () => {
    const { app } = buildApp(testDb.pool);

    const known = await request(app).post('/magic-links').send({ email: 'a@example.com' });
    const unknown = await request(app).post('/magic-links').send({ email: 'b@example.com' });

    expect(known.status).toBe(204);
    expect(unknown.status).toBe(204);
  });
});

describe('POST /sessions/token', () => {
  it('accepts a sign_in token only once', async () => {
    const { app, emailChannel } = buildApp(testDb.pool);
    await request(app).post('/magic-links').send({ email: 'once@example.com' });
    const token = signInTokenFrom(emailChannel.sent[0].payload.body);

    expect((await request(app).post('/sessions/token').send({ token })).status).toBe(200);
    expect((await request(app).post('/sessions/token').send({ token })).status).toBe(401);
  });

  it('rejects a password_reset token', async () => {
    const { app, emailChannel } = buildApp(testDb.pool);
    await signUp(app, 'purpose@example.com');
    await request(app).post('/password-resets').send({ email: 'purpose@example.com' });
    const resetToken = resetTokenFrom(emailChannel.sent[0].payload.body);

    const res = await request(app).post('/sessions/token').send({ token: resetToken });

    expect(res.status).toBe(401);
  });
});
