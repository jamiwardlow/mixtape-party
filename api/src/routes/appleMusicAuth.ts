import { Router } from 'express';
import type { AppleMusicLinkableAdapter, MusicServiceAdapter } from '../adapters/types.js';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';

export interface AppleMusicAuthDeps extends AccountsDeps {
  appleMusicAdapter: MusicServiceAdapter & AppleMusicLinkableAdapter;
}

export function createAppleMusicAuthRouter(deps: AppleMusicAuthDeps): Router {
  const router = Router();

  router.get('/auth/apple-music/developer-token', requireAuth(deps), async (_req, res) => {
    const token = await deps.appleMusicAdapter.getDeveloperToken();
    res.json({ token });
  });

  router.post('/auth/apple-music/callback', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const { musicUserToken } = req.body ?? {};
    if (typeof musicUserToken !== 'string' || musicUserToken.length === 0) {
      res.status(400).json({ error: 'musicUserToken is required' });
      return;
    }

    let profile;
    try {
      profile = await deps.appleMusicAdapter.linkMusicUserToken(musicUserToken);
    } catch {
      res.status(400).json({ error: 'apple music token verification failed' });
      return;
    }

    // access_token holds the Music User Token here, not an OAuth bearer token — Apple Music has no
    // refresh flow, so refresh_token/expires_at stay null for this service.
    await deps.pool.query(
      `INSERT INTO service_links (account_id, service, service_user_id, access_token)
       VALUES ($1, 'apple_music', $2, $3)
       ON CONFLICT (account_id, service) DO UPDATE SET
         service_user_id = EXCLUDED.service_user_id,
         access_token = EXCLUDED.access_token`,
      [accountId, profile.serviceUserId, musicUserToken],
    );

    res.status(201).json({ linked: true, service: 'apple_music', serviceUserId: profile.serviceUserId });
  });

  return router;
}
