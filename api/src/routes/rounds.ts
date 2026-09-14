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
  seasonLength: number;
  hostAccountId: string;
}

export async function loadLeague(pool: Pool, leagueId: string): Promise<LeagueInfo | null> {
  const result = await pool.query<{ season_length: number; host_account_id: string }>(
    'SELECT season_length, host_account_id FROM leagues WHERE id = $1',
    [leagueId],
  );
  const league = result.rows[0];
  return league ? { seasonLength: league.season_length, hostAccountId: league.host_account_id } : null;
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
