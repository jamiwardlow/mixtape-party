import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Pool } from 'pg';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { CURRENT_ROUND_CLAUSE, loadLeague, loadRound } from './rounds.js';

export type LeaguesDeps = AccountsDeps;

// seasonLength is a row count now that the whole season is inserted at creation, so it needs a
// ceiling -- a weekly round for a year is already more league than anyone plays.
const MAX_SEASON_LENGTH = 52;

function generateInviteCode(): string {
  return randomBytes(5).toString('base64url');
}

interface LeagueRow {
  id: string;
  name: string;
  season_length: number;
  host_account_id: string;
  invite_code: string;
}

interface RoundRow {
  id: string;
  round_number: number;
  theme: string | null;
  submission_deadline: string;
  guessing_deadline: string;
}

async function findLeagueByInviteCode(pool: Pool, inviteCode: string): Promise<LeagueRow | null> {
  const result = await pool.query<LeagueRow>(
    'SELECT id, name, season_length, host_account_id, invite_code FROM leagues WHERE invite_code = $1',
    [inviteCode],
  );
  return result.rows[0] ?? null;
}

function serializeRound(round: RoundRow) {
  return {
    id: round.id,
    number: round.round_number,
    theme: round.theme,
    submissionDeadline: round.submission_deadline,
    guessingDeadline: round.guessing_deadline,
  };
}

/**
 * The one definition of a well-formed round window, shared by league creation and the round
 * PATCH -- which reaches it with the stored value standing in for whichever deadline the patch
 * left out. Returns the message to 400 with, or null when the pair is fine.
 */
function checkDeadlineOrder(submissionAt: Date, guessingAt: Date): string | null {
  if (Number.isNaN(submissionAt.getTime()) || Number.isNaN(guessingAt.getTime())) {
    return 'submissionDeadline and guessingDeadline must be valid dates';
  }
  if (guessingAt <= submissionAt) {
    return 'guessingDeadline must be after submissionDeadline';
  }
  return null;
}

function parseRoundInput(
  body: unknown,
): { theme: string; submissionAt: Date; guessingAt: Date } | { error: string } {
  const { theme, submissionDeadline, guessingDeadline } = (body ?? {}) as Record<string, unknown>;
  if (typeof theme !== 'string' || theme.trim().length === 0) {
    return { error: 'theme is required' };
  }
  const submissionAt = new Date(submissionDeadline as string);
  const guessingAt = new Date(guessingDeadline as string);
  const error = checkDeadlineOrder(submissionAt, guessingAt);
  if (error) {
    return { error };
  }
  return { theme: theme.trim(), submissionAt, guessingAt };
}

export function createLeaguesRouter(deps: LeaguesDeps): Router {
  const router = Router();

  router.post('/leagues', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const { name, seasonLength } = req.body ?? {};

    if (typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (
      typeof seasonLength !== 'number' ||
      !Number.isInteger(seasonLength) ||
      seasonLength < 1 ||
      seasonLength > MAX_SEASON_LENGTH
    ) {
      res.status(400).json({ error: `seasonLength must be a positive integer no greater than ${MAX_SEASON_LENGTH}` });
      return;
    }
    const parsed = parseRoundInput(req.body);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { theme, submissionAt, guessingAt } = parsed;

    const client = await deps.pool.connect();
    try {
      await client.query('BEGIN');
      const league = await client.query<{ id: string; invite_code: string }>(
        `INSERT INTO leagues (name, season_length, host_account_id, invite_code)
         VALUES ($1, $2, $3, $4) RETURNING id, invite_code`,
        [name.trim(), seasonLength, accountId, generateInviteCode()],
      );
      const leagueId = league.rows[0].id;
      const inviteCode = league.rows[0].invite_code;

      // The whole season is scheduled here, from round 1's two deadlines (#74): with W the gap
      // between them, round N's submission deadline is G1 + (N-2)W and its guessing deadline is
      // G1 + (N-1)W, so each round's submission deadline lands on the previous round's guessing
      // deadline. Only round 1 has a theme; naming the rest is #75's PATCH.
      //
      // submission_opens_at is round N-1's *submission* deadline, not its guessing deadline as
      // #74 phrased it -- those are one and the same instant as round N's own submission
      // deadline, which would leave every round after the first a zero-length submission window
      // and make its reminder fire at the deadline. Round N's submissions are collected while
      // round N-1 is being guessed.
      const rounds = await client.query<RoundRow>(
        `INSERT INTO rounds (league_id, round_number, theme, submission_opens_at, submission_deadline, guessing_deadline)
         SELECT $1, n,
                CASE WHEN n = 1 THEN $2 END,
                CASE WHEN n = 1 THEN now() ELSE $4::timestamptz + ($4::timestamptz - $3::timestamptz) * (n - 3) END,
                $4::timestamptz + ($4::timestamptz - $3::timestamptz) * (n - 2),
                $4::timestamptz + ($4::timestamptz - $3::timestamptz) * (n - 1)
         FROM generate_series(1, $5::int) AS n
         RETURNING id, round_number, theme, submission_deadline, guessing_deadline`,
        [leagueId, theme, submissionAt.toISOString(), guessingAt.toISOString(), seasonLength],
      );
      const firstRound = rounds.rows.find((row) => row.round_number === 1)!;

      await client.query('INSERT INTO league_members (league_id, account_id) VALUES ($1, $2)', [
        leagueId,
        accountId,
      ]);

      await client.query('COMMIT');

      res.status(201).json({
        leagueId,
        inviteCode,
        round: serializeRound(firstRound),
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  router.get('/leagues/invite/:code', async (req, res) => {
    const league = await findLeagueByInviteCode(deps.pool, req.params.code);
    if (!league) {
      res.status(404).json({ error: 'invite not found' });
      return;
    }

    // Anonymous-facing preview: never leak account emails, only display names.
    const [hostResult, roundResult, membersResult] = await Promise.all([
      deps.pool.query<{ display_name: string | null }>('SELECT display_name FROM accounts WHERE id = $1', [
        league.host_account_id,
      ]),
      deps.pool.query<RoundRow>(
        `SELECT id, round_number, theme, submission_deadline, guessing_deadline FROM rounds WHERE league_id = $1 ${CURRENT_ROUND_CLAUSE}`,
        [league.id],
      ),
      deps.pool.query<{ display_name: string | null }>(
        `SELECT a.display_name FROM league_members lm
         JOIN accounts a ON a.id = lm.account_id
         WHERE lm.league_id = $1
         ORDER BY lm.joined_at ASC`,
        [league.id],
      ),
    ]);

    const host = hostResult.rows[0];
    const round = roundResult.rows[0];

    res.json({
      league: { id: league.id, name: league.name, seasonLength: league.season_length },
      host: { displayName: host?.display_name ?? null },
      currentRound: round ? serializeRound(round) : null,
      players: membersResult.rows.map((row) => ({ displayName: row.display_name ?? null })),
      playerCount: membersResult.rowCount,
    });
  });

  router.post('/leagues/invite/:code/join', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const league = await findLeagueByInviteCode(deps.pool, req.params.code);
    if (!league) {
      res.status(404).json({ error: 'invite not found' });
      return;
    }

    await deps.pool.query(
      'INSERT INTO league_members (league_id, account_id) VALUES ($1, $2) ON CONFLICT (league_id, account_id) DO NOTHING',
      [league.id, accountId],
    );

    res.json({ leagueId: league.id });
  });

  router.get('/leagues/mine', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const result = await deps.pool.query<{
      league_id: string;
      league_name: string;
      round_id: string | null;
      round_number: number | null;
      theme: string | null;
      submission_deadline: string | null;
      guessing_deadline: string | null;
    }>(
      `SELECT l.id AS league_id, l.name AS league_name,
              r.id AS round_id, r.round_number, r.theme, r.submission_deadline, r.guessing_deadline
       FROM leagues l
       JOIN league_members lm ON lm.league_id = l.id AND lm.account_id = $1
       LEFT JOIN LATERAL (
         SELECT id, round_number, theme, submission_deadline, guessing_deadline
         FROM rounds WHERE league_id = l.id ${CURRENT_ROUND_CLAUSE}
       ) r ON true
       ORDER BY l.name`,
      [accountId],
    );

    const now = new Date();
    res.json({
      leagues: result.rows.map((row) => ({
        id: row.league_id,
        name: row.league_name,
        round: row.round_id
          ? {
              id: row.round_id,
              number: row.round_number,
              theme: row.theme,
              phase:
                now < new Date(row.submission_deadline!)
                  ? 'submission'
                  : now < new Date(row.guessing_deadline!)
                    ? 'guessing'
                    : 'results',
            }
          : null,
      })),
    });
  });

  // The only mutation path a round has (#75). #74 pre-creates the whole season from round 1's
  // pattern, so rounds 2..N arrive with a preset deadline and no theme -- both are a proposal the
  // host is expected to move, not a commitment.
  router.patch('/rounds/:roundId', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const round = await loadRound(deps.pool, req.params.roundId);
    if (!round) {
      res.status(404).json({ error: 'round not found' });
      return;
    }

    // One check covers non-hosts and non-members alike, the way the read routes 403 anyone
    // standing outside the league.
    const league = await loadLeague(deps.pool, round.leagueId);
    if (league?.hostAccountId !== accountId) {
      res.status(403).json({ error: 'only the league host can change a round' });
      return;
    }

    // A finished round's results are published and its playlist export already ran at that
    // guessing-deadline checkpoint (#7); moving it now would mean re-running or invalidating that
    // export, so the schedule only flexes forward of now.
    const now = new Date();
    if (new Date(round.guessingDeadline) <= now) {
      res.status(409).json({ error: 'this round is over and can no longer be changed' });
      return;
    }

    const { theme, submissionDeadline, guessingDeadline } = (req.body ?? {}) as Record<string, unknown>;
    if (theme !== undefined && (typeof theme !== 'string' || theme.trim().length === 0)) {
      res.status(400).json({ error: 'theme must be a non-empty string' });
      return;
    }
    // Strings only, because every other type Date happily accepts turns into a real instant --
    // `new Date(null)` and `new Date(false)` are both the epoch, which would slide past a
    // validity check and silently end the round in 1970.
    if ([submissionDeadline, guessingDeadline].some((value) => value !== undefined && typeof value !== 'string')) {
      res.status(400).json({ error: 'submissionDeadline and guessingDeadline must be ISO date strings' });
      return;
    }
    // An absent deadline falls back to the stored one rather than being skipped, so a one-sided
    // patch is still checked against the side it is not touching.
    const submissionAt =
      submissionDeadline === undefined ? new Date(round.submissionDeadline) : new Date(submissionDeadline as string);
    const guessingAt =
      guessingDeadline === undefined ? new Date(round.guessingDeadline) : new Date(guessingDeadline as string);
    const orderError = checkDeadlineOrder(submissionAt, guessingAt);
    if (orderError) {
      res.status(400).json({ error: orderError });
      return;
    }

    // A shut submission window is as unrepairable as a finished round: guessing is already
    // underway on the set of tracks that made it in, so moving the deadline would reopen
    // submissions mid-guessing. Only checked when the patch names that deadline -- naming a
    // mid-guessing round is the whole point of this route and stays allowed.
    if (submissionDeadline !== undefined && new Date(round.submissionDeadline) <= now) {
      res.status(409).json({ error: "this round's submission window has closed and can no longer be moved" });
      return;
    }
    // A deadline the host names has to be in the future. In the past it retro-closes a phase
    // people were still playing -- and a past *guessing* deadline concludes the round on the
    // spot, publishing results and firing the playlist export (#7) at a checkpoint nobody
    // reached, after which the 409 above freezes the round for good.
    if (
      (submissionDeadline !== undefined && submissionAt <= now) ||
      (guessingDeadline !== undefined && guessingAt <= now)
    ) {
      res.status(400).json({ error: 'a new deadline must be in the future' });
      return;
    }

    const neighbours = await deps.pool.query<
      Pick<RoundRow, 'round_number' | 'submission_deadline' | 'guessing_deadline'>
    >(
      `SELECT round_number, submission_deadline, guessing_deadline FROM rounds
       WHERE league_id = $1 AND round_number IN ($2, $3)`,
      [round.leagueId, round.roundNumber - 1, round.roundNumber + 1],
    );
    const previous = neighbours.rows.find((row) => row.round_number === round.roundNumber - 1);
    const next = neighbours.rows.find((row) => row.round_number === round.roundNumber + 1);
    // The schedule has to stay monotonic: out of order, CURRENT_ROUND_CLAUSE names a nonsense
    // round and the league silently jumps. Merely *touching* a neighbour is the preset schedule's
    // own resting state, so only a genuine crossing is refused. Each check is also gated on its
    // own deadline being in the patch: a deadline the host is not moving must never make the
    // request fail for where it already sits.
    if (submissionDeadline !== undefined && previous && submissionAt < new Date(previous.guessing_deadline)) {
      res.status(400).json({
        error: `submissionDeadline must not precede round ${previous.round_number}'s guessing deadline`,
      });
      return;
    }
    if (guessingDeadline !== undefined && next && guessingAt > new Date(next.submission_deadline)) {
      res.status(400).json({
        error: `guessingDeadline must not follow round ${next.round_number}'s submission deadline`,
      });
      return;
    }

    // One data-modifying CTE so the round and its successor's submission window move in the same
    // statement. Round N+1 collects submissions while round N is being guessed, so its
    // submission_opens_at *is* round N's submission deadline (see POST /leagues above); the
    // notification sweep reads the reminder as a fraction of that window and misfires if the two
    // drift apart. The CTE matches no row when this is the last round of the season.
    //
    // Every moved window also clears the reminder the sweep already sent against it, which is
    // one-shot per round (`... IS NULL` in sweep.ts) and so would never fire again for the new
    // time. The CASE arms compare against the *old* row, so a window that did not actually move
    // keeps its flag rather than re-notifying everyone.
    const updated = await deps.pool.query<RoundRow>(
      `WITH shifted AS (
         UPDATE rounds
         SET submission_opens_at = $3::timestamptz,
             submission_reminder_sent_at =
               CASE WHEN submission_opens_at = $3::timestamptz THEN submission_reminder_sent_at END
         WHERE league_id = $5 AND round_number = $6
       )
       UPDATE rounds
       SET theme = COALESCE($2::text, theme), submission_deadline = $3::timestamptz,
           guessing_deadline = $4::timestamptz,
           submission_reminder_sent_at =
             CASE WHEN submission_deadline = $3::timestamptz THEN submission_reminder_sent_at END,
           guessing_reminder_sent_at =
             CASE WHEN guessing_deadline = $4::timestamptz THEN guessing_reminder_sent_at END
       WHERE id = $1
       RETURNING id, round_number, theme, submission_deadline, guessing_deadline`,
      [
        req.params.roundId,
        theme === undefined ? null : (theme as string).trim(),
        submissionAt.toISOString(),
        guessingAt.toISOString(),
        round.leagueId,
        round.roundNumber + 1,
      ],
    );

    res.json({ round: serializeRound(updated.rows[0]) });
  });

  return router;
}
