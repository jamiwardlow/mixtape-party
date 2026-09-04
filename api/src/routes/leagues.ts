import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Pool } from 'pg';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { loadLeague, loadLatestRound } from './rounds.js';

export type LeaguesDeps = AccountsDeps;

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
  theme: string;
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
    if (typeof seasonLength !== 'number' || !Number.isInteger(seasonLength) || seasonLength < 1) {
      res.status(400).json({ error: 'seasonLength must be a positive integer' });
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

      const round = await client.query<RoundRow>(
        `INSERT INTO rounds (league_id, round_number, theme, submission_deadline, guessing_deadline)
         VALUES ($1, 1, $2, $3, $4) RETURNING id, round_number, theme, submission_deadline, guessing_deadline`,
        [leagueId, theme, submissionAt.toISOString(), guessingAt.toISOString()],
      );

      await client.query('INSERT INTO league_members (league_id, account_id) VALUES ($1, $2)', [
        leagueId,
        accountId,
      ]);

      await client.query('COMMIT');

      res.status(201).json({
        leagueId,
        inviteCode,
        round: serializeRound(round.rows[0]),
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
        'SELECT id, round_number, theme, submission_deadline, guessing_deadline FROM rounds WHERE league_id = $1 ORDER BY round_number DESC LIMIT 1',
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

    const linkedService = await deps.pool.query('SELECT 1 FROM service_links WHERE account_id = $1 LIMIT 1', [
      accountId,
    ]);
    if (linkedService.rowCount === 0) {
      res.status(403).json({ error: 'link a music service before joining a league' });
      return;
    }

    await deps.pool.query(
      'INSERT INTO league_members (league_id, account_id) VALUES ($1, $2) ON CONFLICT (league_id, account_id) DO NOTHING',
      [league.id, accountId],
    );

    res.json({ leagueId: league.id });
  });

  router.post('/leagues/:leagueId/rounds', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const league = await loadLeague(deps.pool, req.params.leagueId);
    if (!league) {
      res.status(404).json({ error: 'league not found' });
      return;
    }
    if (league.hostAccountId !== accountId) {
      res.status(403).json({ error: 'only the host can start the next round' });
      return;
    }

    const latest = (await loadLatestRound(deps.pool, req.params.leagueId))!;
    if (new Date(latest.guessingDeadline) > new Date()) {
      res.status(403).json({ error: 'wait for the current round to be revealed before starting the next round' });
      return;
    }
    if (latest.roundNumber >= league.seasonLength) {
      res.status(409).json({ error: 'the season has concluded' });
      return;
    }

    const parsed = parseRoundInput(req.body);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const round = await deps.pool.query<RoundRow>(
      `INSERT INTO rounds (league_id, round_number, theme, submission_deadline, guessing_deadline)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, round_number, theme, submission_deadline, guessing_deadline`,
      [
        req.params.leagueId,
        latest.roundNumber + 1,
        parsed.theme,
        parsed.submissionAt.toISOString(),
        parsed.guessingAt.toISOString(),
      ],
    );

    res.status(201).json({ round: serializeRound(round.rows[0]) });
  });

  return router;
}
