import { Router } from 'express';
import { buildFavoriteExports, buildRoundExports, type PlaylistExportDeps } from '../playlistExport.js';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { loadRound } from '../rounds.js';
import { gateError } from '../visibility.js';

export interface ExportDeps extends AccountsDeps, PlaylistExportDeps {}

export function createExportRouter(deps: ExportDeps): Router {
  const router = Router();

  router.post('/rounds/:roundId/export', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const round = await loadRound(deps.pool, req.params.roundId);
    if (!round) {
      res.status(404).json({ error: 'round not found' });
      return;
    }
    const guardError = await gateError(deps.pool, accountId, round, 'guessing');
    if (guardError) {
      res.status(guardError.status).json({ error: guardError.error });
      return;
    }

    const services = await buildRoundExports(deps, req.params.roundId, accountId);
    res.json({ services });
  });

  router.post('/favorites/export', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const services = await buildFavoriteExports(deps, accountId);
    res.json({ services });
  });

  return router;
}
