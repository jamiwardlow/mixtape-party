import { Router } from 'express';
import type { Pool } from 'pg';
import { hashPassword, signSessionToken } from '../auth.js';
import {
  type AuthTokenPurpose,
  consumeAuthToken,
  isAuthTokenRateLimited,
  issueAuthToken,
  PASSWORD_RESET_TTL_MS,
  SIGN_IN_TTL_MS,
} from '../authTokens.js';
import type { EmailChannel } from '../notifications/types.js';

export interface AuthDeps {
  pool: Pool;
  sessionSecret: string;
  /** Where the emailed links land — the web client's origin, not the API's. */
  appBaseUrl: string;
  emailChannel: EmailChannel;
}

const EMAILED_LINKS: Record<AuthTokenPurpose, { ttlMs: number; title: string; body: (url: string) => string; path: (token: string) => string }> = {
  password_reset: {
    ttlMs: PASSWORD_RESET_TTL_MS,
    title: 'Reset your Mixtape Party password',
    body: (url) => `Set a new password here:\n\n${url}\n\nIf you didn't ask for this, ignore this email.`,
    path: (token) => `/reset-password?token=${token}`,
  },
  sign_in: {
    ttlMs: SIGN_IN_TTL_MS,
    title: 'Your Mixtape Party sign-in link',
    body: (url) => `Sign in here:\n\n${url}\n\nIf you didn't ask for this, ignore this email.`,
    // A fragment, not a query param: the web client renders server-side, so a token in the query
    // string lands in the web service's access logs as a live credential (see #49).
    path: (token) => `/auth/complete#t=${token}`,
  },
};

/**
 * Issues a token and emails the link, unless the account is over a rate limit. Nothing in here —
 * a rate limit, a failed insert, a Resend outage — is reported back to the caller: both request
 * endpoints answer 204 regardless, because any difference between "sent", "rate-limited" and
 * "no such account" tells an attacker whether an address is registered. A 429 on the rate-limit
 * path would undo the whole point of the blanket 204.
 */
async function emailAuthLink(deps: AuthDeps, account: { id: string; email: string }, purpose: AuthTokenPurpose): Promise<void> {
  const link = EMAILED_LINKS[purpose];
  try {
    if (await isAuthTokenRateLimited(deps.pool, account.id)) return;
    const token = await issueAuthToken(deps.pool, account.id, purpose, link.ttlMs);
    const url = `${deps.appBaseUrl}${link.path(token)}`;
    await deps.emailChannel.send(account.email, { title: link.title, body: link.body(url) });
  } catch (err) {
    console.error('auth link email failed', err);
  }
}

export function createAuthRouter(deps: AuthDeps): Router {
  const router = Router();

  router.post('/password-resets', async (req, res) => {
    const { email } = req.body ?? {};
    if (typeof email !== 'string') {
      res.status(400).json({ error: 'email is required' });
      return;
    }
    const { rows } = await deps.pool.query<{ id: string; email: string }>(
      'SELECT id, email FROM accounts WHERE email = $1',
      [email.toLowerCase()],
    );
    if (rows[0]) await emailAuthLink(deps, rows[0], 'password_reset');
    res.status(204).end();
  });

  router.post('/password-resets/confirm', async (req, res) => {
    const { token, password } = req.body ?? {};
    if (typeof token !== 'string' || typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'a token and a password of at least 8 characters are required' });
      return;
    }
    const accountId = await consumeAuthToken(deps.pool, token, 'password_reset');
    if (!accountId) {
      // 401, not 400: the token is the credential being presented, same as a bad password at
      // POST /sessions. 400 is reserved for a malformed body that never reached the check.
      res.status(401).json({ error: 'invalid or expired token' });
      return;
    }
    // No WHERE on the old hash: an account created by magic link or Google has password_hash NULL,
    // and this endpoint is how such a user adds a password.
    await deps.pool.query('UPDATE accounts SET password_hash = $1 WHERE id = $2', [hashPassword(password), accountId]);
    res.json({ accountId, token: signSessionToken(accountId, deps.sessionSecret) });
  });

  router.post('/magic-links', async (req, res) => {
    const { email } = req.body ?? {};
    if (typeof email !== 'string') {
      res.status(400).json({ error: 'email is required' });
      return;
    }
    // Create-or-fetch in one statement: an unknown address becomes a passwordless account rather
    // than an error, which is what keeps the response identical either way.
    // ponytail: the account row is created before the rate-limit check, so spraying distinct
    // addresses still grows `accounts` (it does not send mail — the global cap stops that).
    // Move the global-cap check ahead of the INSERT if junk rows ever become a problem.
    const { rows } = await deps.pool.query<{ id: string; email: string }>(
      `INSERT INTO accounts (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id, email`,
      [email.toLowerCase()],
    );
    await emailAuthLink(deps, rows[0], 'sign_in');
    res.status(204).end();
  });

  // Generic `sign_in` exchange rather than a magic-link-specific route: the Google handoff (#48)
  // redirects with the same kind of token and redeems it here.
  router.post('/sessions/token', async (req, res) => {
    const { token } = req.body ?? {};
    if (typeof token !== 'string') {
      res.status(400).json({ error: 'token is required' });
      return;
    }
    const accountId = await consumeAuthToken(deps.pool, token, 'sign_in');
    if (!accountId) {
      res.status(401).json({ error: 'invalid or expired token' });
      return;
    }
    res.json({ accountId, token: signSessionToken(accountId, deps.sessionSecret) });
  });

  return router;
}
