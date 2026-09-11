import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { GLOBAL_DAILY_TOKEN_LIMIT, PER_ACCOUNT_TOKEN_LIMIT } from '../authTokens.js';
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

describe('POST /password-resets', () => {
  it('returns 204 and sends nothing for an unknown email', async () => {
    const { app, emailChannel } = buildApp(testDb.pool);

    const res = await request(app).post('/password-resets').send({ email: 'nobody@example.com' });

    expect(res.status).toBe(204);
    expect(emailChannel.sent).toEqual([]);
  });

  it('emails a token that sets a new password and returns a working session', async () => {
    const { app, emailChannel } = buildApp(testDb.pool);
    await signUp(app, 'reset@example.com');

    const requested = await request(app).post('/password-resets').send({ email: 'reset@example.com' });
    expect(requested.status).toBe(204);
    expect(emailChannel.sent).toHaveLength(1);

    const confirmed = await request(app)
      .post('/password-resets/confirm')
      .send({ token: resetTokenFrom(emailChannel.sent[0].payload.body), password: 'brand-new-password' });

    expect(confirmed.status).toBe(200);
    const me = await request(app).get('/accounts/me').set('Authorization', `Bearer ${confirmed.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('reset@example.com');
  });

  it('invalidates the old password', async () => {
    const { app, emailChannel } = buildApp(testDb.pool);
    await signUp(app, 'old-password@example.com');
    await request(app).post('/password-resets').send({ email: 'old-password@example.com' });
    await request(app)
      .post('/password-resets/confirm')
      .send({ token: resetTokenFrom(emailChannel.sent[0].payload.body), password: 'brand-new-password' });

    const res = await request(app)
      .post('/sessions')
      .send({ email: 'old-password@example.com', password: 'password123' });

    expect(res.status).toBe(401);
  });

  it('sets a password on a magic-link account that has none', async () => {
    const { app, emailChannel } = buildApp(testDb.pool);
    await request(app).post('/magic-links').send({ email: 'passwordless@example.com' });
    await request(app).post('/password-resets').send({ email: 'passwordless@example.com' });

    const confirmed = await request(app)
      .post('/password-resets/confirm')
      .send({ token: resetTokenFrom(emailChannel.sent[1].payload.body), password: 'brand-new-password' });

    expect(confirmed.status).toBe(200);
    const signedIn = await request(app)
      .post('/sessions')
      .send({ email: 'passwordless@example.com', password: 'brand-new-password' });
    expect(signedIn.status).toBe(200);
  });

  it('accepts a reset token only once', async () => {
    const { app, emailChannel } = buildApp(testDb.pool);
    await signUp(app, 'single-use@example.com');
    await request(app).post('/password-resets').send({ email: 'single-use@example.com' });
    const token = resetTokenFrom(emailChannel.sent[0].payload.body);

    expect((await request(app).post('/password-resets/confirm').send({ token, password: 'first-password' })).status).toBe(200);
    expect((await request(app).post('/password-resets/confirm').send({ token, password: 'second-password' })).status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const { app, emailChannel } = buildApp(testDb.pool);
    await signUp(app, 'expired@example.com');
    await request(app).post('/password-resets').send({ email: 'expired@example.com' });
    await testDb.pool.query("UPDATE auth_tokens SET expires_at = now() - interval '1 hour'");

    const res = await request(app)
      .post('/password-resets/confirm')
      .send({ token: resetTokenFrom(emailChannel.sent[0].payload.body), password: 'brand-new-password' });

    expect(res.status).toBe(401);
  });

  it('rejects a sign_in token at the reset endpoint', async () => {
    const { app, emailChannel } = buildApp(testDb.pool);
    await signUp(app, 'wrong-purpose@example.com');
    await request(app).post('/magic-links').send({ email: 'wrong-purpose@example.com' });

    const res = await request(app)
      .post('/password-resets/confirm')
      .send({ token: signInTokenFrom(emailChannel.sent[0].payload.body), password: 'brand-new-password' });

    expect(res.status).toBe(401);
    const stillSignedIn = await request(app)
      .post('/sessions')
      .send({ email: 'wrong-purpose@example.com', password: 'password123' });
    expect(stillSignedIn.status).toBe(200);
  });

  it('rejects a short password', async () => {
    const { app, emailChannel } = buildApp(testDb.pool);
    await signUp(app, 'short@example.com');
    await request(app).post('/password-resets').send({ email: 'short@example.com' });

    const res = await request(app)
      .post('/password-resets/confirm')
      .send({ token: resetTokenFrom(emailChannel.sent[0].payload.body), password: 'short' });

    expect(res.status).toBe(400);
  });
});

describe('auth email rate limits', () => {
  it('still returns 204 but sends nothing past the per-account limit', async () => {
    const { app, emailChannel } = buildApp(testDb.pool);
    await signUp(app, 'noisy@example.com');

    for (let i = 0; i < PER_ACCOUNT_TOKEN_LIMIT + 1; i++) {
      const res = await request(app).post('/password-resets').send({ email: 'noisy@example.com' });
      expect(res.status).toBe(204);
    }

    expect(emailChannel.sent).toHaveLength(PER_ACCOUNT_TOKEN_LIMIT);
  });

  it('still returns 204 but sends nothing past the global daily cap', async () => {
    const { app, emailChannel } = buildApp(testDb.pool);
    const { accountId } = await signUp(app, 'bystander@example.com');
    await testDb.pool.query(
      `INSERT INTO auth_tokens (token_hash, account_id, purpose, expires_at)
       SELECT 'filler-' || g, $1, 'sign_in', now() + interval '1 hour' FROM generate_series(1, $2) g`,
      [accountId, GLOBAL_DAILY_TOKEN_LIMIT],
    );

    const res = await request(app).post('/password-resets').send({ email: 'bystander@example.com' });

    expect(res.status).toBe(204);
    expect(emailChannel.sent).toEqual([]);
  });
});
