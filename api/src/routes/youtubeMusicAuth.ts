import { Router } from 'express';
import { ServiceUnavailableError, type MusicServiceAdapter, type YouTubeMusicLinkableAdapter } from '../adapters/types.js';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';

export interface YouTubeMusicAuthDeps extends AccountsDeps {
  youtubeMusicAdapter: MusicServiceAdapter & YouTubeMusicLinkableAdapter;
}

export function createYouTubeMusicAuthRouter(deps: YouTubeMusicAuthDeps): Router {
  const router = Router();

  router.post('/auth/youtube-music/callback', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const { cookie } = req.body ?? {};
    if (typeof cookie !== 'string' || cookie.length === 0) {
      res.status(400).json({ error: 'cookie is required' });
      return;
    }

    let profile;
    try {
      profile = await deps.youtubeMusicAdapter.linkCookie(cookie);
    } catch (err) {
      if (err instanceof ServiceUnavailableError) {
        res.status(503).json({ error: 'search unavailable' });
        return;
      }
      res.status(400).json({ error: 'youtube music cookie verification failed' });
      return;
    }

    // access_token holds the raw session cookie here, not an OAuth bearer token — the unofficial
    // API has no refresh flow, so refresh_token/expires_at stay null for this service.
    await deps.pool.query(
      `INSERT INTO service_links (account_id, service, service_user_id, access_token)
       VALUES ($1, 'youtube_music', $2, $3)
       ON CONFLICT (account_id, service) DO UPDATE SET
         service_user_id = EXCLUDED.service_user_id,
         access_token = EXCLUDED.access_token`,
      [accountId, profile.serviceUserId, cookie],
    );

    res.status(201).json({ linked: true, service: 'youtube_music', serviceUserId: profile.serviceUserId });
  });

  return router;
}
