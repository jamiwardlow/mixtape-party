import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

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
