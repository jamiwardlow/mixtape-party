import { createPrivateKey, createPublicKey, randomBytes, sign, verify, type JsonWebKey } from 'node:crypto';
import express, { Router } from 'express';
import { OAUTH_STATE_TTL_MS, signSessionToken, signStateToken, timingSafeStringEqual, verifyStateToken } from '../auth.js';
import { GOOGLE_HANDOFF_TTL_MS, issueAuthToken } from '../authTokens.js';
import { NATIVE_RETURN_URL, findOrCreateAccount, readCookie, type GoogleProfile } from './googleAuth.js';
import type { AppDeps } from '../app.js';

const APPLE_AUTH_URL = 'https://appleid.apple.com/auth/authorize';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const STATE_COOKIE = 'a_state';
const NATIVE_COOKIE = 'a_native';

// Same flow as routes/googleAuth.ts, with the differences Apple forces:
//  - the callback is a cross-site form POST (response_mode=form_post, required to receive the name),
//    so the state cookie must be SameSite=None — Lax is not sent on a cross-site POST;
//  - the display name only ever arrives in that POST's `user` field, on the first sign-in;
//  - the client secret is a short-lived ES256 JWT we sign with the .p8 key.
export function createAppleAuthRouter(deps: AppDeps): Router {
  const router = Router();
  const cookieOptions = { httpOnly: true, secure: true, sameSite: 'none' as const, maxAge: OAUTH_STATE_TTL_MS };

  router.get('/auth/apple/start', (req, res) => {
    const returnTo = req.query.return;
    if (returnTo !== undefined && returnTo !== NATIVE_RETURN_URL) {
      res.status(400).json({ error: 'invalid return target' });
      return;
    }
    const codeChallenge = req.query.code_challenge;
    if (returnTo === NATIVE_RETURN_URL && (typeof codeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge))) {
      res.status(400).json({ error: 'code_challenge is required for native sign-in' });
      return;
    }
    if (!deps.appleClientId || !deps.appleRedirectUri) {
      res.status(503).json({ error: 'apple sign-in is not configured' });
      return;
    }
    const nonce = randomBytes(16).toString('base64url');
    res.cookie(STATE_COOKIE, nonce, cookieOptions);
    if (returnTo === NATIVE_RETURN_URL) res.cookie(NATIVE_COOKIE, '1', cookieOptions);

    const params = new URLSearchParams({
      client_id: deps.appleClientId,
      redirect_uri: deps.appleRedirectUri,
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'name email',
      state: signStateToken(
        nonce,
        deps.sessionSecret,
        returnTo === NATIVE_RETURN_URL,
        returnTo === NATIVE_RETURN_URL ? (codeChallenge as string) : undefined,
      ),
    });
    res.redirect(`${APPLE_AUTH_URL}?${params}`);
  });

  router.post('/auth/apple/callback', express.urlencoded({ extended: false }), async (req, res) => {
    const cookieNonce = readCookie(req.headers.cookie, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, cookieOptions);
    const nativeCookie = readCookie(req.headers.cookie, NATIVE_COOKIE) === '1';
    res.clearCookie(NATIVE_COOKIE, cookieOptions);

    const { code, state, error, user } = (req.body ?? {}) as Record<string, unknown>;
    const verified = typeof state === 'string' ? verifyStateToken(state, deps.sessionSecret) : null;
    const native = verified?.native === true;
    const returnBase = native ? NATIVE_RETURN_URL : `${deps.appBaseUrl}/auth/complete`;
    if (typeof code !== 'string') {
      const reason = error === 'user_cancelled_authorize' ? 'apple_cancelled' : 'apple_failed';
      // 303: the browser must follow a POST with a GET.
      res.redirect(303, native || nativeCookie ? `${NATIVE_RETURN_URL}#error=${reason}` : `${deps.appBaseUrl}/sign-in?error=${reason}`);
      return;
    }

    const stateNonce = verified?.nonce;
    if (!stateNonce || !cookieNonce || !timingSafeStringEqual(stateNonce, cookieNonce)) {
      res.status(400).json({ error: 'invalid state' });
      return;
    }

    let profile: GoogleProfile;
    try {
      profile = await deps.appleTokenExchange(code);
    } catch (err) {
      console.error('apple token exchange failed', err);
      res.status(502).json({ error: 'apple sign-in failed' });
      return;
    }
    // Same takeover guard as Google: an unverified address must never auto-link or create by email.
    if (profile.emailVerified !== true) {
      res.status(403).json({ error: 'apple account email is not verified' });
      return;
    }

    // Untrusted browser input, but only ever used as a display name for a brand-new account.
    if (!profile.name && typeof user === 'string') {
      try {
        const { firstName, lastName } = JSON.parse(user)?.name ?? {};
        profile = { ...profile, name: [firstName, lastName].filter((n) => typeof n === 'string' && n).join(' ').slice(0, 40) || null };
      } catch {
        // A malformed `user` just means no name.
      }
    }

    const accountId = await findOrCreateAccount(deps.pool, profile, 'apple_sub');
    if (!accountId) {
      res.status(409).json({ error: 'email is already linked to a different apple account' });
      return;
    }
    const token = await issueAuthToken(deps.pool, accountId, 'sign_in', GOOGLE_HANDOFF_TTL_MS, verified?.codeChallenge);
    res.redirect(303, `${returnBase}#t=${token}`);
  });

  // Native iOS: the app hands us the identity token from the system sheet. It arrives from the
  // client, so appleIdentityVerifier checks its signature; the name is client-supplied and only
  // ever used for a brand-new account, exactly like the web `user` field.
  router.post('/auth/apple/native', express.json(), async (req, res) => {
    const { identityToken, fullName } = (req.body ?? {}) as { identityToken?: unknown; fullName?: unknown };
    if (typeof identityToken !== 'string') {
      res.status(400).json({ error: 'identityToken is required' });
      return;
    }
    let profile: GoogleProfile;
    try {
      profile = await deps.appleIdentityVerifier(identityToken);
    } catch (err) {
      console.error('apple identity token rejected', err);
      res.status(401).json({ error: 'invalid apple identity token' });
      return;
    }
    if (profile.emailVerified !== true) {
      res.status(403).json({ error: 'apple account email is not verified' });
      return;
    }
    if (!profile.name && typeof fullName === 'string') profile = { ...profile, name: fullName.trim().slice(0, 40) || null };

    const accountId = await findOrCreateAccount(deps.pool, profile, 'apple_sub');
    if (!accountId) {
      res.status(409).json({ error: 'email is already linked to a different apple account' });
      return;
    }
    res.json({ token: signSessionToken(accountId, deps.sessionSecret) });
  });

  return router;
}

const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');

/** The client secret Apple wants: an ES256 JWT, valid for minutes (Apple allows up to 6 months). */
function appleClientSecret(c: { clientId: string; teamId: string; keyId: string; privateKey: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'ES256', kid: c.keyId })}.${b64({ iss: c.teamId, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: c.clientId })}`;
  // ieee-p1363 = the raw r||s signature JWS requires, not Node's default DER.
  const signature = sign('sha256', Buffer.from(input), { key: createPrivateKey(c.privateKey), dsaEncoding: 'ieee-p1363' });
  return `${input}.${signature.toString('base64url')}`;
}

/**
 * Decoded, not signature-verified, for the same reason as the Google exchange: the id_token comes
 * straight from a POST we made to a hardcoded https://appleid.apple.com/auth/token. Do not copy
 * this decode to a token that arrives any other way.
 */
export function createAppleTokenExchange(config: {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
  redirectUri: string;
}) {
  return async (code: string): Promise<GoogleProfile> => {
    const response = await fetch(APPLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: appleClientSecret(config),
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!response.ok) throw new Error(`apple token endpoint returned ${response.status}`);

    const { id_token: idToken } = (await response.json()) as { id_token?: string };
    const payload = idToken?.split('.')[1];
    if (!payload) throw new Error('apple token response had no id_token');

    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub: string;
      email?: string;
      // Apple sends this as the string "true" as often as a boolean.
      email_verified?: boolean | string;
    };
    if (!claims.email) throw new Error('apple id_token had no email');
    return { sub: claims.sub, email: claims.email, emailVerified: String(claims.email_verified) === 'true', name: null };
  };
}

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const JWKS_TTL_MS = 60 * 60 * 1000;

/**
 * Verifies an identity token from the native Sign in with Apple sheet: RS256 signature against
 * Apple's JWKS, then iss, aud (the app bundle id, not the Services ID) and exp.
 */
export function createAppleIdentityVerifier(bundleId: string, fetchKeys: () => Promise<JsonWebKey[]> = fetchAppleKeys) {
  let cache: { keys: JsonWebKey[]; at: number } | undefined;
  const keys = async (refresh: boolean) => {
    // A forged token with a random kid forces a refetch; at most one a minute so abuse can't make us hammer Apple.
    const age = cache ? Date.now() - cache.at : Infinity;
    if (!cache || (refresh && age > 60_000) || age > JWKS_TTL_MS) cache = { keys: await fetchKeys(), at: Date.now() };
    return cache.keys;
  };

  return async (identityToken: string): Promise<GoogleProfile> => {
    const [h, p, sig] = identityToken.split('.');
    if (!h || !p || !sig) throw new Error('malformed identity token');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256') throw new Error(`unexpected alg ${header.alg}`);

    // One refetch on an unknown kid covers Apple rotating keys inside our cache window.
    let jwk = (await keys(false)).find((k) => (k as { kid?: string }).kid === header.kid);
    jwk ??= (await keys(true)).find((k) => (k as { kid?: string }).kid === header.kid);
    if (!jwk) throw new Error('no apple key for kid');
    if (!verify('sha256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'))) {
      throw new Error('bad signature');
    }

    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as {
      iss?: string; aud?: string; exp?: number; sub?: string; email?: string; email_verified?: boolean | string;
    };
    if (claims.iss !== 'https://appleid.apple.com') throw new Error('wrong iss');
    if (claims.aud !== bundleId) throw new Error('wrong aud');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) throw new Error('expired');
    if (!claims.sub || !claims.email) throw new Error('identity token missing sub or email');
    return { sub: claims.sub, email: claims.email, emailVerified: String(claims.email_verified) === 'true', name: null };
  };
}

async function fetchAppleKeys(): Promise<JsonWebKey[]> {
  const response = await fetch(APPLE_JWKS_URL);
  if (!response.ok) throw new Error(`apple jwks returned ${response.status}`);
  return ((await response.json()) as { keys: JsonWebKey[] }).keys;
}
