import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import { signSessionToken, verifySessionToken } from '../auth.js';
import { buildApp } from './testHelpers.js';
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

/** A pool whose queries reject, standing in for the Resend/Google calls the auth work will add. */
function rejectingPool(): Pool {
  return { query: () => Promise.reject(new Error('boom: secret connection string')) } as unknown as Pool;
}

describe('createApp appBaseUrl guard', () => {
  it('refuses a schemeless value rather than emitting relative redirects', () => {
    expect(() => buildApp(rejectingPool(), { appBaseUrl: 'mixtape-party.com' })).toThrow(/mixtape-party\.com/);
  });

  it('accepts an uppercase scheme, which is still absolute', () => {
    expect(() => buildApp(rejectingPool(), { appBaseUrl: 'HTTPS://app.test' })).not.toThrow();
  });

  it('strips a trailing slash so redirects do not double up', async () => {
    const { app } = buildApp(rejectingPool(), { appBaseUrl: 'https://app.test/' });

    const res = await request(app).get('/auth/google/callback?error=access_denied');

    expect(res.headers.location).toBe('https://app.test/sign-in?error=google_cancelled');
  });
});

describe('error middleware', () => {
  it('turns a rejected handler into a 500 without leaking the error message', async () => {
    const { app } = buildApp(rejectingPool());

    const res = await request(app)
      .post('/sessions')
      .send({ email: 'someone@example.com', password: 'password123' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal' });
    expect(JSON.stringify(res.body)).not.toContain('secret connection string');
  });
});

describe('POST /sessions with a passwordless account', () => {
  it('returns 401 rather than throwing on a null password_hash', async () => {
    // The auth work makes password_hash nullable; anticipate it here so the guard is exercised.
    // This test file runs against its own Postgres instance, so the ALTER stays local to it.
    await testDb.pool.query('ALTER TABLE accounts ALTER COLUMN password_hash DROP NOT NULL');
    await testDb.pool.query(
      'INSERT INTO accounts (email, password_hash, display_name) VALUES ($1, $2, $3)',
      ['passwordless@example.com', null, 'Passwordless'],
    );
    const { app } = buildApp(testDb.pool);

    const res = await request(app)
      .post('/sessions')
      .send({ email: 'passwordless@example.com', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid email or password' });
  });
});

describe('verifySessionToken', () => {
  it('returns null for a signature containing a multi-byte character', () => {
    const [encoded] = signSessionToken('account-1', 'test-secret').split('.');
    // 43 characters, but more than 43 bytes: timingSafeEqual throws RangeError on a byte-length mismatch.
    const multiByteSignature = 'é'.repeat(43);

    expect(() => verifySessionToken(`${encoded}.${multiByteSignature}`, 'test-secret')).not.toThrow();
    expect(verifySessionToken(`${encoded}.${multiByteSignature}`, 'test-secret')).toBeNull();
  });

  it('still accepts a valid token and rejects a tampered one', () => {
    const token = signSessionToken('account-1', 'test-secret');
    const [encoded] = token.split('.');

    expect(verifySessionToken(token, 'test-secret')).toBe('account-1');
    expect(verifySessionToken(`${encoded}.wrongsignature`, 'test-secret')).toBeNull();
  });
});
