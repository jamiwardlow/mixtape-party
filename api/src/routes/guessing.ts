import { Router } from 'express';
import type { Pool } from 'pg';
import type { MusicServiceAdapter } from '../adapters/types.js';
import { isUniqueViolation, requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { isLeagueMember, loadRound } from './rounds.js';

export interface GuessingDeps extends AccountsDeps {
  spotifyAdapter: MusicServiceAdapter;
}

const MIN_PLAYERS = 4;

async function countLeagueMembers(pool: Pool, leagueId: string): Promise<number> {
  const result = await pool.query('SELECT count(*)::int AS count FROM league_members WHERE league_id = $1', [
    leagueId,
  ]);
  return result.rows[0].count;
}

async function guessingGuardError(
  pool: Pool,
  leagueId: string,
  accountId: string,
  submissionDeadline: string,
): Promise<{ status: number; error: string } | null> {
  if (!(await isLeagueMember(pool, leagueId, accountId))) {
    return { status: 403, error: 'join the league before guessing on this round' };
  }
  if (new Date(submissionDeadline) > new Date()) {
    return { status: 403, error: 'guessing has not opened yet for this round' };
  }
  if ((await countLeagueMembers(pool, leagueId)) < MIN_PLAYERS) {
    return { status: 403, error: `this round needs at least ${MIN_PLAYERS} players before guessing can proceed` };
  }
  return null;
}

export function createGuessingRouter(deps: GuessingDeps): Router {
  const router = Router();

  router.get('/rounds/:roundId/guessing', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const round = await loadRound(deps.pool, req.params.roundId);
    if (!round) {
      res.status(404).json({ error: 'round not found' });
      return;
    }
    const guardError = await guessingGuardError(deps.pool, round.leagueId, accountId, round.submissionDeadline);
    if (guardError) {
      res.status(guardError.status).json({ error: guardError.error });
      return;
    }

    const playersResult = await deps.pool.query<{ account_id: string; display_name: string | null }>(
      `SELECT a.id AS account_id, a.display_name FROM league_members lm
       JOIN accounts a ON a.id = lm.account_id
       WHERE lm.league_id = $1 AND lm.account_id != $2
       ORDER BY a.display_name`,
      [round.leagueId, accountId],
    );

    const submissions = await deps.pool.query<{
      id: string;
      service: 'spotify' | 'apple_music' | 'youtube_music' | 'bandcamp';
      external_id: string;
      title: string;
      artist: string;
      isrc: string | null;
      guessed_account_id: string | null;
    }>(
      `SELECT s.id, s.service, s.external_id, s.title, s.artist, s.isrc, g.guessed_account_id
       FROM submissions s
       LEFT JOIN guesses g ON g.submission_id = s.id AND g.guesser_account_id = $1
       WHERE s.round_id = $2 AND s.account_id != $1
       ORDER BY s.id`,
      [accountId, req.params.roundId],
    );

    const tracks = await Promise.all(
      submissions.rows.map(async (row) => {
        const playback = await deps.spotifyAdapter.getPlaybackLaunchHandle({
          externalId: row.external_id,
          title: row.title,
          artist: row.artist,
          isrc: row.isrc ?? undefined,
          service: row.service,
        });
        return {
          submissionId: row.id,
          service: row.service,
          title: row.title,
          artist: row.artist,
          playback,
          guessedAccountId: row.guessed_account_id,
        };
      }),
    );

    res.json({
      tracks,
      players: playersResult.rows.map((row) => ({ accountId: row.account_id, displayName: row.display_name })),
    });
  });

  router.post('/rounds/:roundId/submissions/:submissionId/guesses', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const { guessedAccountId } = req.body ?? {};
    if (typeof guessedAccountId !== 'string' || guessedAccountId.trim().length === 0) {
      res.status(400).json({ error: 'guessedAccountId is required' });
      return;
    }

    const submission = await deps.pool.query<{
      submitter_account_id: string;
      league_id: string;
      submission_deadline: string;
    }>(
      `SELECT sub.account_id AS submitter_account_id, r.league_id, r.submission_deadline
       FROM submissions sub
       JOIN rounds r ON r.id = sub.round_id
       WHERE sub.id = $1 AND sub.round_id = $2`,
      [req.params.submissionId, req.params.roundId],
    );
    const row = submission.rows[0];
    if (!row) {
      res.status(404).json({ error: 'submission not found' });
      return;
    }

    const guardError = await guessingGuardError(deps.pool, row.league_id, accountId, row.submission_deadline);
    if (guardError) {
      res.status(guardError.status).json({ error: guardError.error });
      return;
    }
    if (row.submitter_account_id === accountId) {
      res.status(403).json({ error: 'you cannot guess on your own submission' });
      return;
    }
    if (!(await isLeagueMember(deps.pool, row.league_id, guessedAccountId))) {
      res.status(400).json({ error: 'guessedAccountId must be a member of this round\'s league' });
      return;
    }

    try {
      const guess = await deps.pool.query<{ id: string }>(
        'INSERT INTO guesses (submission_id, guesser_account_id, guessed_account_id) VALUES ($1, $2, $3) RETURNING id',
        [req.params.submissionId, accountId, guessedAccountId],
      );
      res.status(201).json({ guessId: guess.rows[0].id });
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: 'already guessed on this track' });
        return;
      }
      throw err;
    }
  });

  return router;
}
