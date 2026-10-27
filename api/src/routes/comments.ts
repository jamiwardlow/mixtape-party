import { Router, type Response } from 'express';
import type { Pool } from 'pg';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { isLeagueMember } from './rounds.js';

export type CommentsDeps = AccountsDeps;

// A fixed palette keeps reactions to a handful of tappable buttons, and arbitrary strings out of the table.
export const REACTION_EMOJI = ['❤️', '😂', '🔥', '👏', '😮'];

/** Replies and reactions share the results' rule: league members only, once results are open. */
async function threadGuardError(pool: Pool, guessId: string, accountId: string) {
  const result = await pool.query<{ league_id: string; guessing_deadline: string; comment: string | null }>(
    `SELECT r.league_id, r.guessing_deadline, g.comment FROM guesses g
     JOIN submissions s ON s.id = g.submission_id JOIN rounds r ON r.id = s.round_id
     WHERE g.id = $1`,
    [guessId],
  );
  const guess = result.rows[0];
  if (!guess?.comment) return { status: 404, error: 'comment not found' };
  if (!(await isLeagueMember(pool, guess.league_id, accountId))) {
    return { status: 403, error: 'join the league before joining the conversation' };
  }
  if (new Date(guess.guessing_deadline) > new Date()) {
    return { status: 403, error: 'comments open up once results are available' };
  }
  return null;
}

export function createCommentsRouter(deps: CommentsDeps): Router {
  const router = Router();

  router.post('/guesses/:guessId/replies', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) {
      res.status(400).json({ error: 'body is required' });
      return;
    }
    if (body.length > 500) {
      res.status(400).json({ error: 'body must be 500 characters or fewer' });
      return;
    }
    const guardError = await threadGuardError(deps.pool, req.params.guessId, accountId);
    if (guardError) {
      res.status(guardError.status).json({ error: guardError.error });
      return;
    }
    const reply = await deps.pool.query<{ id: string }>(
      'INSERT INTO guess_replies (guess_id, account_id, body) VALUES ($1, $2, $3) RETURNING id',
      [req.params.guessId, accountId, body],
    );
    res.status(201).json({ replyId: reply.rows[0].id });
  });

  // Toggles: reacting again with the same emoji takes the reaction back.
  async function toggleReaction(
    column: 'guess_id' | 'reply_id',
    targetId: string,
    guessId: string | undefined,
    accountId: string,
    emoji: unknown,
    res: Response,
  ) {
    if (typeof emoji !== 'string' || !REACTION_EMOJI.includes(emoji)) {
      res.status(400).json({ error: 'emoji is not one of the available reactions' });
      return;
    }
    const guardError = guessId ? await threadGuardError(deps.pool, guessId, accountId) : { status: 404, error: 'reply not found' };
    if (guardError) {
      res.status(guardError.status).json({ error: guardError.error });
      return;
    }
    const removed = await deps.pool.query(
      `DELETE FROM comment_reactions WHERE ${column} = $1 AND account_id = $2 AND emoji = $3`,
      [targetId, accountId, emoji],
    );
    if (!removed.rowCount) {
      await deps.pool.query(`INSERT INTO comment_reactions (${column}, account_id, emoji) VALUES ($1, $2, $3)`, [
        targetId,
        accountId,
        emoji,
      ]);
    }
    res.json({ reacted: !removed.rowCount });
  }

  router.post('/guesses/:guessId/reactions', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    await toggleReaction('guess_id', req.params.guessId, req.params.guessId, accountId, req.body?.emoji, res);
  });

  router.post('/replies/:replyId/reactions', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const parent = await deps.pool.query<{ guess_id: string }>('SELECT guess_id FROM guess_replies WHERE id = $1', [
      req.params.replyId,
    ]);
    await toggleReaction('reply_id', req.params.replyId, parent.rows[0]?.guess_id, accountId, req.body?.emoji, res);
  });

  return router;
}
