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
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — OAuth linking is a single short-lived round trip

/** Signs a payload with an expiry, HMAC'd with a server secret. No server-side session/state store needed. */
function signPayload<T extends object>(payload: T, secret: string, ttlMs: number): string {
  const withExpiry = { ...payload, exp: Date.now() + ttlMs };
  const encoded = Buffer.from(JSON.stringify(withExpiry)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyPayload<T>(token: string, secret: string): T | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(encoded).digest('base64url'));
  const actual = Buffer.from(signature);
  // Byte lengths, not string lengths: a multi-byte character makes these differ, and
  // timingSafeEqual throws RangeError rather than returning false on a length mismatch.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
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

/** Signs an arbitrary short-lived payload (used for OAuth `state`) so no server-side state store is needed. */
export function signState<T extends object>(payload: T, secret: string): string {
  return signPayload(payload, secret, STATE_TTL_MS);
}

export function verifyState<T>(state: string, secret: string): T | null {
  return verifyPayload<T>(state, secret);
}
