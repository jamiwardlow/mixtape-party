import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startTestDb, type TestDb } from './testDb.js';
import { buildApp as sharedBuildApp, signUp } from './testHelpers.js';
import { revokeSessionToken } from '../authTokens.js';
import { signSessionToken } from '../auth.js';

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

const buildApp = () => sharedBuildApp(testDb.pool).app;

describe('DELETE /sessions', () => {
  it('makes the presented token stop working', async () => {
    const app = buildApp();
    const { token } = await signUp(app, 'signout@example.com');
    expect((await request(app).get('/accounts/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);

    const res = await request(app).delete('/sessions').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);
    expect((await request(app).get('/accounts/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  // Per-token revocation only means anything if two sessions are two different tokens. The payload
  // is {accountId, exp, nonce} -- drop the nonce and same-millisecond sign-ins collide, which the
  // two-device test below would not catch because scrypt happens to take longer than a millisecond.
  it('mints a distinct token every time, even within one millisecond', () => {
    const tokens = Array.from({ length: 50 }, () => signSessionToken('same-account', 'test-secret'));

    expect(new Set(tokens).size).toBe(tokens.length);
  });

  // The reason this revokes one token rather than bumping an account-wide version: signing out on
  // the phone must not sign the same person out on the laptop.
  it('leaves the account\'s other sessions signed in', async () => {
    const app = buildApp();
    await signUp(app, 'two-devices@example.com');
    const phone = await request(app).post('/sessions').send({ email: 'two-devices@example.com', password: 'password123' });
    const laptop = await request(app).post('/sessions').send({ email: 'two-devices@example.com', password: 'password123' });

    await request(app).delete('/sessions').set('Authorization', `Bearer ${phone.body.token}`);

    expect((await request(app).get('/accounts/me').set('Authorization', `Bearer ${laptop.body.token}`)).status).toBe(200);
  });

  it('answers 401, not 500, when the token was already signed out', async () => {
    const app = buildApp();
    const { token } = await signUp(app, 'twice@example.com');
    await request(app).delete('/sessions').set('Authorization', `Bearer ${token}`);

    const res = await request(app).delete('/sessions').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  // Two tabs signing out at once can both clear the auth guard before either insert lands, and the
  // loser then hits a duplicate token_hash. Exercised directly because the guard sits below HTTP:
  // sequential requests never overlap closely enough to reach it.
  it('tolerates the same token being revoked twice', async () => {
    await expect(
      (async () => {
        await revokeSessionToken(testDb.pool, 'some-token');
        await revokeSessionToken(testDb.pool, 'some-token');
      })(),
    ).resolves.toBeUndefined();
  });

  it('rejects a request with no token', async () => {
    const res = await request(buildApp()).delete('/sessions');

    expect(res.status).toBe(401);
  });
});
