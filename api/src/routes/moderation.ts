import { Router } from 'express';
import type { EmailChannel } from '../notifications/types.js';
import { requireAuth, avatarUrlOf, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { isUuid, sharesLeague } from './blocks.js';
import { guardError, REACTION_TARGETS } from './comments.js';

export interface ModerationDeps extends AccountsDeps {
  emailChannel: EmailChannel;
  /** Where each report is emailed. Unset, reports are still stored, just not sent anywhere. */
  reportEmail?: string;
}

export const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'other'];
const MAX_NOTE = 500;
// Most reports one account can file per hour; a human reporting in good faith never gets near it.
const REPORTS_PER_HOUR = 20;
const TARGET_TYPES = ['comment', 'reply', 'avatar', 'display_name'];

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
    if (!TARGET_TYPES.includes(targetType) || typeof targetId !== 'string') {
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
    if (!isUuid(targetId)) {
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
      offender = (await sharesLeague(deps.pool, reporter, targetId))
        ? (await deps.pool.query<{ account_id: string; text: string | null }>('SELECT id AS account_id, display_name AS text FROM accounts WHERE id = $1 AND deleted_at IS NULL', [targetId])).rows[0]
        : undefined;
    }
    if (!offender) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (offender.account_id === reporter) {
      res.status(400).json({ error: 'you can’t report yourself' });
      return;
    }
    const recent = await deps.pool.query("SELECT 1 FROM reports WHERE reporter_id = $1 AND created_at > now() - interval '1 hour'", [reporter]);
    if ((recent.rowCount ?? 0) >= REPORTS_PER_HOUR) {
      res.status(429).json({ error: 'too many reports, try again later' });
      return;
    }
    // One report per reporter per target; repeating it answers 201 but stores and emails nothing.
    const stored = await deps.pool.query(
      `INSERT INTO reports (reporter_id, reported_account_id, target_type, target_id, reason, note) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING`,
      [reporter, offender.account_id, targetType, targetId, reason, note],
    );
    res.status(201).json({ ok: true });
    if (!stored.rowCount) return;

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
    if (!isUuid(target) || target === blocker) {
      res.status(400).json({ error: 'invalid account' });
      return;
    }
    // Anonymity: nobody can see another league's members, and a 404 here only says "not in a league
    // with you" -- which the target's own league mates could learn anyway. Block works at any time,
    // including mid-round, because it only hides content you'd see once results open.
    if (!(await sharesLeague(deps.pool, blocker, target))) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    await deps.pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [blocker, target]);
    res.status(204).end();
  });

  router.delete('/blocks/:accountId', requireAuth(deps), async (req, res) => {
    if (isUuid(req.params.accountId)) {
      await deps.pool.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [authed(req), req.params.accountId]);
    }
    res.status(204).end();
  });

  return router;
}
