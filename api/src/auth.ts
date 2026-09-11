import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Signs a payload with an expiry, HMAC'd with a server secret. No server-side session/state store needed. */
function signPayload<T extends object>(payload: T, secret: string, ttlMs: number): string {
  const withExpiry = { ...payload, exp: Date.now() + ttlMs };
  const encoded = Buffer.from(JSON.stringify(withExpiry)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

/**
 * Constant-time compare. Byte lengths, not string lengths: a multi-byte character makes the two
 * differ, and timingSafeEqual throws RangeError rather than returning false on a length mismatch.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifyPayload<T>(token: string, secret: string): T | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
  if (!timingSafeStringEqual(expected, signature)) return null;
  const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T & { exp: number };
  if (Date.now() > decoded.exp) return null;
  return decoded;
}

export function signSessionToken(accountId: string, secret: string): string {
  return signPayload({ accountId }, secret, SESSION_TTL_MS);
}

export function verifySessionToken(token: string, secret: string): string | null {
  return verifyPayload<{ accountId: string }>(token, secret)?.accountId ?? null;
}

// Long enough to walk through Google's consent screen, short enough that a state token lifted from
// a browser's history is dead by the time anyone replays it. Exported because the g_state cookie
// must expire on the same clock — two separate constants would drift apart.
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Signs the `state` for an OAuth round trip. Narrow wrapper on purpose: signPayload stays private. */
export function signStateToken(nonce: string, secret: string): string {
  return signPayload({ nonce }, secret, OAUTH_STATE_TTL_MS);
}

/** Returns the nonce the state was signed with, or null if the signature is bad or it has expired. */
export function verifyStateToken(token: string, secret: string): string | null {
  return verifyPayload<{ nonce: string }>(token, secret)?.nonce ?? null;
}
