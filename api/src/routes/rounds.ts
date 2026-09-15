import type { Pool } from 'pg';

/**
 * How to pick a league's current round now that every round of the season exists from creation
 * (#74): the earliest round still open, or the last round once the season is over. Plain
 * `round_number DESC` would name the final round of the season on day one.
 */
export const CURRENT_ROUND_CLAUSE = `ORDER BY
     (guessing_deadline > now()) DESC,
     CASE WHEN guessing_deadline > now() THEN round_number ELSE -round_number END ASC
   LIMIT 1`;

export interface Player {
  accountId: string;
  displayName: string | null;
}

export interface RoundInfo {
  leagueId: string;
  roundNumber: number;
  /** Null until the host names one: rounds 2..N are scheduled before anyone picks a theme. */
  theme: string | null;
  submissionDeadline: string;
  guessingDeadline: string;
}

export async function loadRound(pool: Pool, roundId: string): Promise<RoundInfo | null> {
  const result = await pool.query<{
    league_id: string;
    round_number: number;
    theme: string | null;
    submission_deadline: string;
    guessing_deadline: string;
  }>('SELECT league_id, round_number, theme, submission_deadline, guessing_deadline FROM rounds WHERE id = $1', [
    roundId,
  ]);
  const round = result.rows[0];
  return round
    ? {
        leagueId: round.league_id,
        roundNumber: round.round_number,
        theme: round.theme,
        submissionDeadline: round.submission_deadline,
        guessingDeadline: round.guessing_deadline,
      }
    : null;
}

export async function isLeagueMember(pool: Pool, leagueId: string, accountId: string): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM league_members WHERE league_id = $1 AND account_id = $2', [
    leagueId,
    accountId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export interface LeagueInfo {
  name: string;
  seasonLength: number;
  hostAccountId: string;
  /** Returned to every member, not just the host: joining needs no approval (#9). */
  inviteCode: string;
}

export async function loadLeague(pool: Pool, leagueId: string): Promise<LeagueInfo | null> {
  const result = await pool.query<{
    name: string;
    season_length: number;
    host_account_id: string;
    invite_code: string;
  }>('SELECT name, season_length, host_account_id, invite_code FROM leagues WHERE id = $1', [leagueId]);
  const league = result.rows[0];
  return league
    ? {
        name: league.name,
        seasonLength: league.season_length,
        hostAccountId: league.host_account_id,
        inviteCode: league.invite_code,
      }
    : null;
}

export interface CurrentRoundInfo {
  id: string;
  roundNumber: number;
  guessingDeadline: string;
}

export async function loadCurrentRound(pool: Pool, leagueId: string): Promise<CurrentRoundInfo | null> {
  const result = await pool.query<{ id: string; round_number: number; guessing_deadline: string }>(
    `SELECT id, round_number, guessing_deadline FROM rounds WHERE league_id = $1 ${CURRENT_ROUND_CLAUSE}`,
    [leagueId],
  );
  const round = result.rows[0];
  return round ? { id: round.id, roundNumber: round.round_number, guessingDeadline: round.guessing_deadline } : null;
}

/**
 * The season is over once the current round is the season's last and its guessing deadline has
 * passed. One definition, because final standings and the overview's `concluded` must agree.
 */
export function isSeasonConcluded(league: LeagueInfo, current: CurrentRoundInfo | null, now: Date): boolean {
  return !!current && current.roundNumber >= league.seasonLength && new Date(current.guessingDeadline) <= now;
}

export type RoundPhase = 'submission' | 'guessing' | 'results';

/** Derived from the two deadlines, never stored. The one phase rule, GET /leagues/mine included. */
export function roundPhase(round: { submissionDeadline: string; guessingDeadline: string }, now: Date): RoundPhase {
  if (now < new Date(round.submissionDeadline)) return 'submission';
  if (now < new Date(round.guessingDeadline)) return 'guessing';
  return 'results';
}

/** What actually happened in one round: who submitted, and how many guesses each player made. */
export interface RoundActivity {
  /** Account ids that submitted, in submission order. */
  submitterIds: string[];
  /** Guesses made in this round, keyed by guesser. */
  guessCounts: Map<string, number>;
}

export function emptyRoundActivity(): RoundActivity {
  return { submitterIds: [], guessCounts: new Map() };
}

/**
 * The one place the anonymity rule lives (PRODUCT.md Principle 1). Extracted for the league
 * overview so #84's single-round view reuses this branch rather than growing a second copy --
 * two copies of the anonymity branch is exactly how the leak ships.
 *
 * `submitters` is present while submissions are open -- nobody is guessing yet and nagging the
 * stragglers is the point -- and again at results, where GET /rounds/:roundId/results already
 * names every submitter. It is *omitted by the server* during guessing, because naming who has
 * not submitted narrows the pool: with MIN_PLAYERS = 4, one missing name in a five-player round
 * is close to decisive about the fifth track. A field the client is trusted not to render is a
 * field that leaks the first time someone opens devtools.
 *
 * `guessedPlayers` is safe in every phase: it says who has answered, never what they answered.
 */
export function describeRound(
  round: { id: string; number: number; theme: string | null; submissionDeadline: string; guessingDeadline: string },
  activity: RoundActivity,
  players: Map<string, Player>,
  viewerAccountId: string,
  now: Date,
) {
  const phase = roundPhase(round, now);
  const submitters = new Set(activity.submitterIds);
  // Everything in the round except your own track; a player who never submitted owes a guess on
  // all of them.
  const owedCount = (accountId: string) => submitters.size - (submitters.has(accountId) ? 1 : 0);
  const guessesMade = (accountId: string) => activity.guessCounts.get(accountId) ?? 0;

  return {
    ...round,
    phase,
    submittedCount: submitters.size,
    ...(phase === 'guessing'
      ? {}
      : {
          submitters: activity.submitterIds.map(
            (id) => players.get(id) ?? { accountId: id, displayName: null },
          ),
        }),
    guessedPlayers: [...players.values()].filter(
      (p) => guessesMade(p.accountId) > 0 && guessesMade(p.accountId) >= owedCount(p.accountId),
    ),
    you: {
      submitted: submitters.has(viewerAccountId),
      guessesRemaining: Math.max(0, owedCount(viewerAccountId) - guessesMade(viewerAccountId)),
    },
  };
}
