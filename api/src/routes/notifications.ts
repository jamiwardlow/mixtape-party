import { Router } from 'express';
import { type AccountsDeps, type AuthedRequest, requireAuth } from './accounts.js';

export function createNotificationsRouter(deps: AccountsDeps): Router {
  const router = Router();
  const auth = requireAuth(deps);

  router.get('/notifications', auth, async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const result = await deps.pool.query(
      `SELECT id, type, round_id AS "roundId", league_id AS "leagueId", title, body, read_at AS "readAt", created_at AS "createdAt"
       FROM notifications WHERE account_id = $1 ORDER BY created_at DESC`,
      [accountId],
    );
    res.json({ notifications: result.rows });
  });

  router.post('/notifications/:id/read', auth, async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const result = await deps.pool.query(
      'UPDATE notifications SET read_at = now() WHERE id = $1 AND account_id = $2 AND read_at IS NULL RETURNING id',
      [req.params.id, accountId],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'notification not found' });
      return;
    }
    res.json({ ok: true });
  });

  router.get('/notifications/settings', auth, async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const result = await deps.pool.query<{ push_enabled: boolean; email_enabled: boolean }>(
      'SELECT push_enabled, email_enabled FROM notification_settings WHERE account_id = $1',
      [accountId],
    );
    const settings = result.rows[0];
    res.json({ pushEnabled: settings?.push_enabled ?? true, emailEnabled: settings?.email_enabled ?? true });
  });

  router.put('/notifications/settings', auth, async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const { pushEnabled, emailEnabled } = req.body ?? {};
    if (
      (pushEnabled !== undefined && typeof pushEnabled !== 'boolean') ||
      (emailEnabled !== undefined && typeof emailEnabled !== 'boolean') ||
      (pushEnabled === undefined && emailEnabled === undefined)
    ) {
      res.status(400).json({ error: 'pushEnabled and/or emailEnabled must be provided as booleans' });
      return;
    }
    const result = await deps.pool.query<{ push_enabled: boolean; email_enabled: boolean }>(
      `INSERT INTO notification_settings (account_id, push_enabled, email_enabled)
       VALUES ($1, COALESCE($2, true), COALESCE($3, true))
       ON CONFLICT (account_id) DO UPDATE SET
         push_enabled = COALESCE($2, notification_settings.push_enabled),
         email_enabled = COALESCE($3, notification_settings.email_enabled)
       RETURNING push_enabled, email_enabled`,
      [accountId, pushEnabled ?? null, emailEnabled ?? null],
    );
    res.json({ pushEnabled: result.rows[0].push_enabled, emailEnabled: result.rows[0].email_enabled });
  });

  router.post('/notifications/push-tokens', auth, async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const { platform, token } = req.body ?? {};
    if ((platform !== 'expo' && platform !== 'web') || typeof token !== 'string' || token.length === 0) {
      res.status(400).json({ error: 'platform must be "expo" or "web" and token is required' });
      return;
    }
    await deps.pool.query(
      'INSERT INTO push_tokens (account_id, platform, token) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [accountId, platform, token],
    );
    res.status(201).json({ ok: true });
  });

  return router;
}
