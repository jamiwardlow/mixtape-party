import { Router } from 'express';
import type { MusicServiceAdapter } from '../adapters/types.js';
import { isUniqueViolation, requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { isLeagueMember, loadRound } from './rounds.js';

export interface SubmissionsDeps extends AccountsDeps {
  spotifyAdapter: MusicServiceAdapter;
}

export function createSubmissionsRouter(deps: SubmissionsDeps): Router {
  const router = Router();

  router.get('/search', requireAuth(deps), async (req, res) => {
    const query = req.query.q;
    if (typeof query !== 'string' || query.trim().length === 0) {
      res.status(400).json({ error: 'q is required' });
      return;
    }
    const results = await deps.spotifyAdapter.search(query);
    res.json({ results });
  });

  router.post('/rounds/:roundId/submissions', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const { externalId, title, artist, isrc } = req.body ?? {};
    if (
      typeof externalId !== 'string' ||
      typeof title !== 'string' ||
      typeof artist !== 'string' ||
      (isrc !== undefined && isrc !== null && typeof isrc !== 'string')
    ) {
      res.status(400).json({ error: 'externalId, title, and artist are required' });
      return;
    }

    const round = await loadRound(deps.pool, req.params.roundId);
    if (!round) {
      res.status(404).json({ error: 'round not found' });
      return;
    }

    if (!(await isLeagueMember(deps.pool, round.leagueId, accountId))) {
      res.status(403).json({ error: 'join the league before submitting to this round' });
      return;
    }

    if (new Date(round.submissionDeadline) <= new Date()) {
      res.status(403).json({ error: 'the submission window for this round has closed' });
      return;
    }

    const matched = await deps.spotifyAdapter.match({ title, artist, isrc: isrc ?? undefined });
    if (!matched) {
      res.status(400).json({ error: 'track not found in Spotify catalog' });
      return;
    }

    try {
      const submission = await deps.pool.query<{ id: string }>(
        `INSERT INTO submissions (round_id, account_id, service, external_id, title, artist, isrc)
         VALUES ($1, $2, 'spotify', $3, $4, $5, $6) RETURNING id`,
        [req.params.roundId, accountId, externalId, title, artist, isrc ?? null],
      );
      res.status(201).json({ submissionId: submission.rows[0].id });
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: 'already submitted a track to this round' });
        return;
      }
      throw err;
    }
  });

  return router;
}
