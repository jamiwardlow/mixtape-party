import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { SESSION_TTL_MS } from './auth.js';

export type AuthTokenPurpose = 'password_reset' | 'sign_in';

// Deliberately generous: both Render services are on the free plan and cold-start in 30-60s, and
// the web client blocks on two @expo-google-fonts packages before it renders. Single use, enforced
// atomically in consumeAuthToken, is the actual protection here — not the clock.
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export const SIGN_IN_TTL_MS = 15 * 60 * 1000;
export const GOOGLE_HANDOFF_TTL_MS = 10 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issues a single-use token and returns the plaintext exactly once — only its sha256 is stored, so
 * a leaked database dump is not a pile of usable reset links and the value is never readable again.
 */
export async function issueAuthToken(
  pool: Pool,
  accountId: string,
  purpose: AuthTokenPurpose,
  ttlMs: number,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO auth_tokens (token_hash, account_id, purpose, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
    [hashToken(token), accountId, purpose, ttlMs / 1000],
  );
  // ponytail: opportunistic sweep on the write path so the table doesn't grow forever — costs every
  // issue an extra round trip. Move it into runNotificationSweep's interval if that shows up.
  await pool.query("DELETE FROM auth_tokens WHERE expires_at < now() - interval '1 day'");
  return token;
}

/** Returns the account id and burns the token, or null if it is unknown, used, expired or for another purpose. */
export async function consumeAuthToken(
  pool: Pool,
  token: string,
  purpose: AuthTokenPurpose,
): Promise<string | null> {
  // One atomic statement, never read-then-write. Every predicate is load-bearing: `purpose` stops a
  // magic link being redeemed at the password-reset endpoint, `used_at IS NULL` inside the UPDATE
  // makes single use race-proof, and `expires_at` puts expiry on the database's clock.
  const { rows } = await pool.query<{ account_id: string }>(
    `UPDATE auth_tokens SET used_at = now()
     WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING account_id`,
    [hashToken(token), purpose],
  );
  return rows[0]?.account_id ?? null;
}

export const PER_ACCOUNT_TOKEN_LIMIT = 3;
export const PER_ACCOUNT_TOKEN_WINDOW_MINUTES = 15;
// Resend's free tier is 100 emails/day, and the per-account limit does nothing against someone
// spraying 10,000 distinct addresses. Without this cap an attacker exhausts the quota and every
// legitimate password reset silently stops arriving.
export const GLOBAL_DAILY_TOKEN_LIMIT = 90;

/**
 * True when another token for this account would exceed the per-account or global cap.
 * Counted in SQL against `auth_tokens`, never in memory — Render can run more than one instance,
 * and an in-memory counter silently multiplies the limit by the instance count.
 */
export async function isAuthTokenRateLimited(pool: Pool, accountId: string): Promise<boolean> {
  const { rows } = await pool.query<{ limited: boolean }>(
    `SELECT
       (SELECT count(*) FROM auth_tokens
         WHERE account_id = $1 AND used_at IS NULL AND expires_at > now()
           AND created_at > now() - make_interval(mins => $2)) >= $3
       OR
       (SELECT count(*) FROM auth_tokens WHERE created_at > now() - interval '1 day') >= $4
       AS limited`,
    [accountId, PER_ACCOUNT_TOKEN_WINDOW_MINUTES, PER_ACCOUNT_TOKEN_LIMIT, GLOBAL_DAILY_TOKEN_LIMIT],
  );
  return rows[0].limited;
}

/** Revokes exactly the token presented — sign-out on one device, not everywhere. See revoked_sessions in schema.sql. */
export async function revokeSessionToken(pool: Pool, token: string): Promise<void> {
  // ON CONFLICT DO NOTHING: two tabs signing out, or a retry after a flaky response, must not 500.
  await pool.query('INSERT INTO revoked_sessions (token_hash) VALUES ($1) ON CONFLICT DO NOTHING', [hashToken(token)]);
  // ponytail: opportunistic sweep on the (rare) sign-out path, same shape as issueAuthToken's. Once
  // a row is older than a full session TTL the token it guards has certainly expired on its own.
  await pool.query('DELETE FROM revoked_sessions WHERE revoked_at < now() - make_interval(secs => $1)', [
    SESSION_TTL_MS / 1000,
  ]);
}

/** True when this token has been signed out. Runs on every authenticated request. */
export async function isSessionTokenRevoked(pool: Pool, token: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT 1 FROM revoked_sessions WHERE token_hash = $1', [hashToken(token)]);
  return rows.length > 0;
}
