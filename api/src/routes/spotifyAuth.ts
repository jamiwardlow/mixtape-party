import { randomBytes, createHash } from 'node:crypto';
import { Router } from 'express';
import type { Pool } from 'pg';
import type { MusicServiceAdapter, OAuthLinkableAdapter } from '../adapters/types.js';
import { signState, verifyState } from '../auth.js';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';

const SPOTIFY_LINK_SCOPE = 'playlist-modify-public playlist-modify-private user-read-email';

export interface SpotifyAuthDeps extends AccountsDeps {
  spotifyAdapter: MusicServiceAdapter & OAuthLinkableAdapter;
}

interface OAuthState {
  accountId: string;
  redirectUri: string;
  codeVerifier: string;
}

function codeChallengeFor(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

export function createSpotifyAuthRouter(deps: SpotifyAuthDeps): Router {
  const router = Router();

  router.get('/auth/spotify/authorize-url', requireAuth(deps), (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const redirectUri = req.query.redirectUri;
    if (typeof redirectUri !== 'string') {
      res.status(400).json({ error: 'redirectUri is required' });
      return;
    }
    const codeVerifier = randomBytes(32).toString('base64url');
    const state = signState<OAuthState>({ accountId, redirectUri, codeVerifier }, deps.sessionSecret);
    const url = deps.spotifyAdapter.getAuthorizeUrl({
      codeChallenge: codeChallengeFor(codeVerifier),
      redirectUri,
      state,
      scope: SPOTIFY_LINK_SCOPE,
    });
    res.json({ url, state });
  });

  router.post('/auth/spotify/callback', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const { code, state } = req.body ?? {};
    if (typeof code !== 'string' || typeof state !== 'string') {
      res.status(400).json({ error: 'code and state are required' });
      return;
    }
    const decoded = verifyState<OAuthState>(state, deps.sessionSecret);
    if (!decoded || decoded.accountId !== accountId) {
      res.status(400).json({ error: 'invalid or expired state' });
      return;
    }

    let tokens;
    try {
      tokens = await deps.spotifyAdapter.exchangeAuthorizationCode({
        code,
        codeVerifier: decoded.codeVerifier,
        redirectUri: decoded.redirectUri,
      });
    } catch {
      res.status(400).json({ error: 'spotify token exchange failed' });
      return;
    }
    const profile = await deps.spotifyAdapter.getProfile(tokens.accessToken);

    await deps.pool.query(
      `INSERT INTO service_links (account_id, service, service_user_id, access_token, refresh_token, expires_at, scope)
       VALUES ($1, 'spotify', $2, $3, $4, now() + ($5 || ' seconds')::interval, $6)
       ON CONFLICT (account_id, service) DO UPDATE SET
         service_user_id = EXCLUDED.service_user_id,
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         scope = EXCLUDED.scope`,
      [accountId, profile.serviceUserId, tokens.accessToken, tokens.refreshToken, tokens.expiresIn, tokens.scope],
    );

    res.status(201).json({ linked: true, service: 'spotify', serviceUserId: profile.serviceUserId });
  });

  return router;
}
