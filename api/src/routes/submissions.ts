import { Router } from 'express';
import type { ServiceName } from '../adapters/types.js';
import { adapterFor, type AdapterRegistry } from '../adapters/registry.js';
import { isUniqueViolation, requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { isLeagueMember, loadRound } from './rounds.js';

export interface SubmissionsDeps extends AccountsDeps, AdapterRegistry {}

function parseService(value: unknown): ServiceName | null {
  if (value === undefined) return 'spotify'; // back-compat default for clients predating Apple Music support
  if (value === 'spotify' || value === 'apple_music') return value;
  return null;
}

export function createSubmissionsRouter(deps: SubmissionsDeps): Router {
  const router = Router();

  router.get('/search', requireAuth(deps), async (req, res) => {
    const query = req.query.q;
    if (typeof query !== 'string' || query.trim().length === 0) {
      res.status(400).json({ error: 'q is required' });
      return;
    }
    const service = parseService(req.query.service);
    if (!service) {
      res.status(400).json({ error: 'unsupported service' });
      return;
    }

    const results = await adapterFor(deps, service).search(query);
    res.json({ results });
  });

  router.post('/rounds/:roundId/submissions', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const { externalId, title, artist, isrc } = req.body ?? {};
    const service = parseService((req.body ?? {}).service);
    if (
      !service ||
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

    const matched = await adapterFor(deps, service).match({ title, artist, isrc: isrc ?? undefined });
    if (!matched) {
      res.status(400).json({ error: 'track not found in catalog' });
      return;
    }

    try {
      const submission = await deps.pool.query<{ id: string }>(
        `INSERT INTO submissions (round_id, account_id, service, external_id, title, artist, isrc)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.params.roundId, accountId, service, externalId, title, artist, isrc ?? null],
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
