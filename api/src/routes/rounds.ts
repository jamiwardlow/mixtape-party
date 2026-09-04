import type { Pool } from 'pg';

export interface RoundInfo {
  leagueId: string;
  submissionDeadline: string;
  guessingDeadline: string;
}

export async function loadRound(pool: Pool, roundId: string): Promise<RoundInfo | null> {
  const result = await pool.query<{ league_id: string; submission_deadline: string; guessing_deadline: string }>(
    'SELECT league_id, submission_deadline, guessing_deadline FROM rounds WHERE id = $1',
    [roundId],
  );
  const round = result.rows[0];
  return round
    ? { leagueId: round.league_id, submissionDeadline: round.submission_deadline, guessingDeadline: round.guessing_deadline }
    : null;
}

export async function isLeagueMember(pool: Pool, leagueId: string, accountId: string): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM league_members WHERE league_id = $1 AND account_id = $2', [
    leagueId,
    accountId,
  ]);
  return (result.rowCount ?? 0) > 0;
}
