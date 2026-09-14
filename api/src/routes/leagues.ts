import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Pool } from 'pg';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { CURRENT_ROUND_CLAUSE } from './rounds.js';

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

function parseRoundInput(
  body: unknown,
): { theme: string; submissionAt: Date; guessingAt: Date } | { error: string } {
  const { theme, submissionDeadline, guessingDeadline } = (body ?? {}) as Record<string, unknown>;
  if (typeof theme !== 'string' || theme.trim().length === 0) {
    return { error: 'theme is required' };
  }
  const submissionAt = new Date(submissionDeadline as string);
  const guessingAt = new Date(guessingDeadline as string);
  if (Number.isNaN(submissionAt.getTime()) || Number.isNaN(guessingAt.getTime())) {
    return { error: 'submissionDeadline and guessingDeadline must be valid dates' };
  }
  if (guessingAt <= submissionAt) {
    return { error: 'guessingDeadline must be after submissionDeadline' };
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

  return router;
}
