import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Pool } from 'pg';
import { OAUTH_STATE_TTL_MS, signStateToken, timingSafeStringEqual, verifyStateToken } from '../auth.js';
import { GOOGLE_HANDOFF_TTL_MS, issueAuthToken } from '../authTokens.js';

/** The claims we take off Google's `id_token` — everything the sign-in flow needs, nothing else. */
export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

export interface GoogleAuthDeps {
  pool: Pool;
  sessionSecret: string;
  appBaseUrl: string;
  googleClientId?: string;
  googleRedirectUri?: string;
  googleTokenExchange: (code: string) => Promise<GoogleProfile>;
}

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const STATE_COOKIE = 'g_state';

// ponytail: bare `name=value` split, so no RFC 6265 quoted values — fine for the one base64url
// nonce we set. Add cookie-parser if this app ever reads a cookie it did not write.
function readCookie(header: string | undefined, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

/**
 * `sub` first, never email. Google's `sub` is the stable identifier, so a user changing their Gmail
 * address is a non-event — and `accounts.email` is deliberately never updated from a later sign-in:
 * the unique constraint would throw if the new address already belonged to someone else, and
 * silently moving a login identifier is worse than leaving it stale.
 *
 * Returns null when the email belongs to an account already linked to a *different* Google sub.
 */
async function findOrCreateAccount(pool: Pool, profile: GoogleProfile): Promise<string | null> {
  const existing = await pool.query<{ id: string }>('SELECT id FROM accounts WHERE google_sub = $1', [profile.sub]);
  if (existing.rows[0]) return existing.rows[0].id;

  // Auto-linking onto an existing password account is safe precisely because the caller proved
  // email_verified. The WHERE is what makes it safe against a *second* Google identity claiming the
  // same address: COALESCE alone would leave the original google_sub in place but still return the
  // victim's id, which signs the stranger straight into their account.
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO accounts (email, google_sub, display_name) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET google_sub = COALESCE(accounts.google_sub, EXCLUDED.google_sub)
     WHERE accounts.google_sub IS NULL OR accounts.google_sub = EXCLUDED.google_sub
     RETURNING id`,
    [profile.email.toLowerCase(), profile.sub, profile.name],
  );
  return rows[0]?.id ?? null;
}

export function createGoogleAuthRouter(deps: GoogleAuthDeps): Router {
  const router = Router();

  router.get('/auth/google/start', (_req, res) => {
    if (!deps.googleClientId || !deps.googleRedirectUri) {
      res.status(503).json({ error: 'google sign-in is not configured' });
      return;
    }

    // The cookie, not the signature, is what binds this flow to one browser. A signed-but-otherwise
    // empty state is a bearer value: an attacker starts the flow, lifts `state` off the Location
    // header, consents as themselves, then walks the victim's browser through the callback — and
    // the victim is now silently signed in as the attacker.
    const nonce = randomBytes(16).toString('base64url');
    // Lax, not Strict/None: the callback is a top-level GET navigation to this API's own origin, so
    // Lax still sends the cookie, and None would make it a cross-site bearer again.
    res.cookie(STATE_COOKIE, nonce, {
      httpOnly: true,
      // Taken from the configured redirect URI's scheme rather than hardcoded: Safari drops a
      // Secure cookie on plain http://localhost, which would dead-end local sign-in at "invalid
      // state". Any real deployment registers an https redirect URI, so this stays on in prod.
      secure: deps.googleRedirectUri.startsWith('https:'),
      sameSite: 'lax',
      // Same clock as the signed state itself — a cookie outliving the token buys nothing.
      maxAge: OAUTH_STATE_TTL_MS,
    });

    const params = new URLSearchParams({
      client_id: deps.googleClientId,
      // From config, never req.headers.host — a forged Host header would send the authorization
      // code to an origin of the attacker's choosing.
      redirect_uri: deps.googleRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: signStateToken(nonce, deps.sessionSecret),
    });
    res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
  });

  router.get('/auth/google/callback', async (req, res) => {
    const cookieNonce = readCookie(req.headers.cookie, STATE_COOKIE);
    // One shot either way: cleared before any branch can return.
    res.clearCookie(STATE_COOKIE);

    const { code, state, error } = req.query;
    if (typeof code !== 'string') {
      // `?error=access_denied` with no code is the user clicking cancel on the consent screen —
      // an ordinary outcome, not a server fault.
      const reason = error === 'access_denied' ? 'google_cancelled' : 'google_failed';
      res.redirect(`${deps.appBaseUrl}/sign-in?error=${reason}`);
      return;
    }

    const stateNonce = typeof state === 'string' ? verifyStateToken(state, deps.sessionSecret) : null;
    if (!stateNonce || !cookieNonce || !timingSafeStringEqual(stateNonce, cookieNonce)) {
      res.status(400).json({ error: 'invalid state' });
      return;
    }

    let profile: GoogleProfile;
    try {
      profile = await deps.googleTokenExchange(code);
    } catch (err) {
      console.error('google token exchange failed', err);
      res.status(502).json({ error: 'google sign-in failed' });
      return;
    }

    // The line the rest of this handler rests on. Until Google says the address is verified it is
    // an attacker-controlled string, and both the auto-link and the create-by-email path below
    // become account takeover by typing someone else's address into a Google profile.
    if (profile.emailVerified !== true) {
      res.status(403).json({ error: 'google account email is not verified' });
      return;
    }

    const accountId = await findOrCreateAccount(deps.pool, profile);
    if (!accountId) {
      res.status(409).json({ error: 'email is already linked to a different google account' });
      return;
    }

    // Reuses the existing `sign_in` token exchange rather than minting a session here, so there is
    // exactly one way to turn a redirect into a session. Fragment, not query param: the web service
    // logs query strings, and this token is a live credential until POST /sessions/token burns it.
    const token = await issueAuthToken(deps.pool, accountId, 'sign_in', GOOGLE_HANDOFF_TTL_MS);
    res.redirect(`${deps.appBaseUrl}/auth/complete#t=${token}`);
  });

  return router;
}

/**
 * The real exchange: one POST, then read the claims off the `id_token`.
 *
 * The token is decoded, not signature-verified, and that is correct *here specifically*. It arrives
 * in the body of a POST we made ourselves, to a hardcoded https://oauth2.googleapis.com/token, over
 * a TLS connection Node validated, authenticated with our client secret. There is no untrusted
 * party anywhere in that path, and Google's own documentation explicitly permits skipping
 * verification for tokens received directly from the token endpoint — a JWKS fetch would buy
 * nothing but a dependency.
 *
 * This does NOT generalise. An `id_token` arriving from a client, a redirect or a webhook has an
 * untrusted party in the path and its signature must be verified. Do not copy this decode there.
 */
export function createGoogleTokenExchange(config: { clientId: string; clientSecret: string; redirectUri: string }) {
  return async (code: string): Promise<GoogleProfile> => {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!response.ok) throw new Error(`google token endpoint returned ${response.status}`);

    const { id_token: idToken } = (await response.json()) as { id_token?: string };
    const payload = idToken?.split('.')[1];
    if (!payload) throw new Error('google token response had no id_token');

    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub: string;
      email: string;
      email_verified?: boolean;
      name?: string;
    };
    return {
      sub: claims.sub,
      email: claims.email,
      emailVerified: claims.email_verified === true,
      name: claims.name ?? null,
    };
  };
}
