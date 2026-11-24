import { randomBytes } from 'node:crypto';
import { Router, type Response } from 'express';
import type { Pool } from 'pg';
import type { ServiceName } from '../adapters/types.js';
import { playbackFor, thumbnailFor, type AdapterRegistry } from '../adapters/registry.js';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import {
  isLeagueMember,
  loadCurrentRound,
  loadLeague,
  loadRound,
  type Player,
} from './rounds.js';
import { CURRENT_ROUND_CLAUSE, isSeasonConcluded, roundPhase, roundSql } from '../roundTimeline.js';
import { checkDeadlineOrder, deleteRound, editRound, insertSeason, planSeason, type Refusal, type RoundRow } from '../seasonSchedule.js';
import { asPlayer, describeRound, emptyRoundActivity, rosterFor, type RoundActivity } from '../visibility.js';
import { correctGuessCounts, scoreboard } from './results.js';

export type LeaguesDeps = AccountsDeps & AdapterRegistry;

/** The shelf's view of a league's current round: what phase it is in, and whether that phase is live. */
function summarizeRound(
  row: {
    round_id: string | null;
    round_number: number | null;
    theme: string | null;
    submission_opens_at: string | null;
    submission_deadline: string | null;
    guessing_deadline: string | null;
    submitted: boolean;
  },
  now: Date,
) {
  const phase = roundPhase(
    { submissionOpensAt: row.submission_opens_at, submissionDeadline: row.submission_deadline!, guessingDeadline: row.guessing_deadline! },
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

interface SubmissionRow {
  account_id: string;
  service: ServiceName;
  external_id: string;
  art_id: string | null;
  page_url?: string | null;
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
const trackOf = (deps: AdapterRegistry, row: SubmissionRow) => ({ service: row.service, title: row.title, artist: row.artist, thumbnailUrl: thumbnailFor(deps, row), comment: row.comment ?? null });

/** The viewer's own track, plus what they need to preview it: its id and the link out. */
const ownTrackOf = async (deps: AdapterRegistry, row: SubmissionRow & { id: string; isrc: string | null }) => ({
  ...trackOf(deps, row),
  submissionId: row.id,
  playback: await playbackFor(deps, row),
});

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
    submissionOpensAt: round.submission_opens_at,
    submissionDeadline: round.submission_deadline,
    guessingDeadline: round.guessing_deadline,
  };
}

// Generous: the client sends the moment it opened the form, which may be a while ago.
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

const REFUSAL_STATUS = { invalid: 400, conflict: 409, missing: 404 } as const;
const refuse = (res: Response, r: Refusal) =>
  res.status(REFUSAL_STATUS[r.refused]).json({ error: r.error });

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

/** The account's leagues with their current round, for /leagues/mine and the public profile. */
export async function listLeagues(pool: Pool, accountId: string) {
  const result = await pool.query<{
    league_id: string;
    league_name: string;
    season_length: number;
    joined_at: string;
    round_id: string | null;
    round_number: number | null;
    theme: string | null;
    submission_opens_at: string | null;
    submission_deadline: string | null;
    guessing_deadline: string | null;
    submitted: boolean;
  }>(
    `SELECT l.id AS league_id, l.name AS league_name, l.season_length, lm.joined_at,
            r.id AS round_id, r.round_number, r.theme, r.submission_opens_at, r.submission_deadline, r.guessing_deadline,
            EXISTS (SELECT 1 FROM submissions s WHERE s.round_id = r.id AND s.account_id = $1) AS submitted
     FROM leagues l
     JOIN league_members lm ON lm.league_id = l.id AND lm.account_id = $1
     LEFT JOIN LATERAL (
       SELECT id, round_number, theme, submission_opens_at, submission_deadline, guessing_deadline
       FROM rounds WHERE league_id = l.id ${CURRENT_ROUND_CLAUSE}
     ) r ON true
     ORDER BY l.name`,
    [accountId],
  );

  const now = new Date();
  return result.rows.map((row) => ({
    id: row.league_id,
    name: row.league_name,
    seasonLength: row.season_length,
    joinedAt: row.joined_at,
    concluded: isSeasonConcluded(
      row.season_length,
      row.round_id ? { roundNumber: row.round_number!, guessingDeadline: row.guessing_deadline! } : null,
      now,
    ),
    round: row.round_id ? summarizeRound(row, now) : null,
  }));
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

      // Round 1's theme is its own field; the rest come from `themes`.
      const rounds = await insertSeason(
        client,
        leagueId,
        planSeason({ createdAt, submissionDeadline: submissionAt, guessingDeadline: guessingAt, seasonLength }),
        [theme, ...seasonThemes.slice(1)],
      );
      const firstRound = rounds.find((row) => row.round_number === 1)!;

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
        `SELECT id, round_number, theme, submission_opens_at, submission_deadline, guessing_deadline FROM rounds WHERE league_id = $1 ${CURRENT_ROUND_CLAUSE}`,
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

    const removed = await deps.pool.query('SELECT 1 FROM league_removed WHERE league_id = $1 AND account_id = $2', [league.id, accountId]);
    if (removed.rowCount) {
      res.status(403).json({ error: 'the host removed you from this league' });
      return;
    }

    if (await isLeagueMember(deps.pool, league.id, accountId)) {
      res.status(409).json({ error: "You're already in this league" });
      return;
    }

    // No current round = every round is finished: the season is over.
    const current = await deps.pool.query(
      `SELECT 1 FROM rounds WHERE league_id = $1 ${CURRENT_ROUND_CLAUSE}`,
      [league.id],
    );
    if (!current.rowCount) {
      res.status(410).json({ error: 'This league is over' });
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
    res.json({ leagues: await listLeagues(deps.pool, accountId) });
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
      `SELECT id, round_number, theme, submission_opens_at, submission_deadline, guessing_deadline
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

    const [roster, roundsResult, submissionsResult, guessesResult, correctGuesses, current] = await Promise.all([
      // Driven off league_members rather than off guesses, so a player who has done nothing is
      // still on the roster and still in the standings on zero.
      rosterFor(deps.pool, leagueId, accountId),
      deps.pool.query<RoundRow & { scored: boolean }>(
        // `scored` comes from Postgres's clock, not the app's: correctGuessCounts filters on the
        // same now(), so "after 3 of 8 rounds" can never disagree with the standings beside it.
        `SELECT id, round_number, theme, submission_opens_at, submission_deadline, guessing_deadline,
                ${roundSql().scored} AS scored
         FROM rounds WHERE league_id = $1 ORDER BY round_number`,
        [leagueId],
      ),
      deps.pool.query<SubmissionRow & { id: string; isrc: string | null; round_id: string }>(
        `SELECT s.id, s.isrc, s.round_id, s.account_id, s.service, s.external_id, s.art_id, s.page_url, s.title, s.artist, s.comment FROM submissions s
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
    const players = new Map<string, Player>(roster.map((p) => [p.accountId, asPlayer(p)]));

    const activity = new Map<string, RoundActivity>(roundsResult.rows.map((row) => [row.id, emptyRoundActivity()]));
    for (const row of submissionsResult.rows) {
      const round = activity.get(row.round_id);
      if (!round) continue;
      round.submitterIds.push(row.account_id);
      if (row.account_id === accountId) round.yourSubmission = await ownTrackOf(deps, row);
    }
    for (const row of guessesResult.rows) {
      activity.get(row.round_id)?.guessCounts.set(row.guesser_account_id, Number(row.guess_count));
    }

    const concluded = isSeasonConcluded(league.seasonLength, current, now);
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
      members: roster,
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

    const [roster, submissionsResult, guessesResult] = await Promise.all([
      rosterFor(deps.pool, round.leagueId, accountId),
      // Same order as the league overview's, so the submitter list is the same list.
      deps.pool.query<SubmissionRow & { id: string; isrc: string | null }>(
        'SELECT id, account_id, service, external_id, art_id, page_url, title, artist, isrc, comment FROM submissions WHERE round_id = $1 ORDER BY created_at, id',
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

    const players = new Map<string, Player>(roster.map((p) => [p.accountId, asPlayer(p)]));
    const mine = submissionsResult.rows.find((row) => row.account_id === accountId);
    const activity: RoundActivity = {
      submitterIds: submissionsResult.rows.map((row) => row.account_id),
      guessCounts: new Map(guessesResult.rows.map((row) => [row.guesser_account_id, Number(row.guess_count)])),
      yourSubmission: mine ? await ownTrackOf(deps, mine) : null,
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
          submissionOpensAt: round.submissionOpensAt,
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
    const updated = await editRound(
      deps.pool,
      round.leagueId,
      req.params.roundId,
      {
        theme: theme === undefined ? undefined : (theme as string).trim(),
        submissionDeadline: submissionDeadline === undefined ? undefined : new Date(submissionDeadline as string),
        guessingDeadline: guessingDeadline === undefined ? undefined : new Date(guessingDeadline as string),
      },
      new Date(),
    );
    if ('refused' in updated) {
      refuse(res, updated);
      return;
    }
    // Every round this wrote, not just the patched one: a one-round patch that silently moves the
    // season's end date is a surprise, and the schedule screen has to redraw all of them.
    res.json({ rounds: updated.map(serializeRound) });
  });

  // Host drops a round from the season; the rules live in seasonSchedule.ts.
  router.delete('/rounds/:roundId', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const round = await loadRound(deps.pool, req.params.roundId);
    if (!round) {
      res.status(404).json({ error: 'round not found' });
      return;
    }
    const league = await loadLeague(deps.pool, round.leagueId);
    if (league?.hostAccountId !== accountId) {
      res.status(403).json({ error: 'only the league host can delete a round' });
      return;
    }
    const refusal = await deleteRound(deps.pool, round.leagueId, req.params.roundId, new Date());
    if (refusal) {
      refuse(res, refusal);
      return;
    }
    res.status(204).end();
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

  // Host removes a player. Their tracks and guesses go with them: leaving a ghost submission in the
  // current round would keep counting toward "N of M submitted" and still be guessable.
  router.delete('/leagues/:leagueId/members/:accountId', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const { leagueId, accountId: targetId } = req.params;
    const league = await loadLeague(deps.pool, leagueId);
    if (!league) {
      res.status(404).json({ error: 'league not found' });
      return;
    }
    if (league.hostAccountId !== accountId) {
      res.status(403).json({ error: 'only the league host can remove players' });
      return;
    }
    if (targetId === league.hostAccountId) {
      res.status(400).json({ error: 'the host cannot be removed; delete the league instead' });
      return;
    }
    const client = await deps.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM guesses WHERE guesser_account_id = $2
           AND submission_id IN (SELECT s.id FROM submissions s JOIN rounds r ON r.id = s.round_id WHERE r.league_id = $1)`,
        [leagueId, targetId],
      );
      await client.query(
        `DELETE FROM submissions WHERE account_id = $2 AND round_id IN (SELECT id FROM rounds WHERE league_id = $1)`,
        [leagueId, targetId],
      );
      const removed = await client.query('DELETE FROM league_members WHERE league_id = $1 AND account_id = $2', [leagueId, targetId]);
      if (removed.rowCount) {
        await client.query('INSERT INTO league_removed (league_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [leagueId, targetId]);
      }
      await client.query('COMMIT');
      if (removed.rowCount === 0) {
        res.status(404).json({ error: 'that player is not in this league' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  return router;
}
