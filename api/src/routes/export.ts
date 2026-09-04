import { Router } from 'express';
import { adapterFor, playbackAdapterFor, type AdapterRegistry } from '../adapters/registry.js';
import { resolveMatch } from '../adapters/matchCache.js';
import type { PlaybackLaunchHandle, ServiceName, TrackResult } from '../adapters/types.js';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { isLeagueMember, loadRound } from './rounds.js';

export interface ExportDeps extends AccountsDeps, AdapterRegistry {}

type ExportableService = Exclude<ServiceName, 'bandcamp'>;
const EXPORTABLE_SERVICES: ExportableService[] = ['spotify', 'apple_music', 'youtube_music'];

interface SubmissionRow {
  id: string;
  service: ExportableService;
  external_id: string;
  title: string;
  artist: string;
  isrc: string | null;
}

interface SkippedTrack {
  submissionId: string;
  title: string;
  artist: string;
  playback: PlaybackLaunchHandle;
}

async function exportForService(
  deps: ExportDeps,
  roundId: string,
  accountId: string,
  service: ExportableService,
  accessToken: string,
  playlistName: string,
  submissions: SubmissionRow[],
): Promise<{ service: ExportableService; playlistExternalId: string | null; matchedCount: number; skipped: SkippedTrack[] }> {
  const adapter = adapterFor(deps, service);

  const existing = await deps.pool.query<{ playlist_external_id: string | null; matched_submission_ids: string[] }>(
    'SELECT playlist_external_id, matched_submission_ids FROM round_exports WHERE round_id = $1 AND account_id = $2 AND service = $3',
    [roundId, accountId, service],
  );

  let playlistExternalId: string | null;
  let matchedIds: Set<string>;

  if (existing.rowCount) {
    playlistExternalId = existing.rows[0].playlist_external_id;
    matchedIds = new Set(existing.rows[0].matched_submission_ids);
  } else {
    const matches = new Map<string, TrackResult>();
    for (const submission of submissions) {
      // A submission already on this exact service is a confirmed match; no need to re-search.
      const match =
        submission.service === service
          ? {
              externalId: submission.external_id,
              title: submission.title,
              artist: submission.artist,
              isrc: submission.isrc ?? undefined,
              service,
            }
          : await resolveMatch(deps.pool, adapter, {
              title: submission.title,
              artist: submission.artist,
              isrc: submission.isrc ?? undefined,
            });
      if (match) matches.set(submission.id, match);
    }

    playlistExternalId = null;
    if (matches.size > 0) {
      const playlist = await adapter.createPlaylist(accessToken, playlistName);
      await adapter.appendToPlaylist(accessToken, playlist, [...matches.values()]);
      playlistExternalId = playlist.externalId;
    }
    matchedIds = new Set(matches.keys());

    // ponytail: no locking against a concurrent duplicate request for the same round+account+service;
    // the UNIQUE constraint keeps the *record* to one row, but a genuine race could still create two
    // playlists upstream. Add a per-key advisory lock if double-exports show up in practice.
    await deps.pool.query(
      `INSERT INTO round_exports (round_id, account_id, service, playlist_external_id, matched_submission_ids)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (round_id, account_id, service) DO NOTHING`,
      [roundId, accountId, service, playlistExternalId, [...matchedIds]],
    );
  }

  const skipped = await Promise.all(
    submissions
      .filter((s) => !matchedIds.has(s.id))
      .map(async (s) => ({
        submissionId: s.id,
        title: s.title,
        artist: s.artist,
        playback: await playbackAdapterFor(deps, s.service).getPlaybackLaunchHandle({
          externalId: s.external_id,
          title: s.title,
          artist: s.artist,
          isrc: s.isrc ?? undefined,
          service: s.service,
        }),
      })),
  );

  return { service, playlistExternalId, matchedCount: matchedIds.size, skipped };
}

export function createExportRouter(deps: ExportDeps): Router {
  const router = Router();

  router.post('/rounds/:roundId/export', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const round = await loadRound(deps.pool, req.params.roundId);
    if (!round) {
      res.status(404).json({ error: 'round not found' });
      return;
    }
    if (!(await isLeagueMember(deps.pool, round.leagueId, accountId))) {
      res.status(403).json({ error: 'join the league before exporting this round' });
      return;
    }
    if (new Date(round.guessingDeadline) > new Date()) {
      res.status(403).json({ error: 'export is not available until the guessing deadline passes' });
      return;
    }

    const submissionsResult = await deps.pool.query<SubmissionRow>(
      `SELECT id, service, external_id, title, artist, isrc FROM submissions
       WHERE round_id = $1 AND service != 'bandcamp' ORDER BY id`,
      [req.params.roundId],
    );

    const linksResult = await deps.pool.query<{ service: ExportableService; access_token: string }>(
      'SELECT service, access_token FROM service_links WHERE account_id = $1 AND service = ANY($2)',
      [accountId, EXPORTABLE_SERVICES],
    );
    const accessTokenByService = new Map(linksResult.rows.map((row) => [row.service, row.access_token]));

    const playlistName = `Mixtape Party — Round ${round.roundNumber}: ${round.theme}`;
    const services = await Promise.all(
      EXPORTABLE_SERVICES.filter((service) => accessTokenByService.has(service)).map((service) =>
        exportForService(
          deps,
          req.params.roundId,
          accountId,
          service,
          accessTokenByService.get(service)!,
          playlistName,
          submissionsResult.rows,
        ),
      ),
    );

    res.json({ services });
  });

  return router;
}
