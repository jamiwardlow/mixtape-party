import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Pool } from 'pg';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import {
  CURRENT_ROUND_CLAUSE,
  describeRound,
  emptyRoundActivity,
  isLeagueMember,
  isSeasonConcluded,
  loadCurrentRound,
  loadLeague,
  loadRound,
  roundPhase,
  type Player,
  type RoundActivity,
} from './rounds.js';
import { correctGuessCounts, scoreboard } from './results.js';

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

    // Rounds 2..N can be named at creation too: themes[n] is round n's theme. Anything
    // missing or blank stays null, for the schedule screen's PATCH to name later.
    const { themes } = req.body ?? {};
    if (themes !== undefined && (!Array.isArray(themes) || themes.some((t) => t !== null && typeof t !== 'string'))) {
      res.status(400).json({ error: 'themes must be an array of strings' });
      return;
    }
    const seasonThemes: (string | null)[] = Array.from(
      { length: seasonLength },
      (_, i) => (typeof themes?.[i] === 'string' && themes[i].trim()) || null,
    );

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
      // deadline. Round 1's theme is its own field; the rest come from `themes`, if sent.
      //
      // submission_opens_at is round N-1's *submission* deadline, not its guessing deadline as
      // #74 phrased it -- those are one and the same instant as round N's own submission
      // deadline, which would leave every round after the first a zero-length submission window
      // and make its reminder fire at the deadline. Round N's submissions are collected while
      // round N-1 is being guessed.
      const rounds = await client.query<RoundRow>(
        `INSERT INTO rounds (league_id, round_number, theme, submission_opens_at, submission_deadline, guessing_deadline)
         SELECT $1, n,
                CASE WHEN n = 1 THEN $2 ELSE ($6::text[])[n] END,
                CASE WHEN n = 1 THEN now() ELSE $4::timestamptz + ($4::timestamptz - $3::timestamptz) * (n - 3) END,
                $4::timestamptz + ($4::timestamptz - $3::timestamptz) * (n - 2),
                $4::timestamptz + ($4::timestamptz - $3::timestamptz) * (n - 1)
         FROM generate_series(1, $5::int) AS n
         RETURNING id, round_number, theme, submission_deadline, guessing_deadline`,
        [leagueId, theme, submissionAt.toISOString(), guessingAt.toISOString(), seasonLength, seasonThemes],
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
              phase: roundPhase(
                { submissionDeadline: row.submission_deadline!, guessingDeadline: row.guessing_deadline! },
                now,
              ),
            }
          : null,
      })),
    });
  });

  // The whole season, for the schedule screen (#77) -- /leagues/mine and the invite preview both
  // answer with the current round alone. A read of its own rather than part of the PATCH above:
  // every member needs it, only the host may write.
  router.get('/leagues/:leagueId/rounds', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const league = await loadLeague(deps.pool, req.params.leagueId);
    if (!league) {
      res.status(404).json({ error: 'league not found' });
      return;
    }
    if (!(await isLeagueMember(deps.pool, req.params.leagueId, accountId))) {
      res.status(403).json({ error: 'join the league before viewing its schedule' });
      return;
    }

    const rounds = await deps.pool.query<RoundRow>(
      `SELECT id, round_number, theme, submission_deadline, guessing_deadline
       FROM rounds WHERE league_id = $1 ORDER BY round_number`,
      [req.params.leagueId],
    );

    // Round metadata only: who submitted what stays hidden until guesses lock (Principle 1).
    res.json({ isHost: league.hostAccountId === accountId, rounds: rounds.rows.map(serializeRound) });
  });

  // One read behind both overview screens (#83, #84): the roster, the running standings and every
  // round's progress. Three grouped queries cover the whole season rather than three per round --
  // the page draws all `seasonLength` of them, so the query count must not scale with it.
  router.get('/leagues/:leagueId/overview', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const leagueId = req.params.leagueId;
    const league = await loadLeague(deps.pool, leagueId);
    if (!league) {
      res.status(404).json({ error: 'league not found' });
      return;
    }
    if (!(await isLeagueMember(deps.pool, leagueId, accountId))) {
      res.status(403).json({ error: 'join the league before viewing it' });
      return;
    }

    const [membersResult, roundsResult, submissionsResult, guessesResult, correctGuesses, current] = await Promise.all([
      // Driven off league_members rather than off guesses, so a player who has done nothing is
      // still on the roster and still in the standings on zero. Ordered by joined_at so the list
      // is stable between loads.
      deps.pool.query<{ account_id: string; display_name: string | null; joined_at: string }>(
        `SELECT a.id AS account_id, a.display_name, lm.joined_at FROM league_members lm
         JOIN accounts a ON a.id = lm.account_id
         WHERE lm.league_id = $1
         ORDER BY lm.joined_at ASC`,
        [leagueId],
      ),
      deps.pool.query<RoundRow & { scored: boolean }>(
        // `scored` comes from Postgres's clock, not the app's: correctGuessCounts filters on the
        // same now(), so "after 3 of 8 rounds" can never disagree with the standings beside it.
        `SELECT id, round_number, theme, submission_deadline, guessing_deadline,
                guessing_deadline <= now() AS scored
         FROM rounds WHERE league_id = $1 ORDER BY round_number`,
        [leagueId],
      ),
      deps.pool.query<{ round_id: string; account_id: string }>(
        `SELECT s.round_id, s.account_id FROM submissions s
         JOIN rounds r ON r.id = s.round_id
         WHERE r.league_id = $1
         ORDER BY s.created_at, s.id`,
        [leagueId],
      ),
      deps.pool.query<{ round_id: string; guesser_account_id: string; guess_count: string }>(
        `SELECT s.round_id, g.guesser_account_id, count(*) AS guess_count
         FROM guesses g
         JOIN submissions s ON s.id = g.submission_id
         JOIN rounds r ON r.id = s.round_id
         WHERE r.league_id = $1
         GROUP BY s.round_id, g.guesser_account_id`,
        [leagueId],
      ),
      correctGuessCounts(deps.pool, leagueId),
      loadCurrentRound(deps.pool, leagueId),
    ]);

    const now = new Date();
    const players = new Map<string, Player>(
      membersResult.rows.map((row) => [row.account_id, { accountId: row.account_id, displayName: row.display_name }]),
    );

    const activity = new Map<string, RoundActivity>(roundsResult.rows.map((row) => [row.id, emptyRoundActivity()]));
    for (const row of submissionsResult.rows) {
      activity.get(row.round_id)?.submitterIds.push(row.account_id);
    }
    for (const row of guessesResult.rows) {
      activity.get(row.round_id)?.guessCounts.set(row.guesser_account_id, Number(row.guess_count));
    }

    const concluded = isSeasonConcluded(league, current, now);
    const { scores, winners } = scoreboard([...players.values()], correctGuesses);

    res.json({
      league: {
        id: leagueId,
        name: league.name,
        seasonLength: league.seasonLength,
        inviteCode: league.inviteCode,
        isHost: league.hostAccountId === accountId,
        concluded,
      },
      host: players.get(league.hostAccountId) ?? { accountId: league.hostAccountId, displayName: null },
      members: membersResult.rows.map((row) => ({
        accountId: row.account_id,
        displayName: row.display_name,
        joinedAt: row.joined_at,
      })),
      standings: scores,
      scoredRoundCount: roundsResult.rows.filter((row) => row.scored).length,
      winners: concluded ? winners : [],
      rounds: roundsResult.rows.map((row) => ({
        ...describeRound(
          serializeRound(row),
          activity.get(row.id) ?? emptyRoundActivity(),
          players,
          accountId,
          now,
        ),
        // CURRENT_ROUND_CLAUSE, not a second "first unfinished round" computed here -- between
        // seasons the clause names the final round and the overview must agree with home.
        isCurrent: row.id === current?.id,
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

    const bounds = await deps.pool.query<{
      previous_guessing_deadline: string | null;
      earliest_later_deadline: string | null;
    }>(
      `SELECT min(guessing_deadline) FILTER (WHERE round_number = $2) AS previous_guessing_deadline,
              min(guessing_deadline) FILTER (WHERE round_number > $3) AS earliest_later_deadline
       FROM rounds WHERE league_id = $1 AND (round_number = $2 OR round_number > $3)`,
      [round.leagueId, round.roundNumber - 1, round.roundNumber],
    );
    const { previous_guessing_deadline: previousGuessing, earliest_later_deadline: earliestLater } = bounds.rows[0];

    // submissionDeadline is the split point *inside* this round, so it is the only deadline with
    // a neighbour it can collide with: backing it past round N-1's guessing deadline would put
    // the schedule out of order, and out of order CURRENT_ROUND_CLAUSE names a nonsense round.
    // Merely *touching* the neighbour is the preset schedule's own resting state, so only a
    // genuine crossing is refused -- and the check is gated on the patch naming that deadline, so
    // a deadline the host is not moving can never make the request fail for where it already sits.
    // Its upper bound is this round's own guessing deadline, which checkDeadlineOrder covers.
    if (submissionDeadline !== undefined && previousGuessing && submissionAt < new Date(previousGuessing)) {
      res.status(400).json({
        error: `submissionDeadline must not precede round ${round.roundNumber - 1}'s guessing deadline`,
      });
      return;
    }

    // guessingDeadline is the boundary *between* round N and round N+1, so moving it by delta
    // slides the whole rest of the season by delta rather than being refused for crossing round
    // N+1 (#79). Every later round keeps its window lengths and the season's end date moves with
    // it: the host is moving the season, not squeezing one round. Stretching round N by shrinking
    // round N+1 was rejected -- it silently squeezes a round the host said nothing about.
    const shiftMs =
      guessingDeadline === undefined ? 0 : guessingAt.getTime() - new Date(round.guessingDeadline).getTime();
    // Nothing already played may move. A slide only ever touches rounds after N, and N is not
    // over, so monotonicity already implies every slid round is in the future -- but a legacy or
    // hand-edited league need not be monotonic, so assert it rather than assume it.
    if (shiftMs !== 0 && earliestLater && new Date(earliestLater) <= now) {
      res.status(409).json({ error: 'a later round of this season is already over and cannot be moved' });
      return;
    }

    // One data-modifying CTE so the round and every round it slides move in the same statement: a
    // half-applied slide is a non-monotonic schedule, which is exactly what CURRENT_ROUND_CLAUSE
    // cannot survive.
    //
    // Round N+1 is the one round that does not slide whole. It collects submissions while round N
    // is being guessed, so its submission_opens_at *is* round N's submission deadline (see POST
    // /leagues above) -- which the slide did not move -- and its submission window therefore
    // grows by the same delta round N's guessing phase does. The notification sweep reads the
    // reminder as a fraction of that window and misfires if the two drift apart. Rounds after
    // N+1 slide all three columns, so each still opens on its own predecessor's submission
    // deadline. The CTE matches no row when this is the last round of the season.
    //
    // Every moved window also clears the reminder the sweep already sent against it, which is
    // one-shot per round (`... IS NULL` in sweep.ts) and so would never fire again for the new
    // time. The CASE arms compare the new value against the *old* row, so a window that did not
    // actually move keeps its flag rather than re-notifying everyone.
    const updated = await deps.pool.query<RoundRow>(
      `WITH slid AS (
         UPDATE rounds r
         SET submission_opens_at = n.submission_opens_at,
             submission_deadline = n.submission_deadline,
             guessing_deadline = n.guessing_deadline,
             submission_reminder_sent_at =
               CASE WHEN (n.submission_opens_at, n.submission_deadline)
                         = (r.submission_opens_at, r.submission_deadline)
                    THEN r.submission_reminder_sent_at END,
             guessing_reminder_sent_at =
               CASE WHEN (n.submission_deadline, n.guessing_deadline)
                         = (r.submission_deadline, r.guessing_deadline)
                    THEN r.guessing_reminder_sent_at END
         FROM (
           SELECT id,
                  CASE WHEN round_number = $6 THEN $3::timestamptz
                       ELSE submission_opens_at + $7::interval END AS submission_opens_at,
                  submission_deadline + $7::interval AS submission_deadline,
                  guessing_deadline + $7::interval AS guessing_deadline
           FROM rounds
           WHERE league_id = $5
             AND (round_number = $6 OR (round_number > $6 AND $7::interval <> interval '0'))
         ) n
         WHERE r.id = n.id
         RETURNING r.id, r.round_number, r.theme, r.submission_deadline, r.guessing_deadline
       ), patched AS (
         UPDATE rounds
         SET theme = COALESCE($2::text, theme), submission_deadline = $3::timestamptz,
             guessing_deadline = $4::timestamptz,
             submission_reminder_sent_at =
               CASE WHEN submission_deadline = $3::timestamptz THEN submission_reminder_sent_at END,
             guessing_reminder_sent_at =
               CASE WHEN guessing_deadline = $4::timestamptz THEN guessing_reminder_sent_at END
         WHERE id = $1
         RETURNING id, round_number, theme, submission_deadline, guessing_deadline
       )
       SELECT * FROM patched UNION ALL SELECT * FROM slid ORDER BY round_number`,
      [
        req.params.roundId,
        theme === undefined ? null : (theme as string).trim(),
        submissionAt.toISOString(),
        guessingAt.toISOString(),
        round.leagueId,
        round.roundNumber + 1,
        `${shiftMs} milliseconds`,
      ],
    );

    // Every round this wrote, not just the patched one: a one-round patch that silently moves the
    // season's end date is a surprise, and the schedule screen has to redraw all of them. The
    // patched round is always the first, since a slide only ever reaches forwards.
    res.json({ rounds: updated.rows.map(serializeRound) });
  });

  return router;
}
