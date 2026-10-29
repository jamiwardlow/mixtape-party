import { Router } from 'express';
import type { Pool } from 'pg';
import type { EmailChannel } from '../notifications/types.js';
import { requireAuth, avatarUrlOf, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { guardError, REACTION_TARGETS } from './comments.js';

export interface ModerationDeps extends AccountsDeps {
  emailChannel: EmailChannel;
  /** Where each report is emailed. Unset, reports are still stored, just not sent anywhere. */
  reportEmail?: string;
}

export const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'other'];
const MAX_NOTE = 500;

/** Ids the blocker has blocked: their comments, replies and reactions are left out of the blocker's views. */
export async function blockedIds(pool: Pool, blockerId: string): Promise<Set<string>> {
  const rows = (await pool.query<{ blocked_id: string }>('SELECT blocked_id FROM blocks WHERE blocker_id = $1', [blockerId])).rows;
  return new Set(rows.map((r) => r.blocked_id));
}

// Who wrote the reported thing, and what it said. Membership and "results are open" are checked
// separately by comments.guardError against the same target.
const OFFENDERS = {
  comment: `SELECT guesser_account_id AS account_id, comment AS text FROM guesses WHERE id = $1`,
  reply: `SELECT account_id, body AS text FROM guess_replies WHERE id = $1`,
};

export function createModerationRouter(deps: ModerationDeps): Router {
  const router = Router();
  const authed = (req: unknown) => (req as AuthedRequest).accountId;

  router.post('/reports', requireAuth(deps), async (req, res) => {
    const reporter = authed(req);
    const { targetType, targetId, reason } = req.body ?? {};
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() || null : null;
    if (!['comment', 'reply', 'avatar', 'display_name'].includes(targetType) || typeof targetId !== 'string') {
      res.status(400).json({ error: 'targetType and targetId are required' });
      return;
    }
    if (!REPORT_REASONS.includes(reason)) {
      res.status(400).json({ error: `reason must be one of ${REPORT_REASONS.join(', ')}` });
      return;
    }
    if (note && note.length > MAX_NOTE) {
      res.status(400).json({ error: `note must be ${MAX_NOTE} characters or fewer` });
      return;
    }
    // Ids that aren't UUIDs would 500 in Postgres; they can't match anything, so say not found.
    if (!/^[0-9a-f-]{36}$/i.test(targetId)) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    let offender: { account_id: string; text: string | null } | undefined;
    if (targetType === 'comment' || targetType === 'reply') {
      const column = targetType === 'comment' ? 'guess_id' : 'reply_id';
      const error = await guardError(deps.pool, REACTION_TARGETS[column], targetId, reporter);
      if (error) {
        res.status(error.status).json({ error: error.error });
        return;
      }
      offender = (await deps.pool.query<{ account_id: string; text: string | null }>(OFFENDERS[targetType as 'comment' | 'reply'], [targetId])).rows[0];
    } else {
      // An avatar or name can only be reported by someone who shares a league with its owner.
      offender = (
        await deps.pool.query<{ account_id: string; text: string | null }>(
          `SELECT a.id AS account_id, a.display_name AS text FROM accounts a
           WHERE a.id = $1 AND a.deleted_at IS NULL AND EXISTS (
             SELECT 1 FROM league_members x JOIN league_members y ON y.league_id = x.league_id
             WHERE x.account_id = $2 AND y.account_id = a.id)`,
          [targetId, reporter],
        )
      ).rows[0];
    }
    if (!offender) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (offender.account_id === reporter) {
      res.status(400).json({ error: 'you can’t report yourself' });
      return;
    }
    await deps.pool.query(
      'INSERT INTO reports (reporter_id, reported_account_id, target_type, target_id, reason, note) VALUES ($1, $2, $3, $4, $5, $6)',
      [reporter, offender.account_id, targetType, targetId, reason, note],
    );
    res.status(201).json({ ok: true });

    // After the response, like other notifications: a mail failure must not make a stored report look lost.
    if (!deps.reportEmail) return;
    try {
      await deps.emailChannel.send(deps.reportEmail, {
        title: `Report: ${targetType} (${reason})`,
        body: [
          `Reporter: ${reporter}`,
          `Reported account: ${offender.account_id}`,
          `${targetType} ${targetId}: ${offender.text ?? '(none)'}`,
          note ? `Note: ${note}` : '',
        ].join('\n'),
      });
    } catch (err) {
      console.error('report email failed', err);
    }
  });

  router.get('/blocks', requireAuth(deps), async (req, res) => {
    const rows = (
      await deps.pool.query<{ id: string; display_name: string | null; avatar_updated_at: Date | null }>(
        `SELECT a.id, a.display_name, a.avatar_updated_at FROM blocks b JOIN accounts a ON a.id = b.blocked_id
         WHERE b.blocker_id = $1 ORDER BY b.created_at`,
        [authed(req)],
      )
    ).rows;
    res.json({ blocked: rows.map((r) => ({ accountId: r.id, displayName: r.display_name, avatarUrl: avatarUrlOf(r.id, r.avatar_updated_at) })) });
  });

  // Idempotent. You can only block someone you share a league with, and never yourself.
  router.put('/blocks/:accountId', requireAuth(deps), async (req, res) => {
    const blocker = authed(req);
    const target = req.params.accountId;
    if (!/^[0-9a-f-]{36}$/i.test(target) || target === blocker) {
      res.status(400).json({ error: 'invalid account' });
      return;
    }
    const shared = await deps.pool.query(
      `SELECT 1 FROM league_members x JOIN league_members y ON y.league_id = x.league_id
       WHERE x.account_id = $1 AND y.account_id = $2 LIMIT 1`,
      [blocker, target],
    );
    if (!shared.rowCount) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    await deps.pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [blocker, target]);
    res.status(204).end();
  });

  router.delete('/blocks/:accountId', requireAuth(deps), async (req, res) => {
    if (/^[0-9a-f-]{36}$/i.test(req.params.accountId)) {
      await deps.pool.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [authed(req), req.params.accountId]);
    }
    res.status(204).end();
  });

  return router;
}
