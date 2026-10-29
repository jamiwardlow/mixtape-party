import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { notifyAccounts } from '../notifications/sweep.js';
import type { EmailChannel, PushChannel } from '../notifications/types.js';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { isLeagueMember } from './rounds.js';

export interface CommentsDeps extends AccountsDeps {
  pushChannel: PushChannel;
  emailChannel: EmailChannel;
  /** Origin of the web client; emailed links to a comment or reply start here. */
  appBaseUrl: string;
}

const MAX_LENGTH = 500;
// ponytail: fixed window, not per-reactor or configurable; tune if leagues find it too quiet or chatty.
const REACTION_PUSH_WINDOW_MINUTES = 10;

/** One grapheme (so 👍🏽 and 🏳️‍🌈 count) that is an emoji or a flag; nothing else gets stored as a reaction. */
export function isEmoji(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 32 &&
    /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value) &&
    [...new Intl.Segmenter().segment(value)].length === 1
  );
}

type ReactionColumn = 'submission_id' | 'guess_id' | 'reply_id';

// What a reaction can land on, each with the round it belongs to and when it opens (`opens_at`). A
// comment (guess) only exists to react to once it has text; the track itself is reactable whether or
// not the submitter left a note, and from the moment guessing opens, so it can be reacted to and
// favorited while you listen.
export const REACTION_TARGETS: Record<ReactionColumn, string> = {
  submission_id: `SELECT r.league_id, r.submission_deadline AS opens_at FROM submissions s JOIN rounds r ON r.id = s.round_id WHERE s.id = $1`,
  guess_id: `SELECT r.league_id, r.guessing_deadline AS opens_at FROM guesses g JOIN submissions s ON s.id = g.submission_id
             JOIN rounds r ON r.id = s.round_id WHERE g.id = $1 AND g.comment IS NOT NULL`,
  reply_id: `SELECT r.league_id, r.guessing_deadline AS opens_at FROM guess_replies p JOIN guesses g ON g.id = p.guess_id
             JOIN submissions s ON s.id = g.submission_id JOIN rounds r ON r.id = s.round_id WHERE p.id = $1`,
};

// Who a reaction is for, and what they wrote: $1 is the target, $2 the reactor (for their name).
const REACTOR = `(SELECT display_name FROM accounts WHERE id = $2) AS name`;
const REACTION_OWNERS: Record<ReactionColumn, string> = {
  submission_id: `SELECT s.account_id AS recipient, r.id AS round_id, r.league_id, s.title AS text, ${REACTOR},
                  r.guessing_deadline > now() AS guessing_open
                  FROM submissions s JOIN rounds r ON r.id = s.round_id WHERE s.id = $1`,
  guess_id: `SELECT g.guesser_account_id AS recipient, r.id AS round_id, r.league_id, g.comment AS text, ${REACTOR}
             FROM guesses g JOIN submissions s ON s.id = g.submission_id JOIN rounds r ON r.id = s.round_id WHERE g.id = $1`,
  reply_id: `SELECT p.account_id AS recipient, r.id AS round_id, r.league_id, p.body AS text, ${REACTOR}
             FROM guess_replies p JOIN guesses g ON g.id = p.guess_id JOIN submissions s ON s.id = g.submission_id
             JOIN rounds r ON r.id = s.round_id WHERE p.id = $1`,
};
const REACTION_LABEL: Record<ReactionColumn, string> = { submission_id: 'track', guess_id: 'comment', reply_id: 'reply' };

/** League members only, once the target is open: results for comments and replies, guessing for tracks. */
export async function guardError(pool: Pool, sql: string, id: string, accountId: string) {
  const round = (await pool.query<{ league_id: string; opens_at: string }>(sql, [id])).rows[0];
  if (!round) return { status: 404, error: 'not found' };
  if (!(await isLeagueMember(pool, round.league_id, accountId))) {
    return { status: 403, error: 'join the league before joining the conversation' };
  }
  if (new Date(round.opens_at) > new Date()) {
    return { status: 403, error: 'not open yet' };
  }
  return null;
}

function parseBody(value: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const body = typeof value === 'string' ? value.trim() : '';
  if (!body) return { ok: false, error: 'body is required' };
  if (body.length > MAX_LENGTH) return { ok: false, error: `body must be ${MAX_LENGTH} characters or fewer` };
  return { ok: true, body };
}

export function createCommentsRouter(deps: CommentsDeps): Router {
  const router = Router();
  const authed = (req: Request) => (req as unknown as AuthedRequest).accountId;
  // The results screen scrolls to and highlights `focus`, a track, comment or reply id.
  const focusLink = (roundId: string, focus: string) => `${deps.appBaseUrl}/round/${roundId}/results?focus=${focus}`;

  // Replies to the guess's comment, or to another reply on it when parentReplyId is given.
  router.post('/guesses/:guessId/replies', requireAuth(deps), async (req, res) => {
    const accountId = authed(req);
    const parsed = parseBody(req.body?.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const error = await guardError(deps.pool, REACTION_TARGETS.guess_id, req.params.guessId, accountId);
    if (error) {
      res.status(error.status).json({ error: error.error });
      return;
    }
    const parentReplyId = req.body?.parentReplyId ?? null;
    let notifyId: string | undefined;
    if (parentReplyId !== null) {
      const parent = await deps.pool.query<{ account_id: string }>(
        'SELECT account_id FROM guess_replies WHERE id = $1 AND guess_id = $2',
        [parentReplyId, req.params.guessId],
      );
      if (!parent.rows[0]) {
        res.status(400).json({ error: 'parentReplyId must be a reply on this comment' });
        return;
      }
      notifyId = parent.rows[0].account_id;
    }
    const reply = await deps.pool.query<{ id: string }>(
      'INSERT INTO guess_replies (guess_id, parent_reply_id, account_id, body) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.params.guessId, parentReplyId, accountId, parsed.body],
    );
    res.status(201).json({ replyId: reply.rows[0].id });

    // Whoever was replied to hears about it, unless they replied to themselves. Sent after the
    // response: a flaky push or mail provider must not make a saved reply look like it failed.
    const target = (
      await deps.pool.query<{ round_id: string; league_id: string; guesser: string; name: string | null }>(
        `SELECT r.id AS round_id, r.league_id, g.guesser_account_id AS guesser,
                (SELECT display_name FROM accounts WHERE id = $2) AS name
         FROM guesses g JOIN submissions s ON s.id = g.submission_id JOIN rounds r ON r.id = s.round_id
         WHERE g.id = $1`,
        [req.params.guessId, accountId],
      )
    ).rows[0];
    const recipient = notifyId ?? target.guesser;
    const focus = reply.rows[0].id;
    if (recipient === accountId) return;
    try {
      await notifyAccounts(
        deps,
        [recipient],
        'comment_reply',
        {
          title: `${target.name ?? 'Someone'} replied to your ${notifyId ? 'reply' : 'comment'}`,
          body: parsed.body,
          link: focusLink(target.round_id, focus),
          data: { roundId: target.round_id, screen: 'results', focus },
        },
        { roundId: target.round_id, leagueId: target.league_id },
      );
    } catch (err) {
      console.error('reply notification failed', err);
    }
  });

  // Authors only; a missing reply and someone else's reply look the same.
  router.put('/replies/:replyId', requireAuth(deps), async (req, res) => {
    const parsed = parseBody(req.body?.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const updated = await deps.pool.query('UPDATE guess_replies SET body = $1 WHERE id = $2 AND account_id = $3', [
      parsed.body,
      req.params.replyId,
      authed(req),
    ]);
    if (!updated.rowCount) {
      res.status(404).json({ error: 'reply not found' });
      return;
    }
    res.json({ body: parsed.body });
  });

  router.delete('/replies/:replyId', requireAuth(deps), async (req, res) => {
    const deleted = await deps.pool.query('DELETE FROM guess_replies WHERE id = $1 AND account_id = $2', [
      req.params.replyId,
      authed(req),
    ]);
    if (!deleted.rowCount) {
      res.status(404).json({ error: 'reply not found' });
      return;
    }
    res.status(204).end();
  });

  // Toggles: reacting again with the same emoji takes the reaction back.
  async function toggleReaction(column: ReactionColumn, id: string, accountId: string, emoji: unknown, res: Response) {
    if (!isEmoji(emoji)) {
      res.status(400).json({ error: 'emoji must be a single emoji' });
      return;
    }
    const error = await guardError(deps.pool, REACTION_TARGETS[column], id, accountId);
    if (error) {
      res.status(error.status).json({ error: error.error });
      return;
    }
    const removed = await deps.pool.query(
      `DELETE FROM comment_reactions WHERE ${column} = $1 AND account_id = $2 AND emoji = $3`,
      [id, accountId, emoji],
    );
    if (!removed.rowCount) {
      await deps.pool.query(`INSERT INTO comment_reactions (${column}, account_id, emoji) VALUES ($1, $2, $3)`, [
        id,
        accountId,
        emoji,
      ]);
    }
    res.json({ reacted: !removed.rowCount });
    if (removed.rowCount) return;

    // Push only: a reaction is too light for an email. Sent after the response, like reply notifications.
    try {
      const owner = (
        await deps.pool.query<{ recipient: string; round_id: string; league_id: string; text: string; name: string | null; guessing_open?: boolean }>(
          REACTION_OWNERS[column],
          [id, accountId],
        )
      ).rows[0];
      if (!owner || owner.recipient === accountId) return;
      // A track reaction during guessing can't link to results yet: say it anonymously (nobody is
      // revealed mid-round) and send them to the guess screen, nudging if they haven't finished.
      if (owner.guessing_open) {
        // One ping per submitter per round per window, so toggling or a pile-on of reactions isn't a barrage.
        const recent = await deps.pool.query(
          `SELECT 1 FROM notifications WHERE account_id = $1 AND round_id = $2 AND type = 'comment_reaction'
           AND created_at > now() - make_interval(mins => $3)`,
          [owner.recipient, owner.round_id, REACTION_PUSH_WINDOW_MINUTES],
        );
        if (recent.rowCount) return;
        const unfinished = (
          await deps.pool.query(
            `SELECT (SELECT count(*) FROM guesses g JOIN submissions s ON s.id = g.submission_id
                     WHERE s.round_id = $1 AND g.guesser_account_id = $2)
                  < (SELECT count(*) FROM submissions WHERE round_id = $1 AND account_id != $2) AS unfinished`,
            [owner.round_id, owner.recipient],
          )
        ).rows[0].unfinished;
        await notifyAccounts(
          deps,
          [owner.recipient],
          'comment_reaction',
          {
            title: `Someone reacted ${emoji} to your submission`,
            body: unfinished ? "Don't forget to submit your guesses!" : owner.text,
            data: { roundId: owner.round_id, screen: 'guess' },
          },
          { roundId: owner.round_id, leagueId: owner.league_id },
          { email: false },
        );
        return;
      }
      await notifyAccounts(
        deps,
        [owner.recipient],
        'comment_reaction',
        {
          title: `${owner.name ?? 'Someone'} reacted ${emoji} to your ${REACTION_LABEL[column]}`,
          body: owner.text,
          data: { roundId: owner.round_id, screen: 'results', focus: id },
        },
        { roundId: owner.round_id, leagueId: owner.league_id },
        { email: false },
      );
    } catch (err) {
      console.error('reaction notification failed', err);
    }
  }

  // Favorites are private to the player and follow the track reactions' rule: members only, once guessing is open.
  router.post('/submissions/:id/favorite', requireAuth(deps), async (req, res) => {
    const accountId = authed(req);
    const error = await guardError(deps.pool, REACTION_TARGETS.submission_id, req.params.id, accountId);
    if (error) {
      res.status(error.status).json({ error: error.error });
      return;
    }
    const removed = await deps.pool.query('DELETE FROM favorites WHERE submission_id = $1 AND account_id = $2', [
      req.params.id,
      accountId,
    ]);
    if (!removed.rowCount) {
      await deps.pool.query('INSERT INTO favorites (account_id, submission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        accountId,
        req.params.id,
      ]);
    }
    res.json({ favorited: !removed.rowCount });
  });

  for (const [path, column] of [
    ['submissions', 'submission_id'],
    ['guesses', 'guess_id'],
    ['replies', 'reply_id'],
  ] as const) {
    router.post(`/${path}/:id/reactions`, requireAuth(deps), (req, res) =>
      toggleReaction(column, req.params.id, authed(req), req.body?.emoji, res),
    );
  }

  return router;
}
