import type { Pool } from 'pg';
import { CURRENT_ROUND_CLAUSE } from '../roundTimeline.js';

export interface Player {
  accountId: string;
  displayName: string | null;
  avatarUrl?: string | null;
}

export interface RoundInfo {
  leagueId: string;
  roundNumber: number;
  /** Null until the host names one: rounds 2..N are scheduled before anyone picks a theme. */
  theme: string | null;
  /** Null on legacy rows that predate the column: treated as already open. */
  submissionOpensAt: string | null;
  submissionDeadline: string;
  guessingDeadline: string;
}

export async function loadRound(pool: Pool, roundId: string): Promise<RoundInfo | null> {
  const result = await pool.query<{
    league_id: string;
    round_number: number;
    theme: string | null;
    submission_opens_at: string | null;
    submission_deadline: string;
    guessing_deadline: string;
  }>(
    `SELECT league_id, round_number, theme, submission_opens_at, submission_deadline, guessing_deadline
     FROM rounds WHERE id = $1`,
    [roundId],
  );
  const round = result.rows[0];
  return round
    ? {
        leagueId: round.league_id,
        roundNumber: round.round_number,
        theme: round.theme,
        submissionOpensAt: round.submission_opens_at,
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
