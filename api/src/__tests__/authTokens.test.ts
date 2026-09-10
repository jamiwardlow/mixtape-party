import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { consumeAuthToken, issueAuthToken, PASSWORD_RESET_TTL_MS, SIGN_IN_TTL_MS } from '../authTokens.js';
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

async function createAccount(): Promise<string> {
  const { rows } = await testDb.pool.query<{ id: string }>(
    "INSERT INTO accounts (email, password_hash) VALUES ('token@example.com', NULL) RETURNING id",
  );
  return rows[0].id;
}

describe('auth tokens', () => {
  it('issues a token that consumes to the account id', async () => {
    const accountId = await createAccount();
    const token = await issueAuthToken(testDb.pool, accountId, 'password_reset', PASSWORD_RESET_TTL_MS);

    expect(await consumeAuthToken(testDb.pool, token, 'password_reset')).toBe(accountId);
  });

  it('stores only the hash, never the plaintext token', async () => {
    const accountId = await createAccount();
    const token = await issueAuthToken(testDb.pool, accountId, 'password_reset', PASSWORD_RESET_TTL_MS);

    const { rows } = await testDb.pool.query<{ token_hash: string }>('SELECT token_hash FROM auth_tokens');
    expect(rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('accepts a token only once', async () => {
    const accountId = await createAccount();
    const token = await issueAuthToken(testDb.pool, accountId, 'password_reset', PASSWORD_RESET_TTL_MS);

    expect(await consumeAuthToken(testDb.pool, token, 'password_reset')).toBe(accountId);
    expect(await consumeAuthToken(testDb.pool, token, 'password_reset')).toBeNull();
  });

  it('rejects a token presented for the wrong purpose and leaves it unused', async () => {
    const accountId = await createAccount();
    const token = await issueAuthToken(testDb.pool, accountId, 'sign_in', SIGN_IN_TTL_MS);

    expect(await consumeAuthToken(testDb.pool, token, 'password_reset')).toBeNull();
    expect(await consumeAuthToken(testDb.pool, token, 'sign_in')).toBe(accountId);
  });

  it('rejects an expired token', async () => {
    const accountId = await createAccount();
    const token = await issueAuthToken(testDb.pool, accountId, 'sign_in', -1000);

    expect(await consumeAuthToken(testDb.pool, token, 'sign_in')).toBeNull();
  });

  it('rejects a token that was never issued', async () => {
    expect(await consumeAuthToken(testDb.pool, 'never-issued', 'sign_in')).toBeNull();
  });
});
