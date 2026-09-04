import type { Pool } from 'pg';

export interface RoundInfo {
  leagueId: string;
  roundNumber: number;
  theme: string;
  submissionDeadline: string;
  guessingDeadline: string;
}

export async function loadRound(pool: Pool, roundId: string): Promise<RoundInfo | null> {
  const result = await pool.query<{
    league_id: string;
    round_number: number;
    theme: string;
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

export interface LatestRoundInfo {
  id: string;
  roundNumber: number;
  guessingDeadline: string;
}

export async function loadLatestRound(pool: Pool, leagueId: string): Promise<LatestRoundInfo | null> {
  const result = await pool.query<{ id: string; round_number: number; guessing_deadline: string }>(
    'SELECT id, round_number, guessing_deadline FROM rounds WHERE league_id = $1 ORDER BY round_number DESC LIMIT 1',
    [leagueId],
  );
  const round = result.rows[0];
  return round ? { id: round.id, roundNumber: round.round_number, guessingDeadline: round.guessing_deadline } : null;
}
