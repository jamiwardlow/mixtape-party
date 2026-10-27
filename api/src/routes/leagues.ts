import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Pool } from 'pg';
import type { ServiceName } from '../adapters/types.js';
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

/** The shelf's view of a league's current round: what phase it is in, and whether that phase is live. */
function summarizeRound(
  row: {
    round_id: string | null;
    round_number: number | null;
    theme: string | null;
    submission_deadline: string | null;
    guessing_deadline: string | null;
    submitted: boolean;
  },
  now: Date,
) {
  const phase = roundPhase(
    { submissionDeadline: row.submission_deadline!, guessingDeadline: row.guessing_deadline! },
    now,
  );
  return {
    id: row.round_id,
    number: row.round_number,
    theme: row.theme,
    phase,
    submitted: row.submitted,
  };
}

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

interface SubmissionRow {
  account_id: string;
  service: ServiceName;
  title: string;
  artist: string;
  comment?: string | null;
}

/**
 * The three fields of a track both overview routes may serialize -- and only ever for the viewer's
 * own submission, picked out in the loop that reads the rows rather than narrowed on the way out.
 * A map of everyone's tracks that gets filtered at serialization time is one careless spread away
 * from shipping the whole playlist with names attached (PRODUCT.md Principle 1).
 */
const trackOf = (row: SubmissionRow) => ({ service: row.service, title: row.title, artist: row.artist, comment: row.comment ?? null });

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
// Generous: the client sends the moment it opened the form, which may be a while ago.
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

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

    // The client's "now" is what its schedule preview was computed from; honouring it keeps the
    // saved dates identical to the preview. A time far from ours is a bug or a lie, so refuse it.
    const { now: nowInput } = req.body ?? {};
    const createdAt = nowInput === undefined ? new Date() : new Date(nowInput as string);
    if (typeof nowInput !== 'undefined' && typeof nowInput !== 'string') {
      res.status(400).json({ error: 'now must be an ISO date string' });
      return;
    }
    if (Number.isNaN(createdAt.getTime()) || Math.abs(createdAt.getTime() - Date.now()) > MAX_CLOCK_SKEW_MS) {
      res.status(400).json({ error: 'now must be within a day of the server clock' });
      return;
    }
    // Guessing period for rounds 2..N: creation -> round 1's submission deadline. A deadline that
    // is already past leaves no interval to copy, so fall back to round 1's guessing length.
    const guessLengthMs = Math.max(
      submissionAt.getTime() - createdAt.getTime(),
      guessingAt.getTime() - submissionAt.getTime(),
    );

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

      // The whole season is scheduled here, from round 1's two deadlines, and no round's phases
      // overlap. Round 1 is as entered. With W = G1 - S1 (round 1's guessing length, reused as
      // every later submission period) and I = S1 - creation time (reused as every later guessing
      // period), round N >= 2 is submissions G(N-1) -> S(N) = G(N-1) + W, then guessing
      // S(N) -> G(N) = S(N) + I. Round 1's theme is its own field; the rest come from `themes`.
      //
      // submission_opens_at is the previous round's guessing deadline: submissions for round N
      // open as round N-1's guessing closes.
      const rounds = await client.query<RoundRow>(
        `INSERT INTO rounds (league_id, round_number, theme, submission_opens_at, submission_deadline, guessing_deadline)
         SELECT $1, n,
                CASE WHEN n = 1 THEN $2 ELSE ($6::text[])[n] END,
                CASE WHEN n = 1 THEN $7::timestamptz
                     ELSE $4::timestamptz + ($4::timestamptz - $3::timestamptz + $8::bigint * interval '1 millisecond') * (n - 2) END,
                CASE WHEN n = 1 THEN $3::timestamptz
                     ELSE $4::timestamptz + ($4::timestamptz - $3::timestamptz + $8::bigint * interval '1 millisecond') * (n - 1)
                          - $8::bigint * interval '1 millisecond' END,
                CASE WHEN n = 1 THEN $4::timestamptz
                     ELSE $4::timestamptz + ($4::timestamptz - $3::timestamptz + $8::bigint * interval '1 millisecond') * (n - 1) END
         FROM generate_series(1, $5::int) AS n
         RETURNING id, round_number, theme, submission_deadline, guessing_deadline`,
        [
          leagueId,
          theme,
          submissionAt.toISOString(),
          guessingAt.toISOString(),
          seasonLength,
          seasonThemes,
          createdAt.toISOString(),
          guessLengthMs,
        ],
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
      submitted: boolean;
    }>(
      `SELECT l.id AS league_id, l.name AS league_name,
              r.id AS round_id, r.round_number, r.theme, r.submission_deadline, r.guessing_deadline,
              EXISTS (SELECT 1 FROM submissions s WHERE s.round_id = r.id AND s.account_id = $1) AS submitted
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
        round: row.round_id ? summarizeRound(row, now) : null,
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
      deps.pool.query<SubmissionRow & { round_id: string }>(
        `SELECT s.round_id, s.account_id, s.service, s.title, s.artist, s.comment FROM submissions s
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
      const round = activity.get(row.round_id);
      if (!round) continue;
      round.submitterIds.push(row.account_id);
      if (row.account_id === accountId) round.yourSubmission = trackOf(row);
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

  // #84's stable per-round URL: the same round the season page draws, addressable on its own so a
  // link to a round survives the phase change that would otherwise make it wrong. The body comes
  // from describeRound, not from a second derivation here -- the anonymity rule (Principle 1) has
  // to live in exactly one place, and two copies of that branch is how the leak ships.
  router.get('/rounds/:roundId/overview', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const roundId = req.params.roundId;
    const round = await loadRound(deps.pool, roundId);
    // A round always has a league, so the two misses are the same miss to anyone asking.
    const league = round && (await loadLeague(deps.pool, round.leagueId));
    if (!round || !league) {
      res.status(404).json({ error: 'round not found' });
      return;
    }
    if (!(await isLeagueMember(deps.pool, round.leagueId, accountId))) {
      res.status(403).json({ error: 'join the league before viewing this round' });
      return;
    }

    const [membersResult, submissionsResult, guessesResult] = await Promise.all([
      deps.pool.query<{ account_id: string; display_name: string | null }>(
        `SELECT a.id AS account_id, a.display_name FROM league_members lm
         JOIN accounts a ON a.id = lm.account_id
         WHERE lm.league_id = $1
         ORDER BY lm.joined_at ASC`,
        [round.leagueId],
      ),
      // Same order as the league overview's, so the submitter list is the same list.
      deps.pool.query<SubmissionRow>(
        'SELECT account_id, service, title, artist, comment FROM submissions WHERE round_id = $1 ORDER BY created_at, id',
        [roundId],
      ),
      deps.pool.query<{ guesser_account_id: string; guess_count: string }>(
        `SELECT g.guesser_account_id, count(*) AS guess_count
         FROM guesses g
         JOIN submissions s ON s.id = g.submission_id
         WHERE s.round_id = $1
         GROUP BY g.guesser_account_id`,
        [roundId],
      ),
    ]);

    const players = new Map<string, Player>(
      membersResult.rows.map((row) => [row.account_id, { accountId: row.account_id, displayName: row.display_name }]),
    );
    const mine = submissionsResult.rows.find((row) => row.account_id === accountId);
    const activity: RoundActivity = {
      submitterIds: submissionsResult.rows.map((row) => row.account_id),
      guessCounts: new Map(guessesResult.rows.map((row) => [row.guesser_account_id, Number(row.guess_count)])),
      yourSubmission: mine ? trackOf(mine) : null,
    };

    // leagueId and leagueName ride along so the page can offer the way back up to the season hub
    // without a second request.
    res.json({
      leagueId: round.leagueId,
      leagueName: league.name,
      round: describeRound(
        {
          id: roundId,
          number: round.roundNumber,
          theme: round.theme,
          submissionDeadline: round.submissionDeadline,
          guessingDeadline: round.guessingDeadline,
        },
        activity,
        players,
        accountId,
        new Date(),
      ),
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
    // Every later round slides whole, submission_opens_at included: round N+1 opens as round N's
    // guessing closes (see POST /leagues above), so it moves with the boundary and keeps its
    // window length. Moving only round N's submission deadline touches no other round. The CTE
    // matches no row when this is the last round of the season or nothing slid.
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
                  submission_opens_at + $7::interval AS submission_opens_at,
                  submission_deadline + $7::interval AS submission_deadline,
                  guessing_deadline + $7::interval AS guessing_deadline
           FROM rounds
           WHERE league_id = $5
             AND round_number >= $6 AND $7::interval <> interval '0'
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

  // Rounds, memberships, submissions, guesses and notifications all hang off the league with
  // ON DELETE CASCADE, so one DELETE removes the whole season.
  router.delete('/leagues/:leagueId', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const league = await loadLeague(deps.pool, req.params.leagueId);
    if (!league) {
      res.status(404).json({ error: 'league not found' });
      return;
    }
    if (league.hostAccountId !== accountId) {
      res.status(403).json({ error: 'only the league host can delete a league' });
      return;
    }
    await deps.pool.query('DELETE FROM leagues WHERE id = $1', [req.params.leagueId]);
    res.status(204).end();
  });

  return router;
}
