import { Router } from 'express';
import { adapterFor, playbackAdapterFor, type AdapterRegistry } from '../adapters/registry.js';
import { resolveMatch } from '../adapters/matchCache.js';
import type { PlaybackLaunchHandle, ServiceName, TrackResult } from '../adapters/types.js';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { isLeagueMember, loadRound } from './rounds.js';

export interface ExportDeps extends AccountsDeps, AdapterRegistry {
  youtubeMusicCookie?: string;
}

type ExportableService = Exclude<ServiceName, 'bandcamp'>;
const EXPORTABLE_SERVICES: ExportableService[] = ['apple_music', 'youtube_music'];

/**
 * Web address of an exported playlist, the only form of it a client can open (#69). Per-track
 * launch handles come from the adapters; a playlist has no adapter method because the id read back
 * out of `round_exports` is all there is to build one from.
 */
const PLAYLIST_URL: Record<ExportableService, (externalId: string) => string> = {
  // A library playlist is addressed without a storefront, and only its owner can open it.
  apple_music: (externalId) => `https://music.apple.com/library/playlist/${externalId}`,
  // UNLISTED under the shared server-held account, so this link plays for anyone who has it.
  youtube_music: (externalId) => `https://music.youtube.com/playlist?list=${externalId}`,
};

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
): Promise<{
  service: ExportableService;
  playlistExternalId: string | null;
  playlistUrl: string | null;
  matchedCount: number;
  skipped: SkippedTrack[];
}> {
  const adapter = adapterFor(deps, service);

  // youtube_music has no per-user account: every export runs through the one server-held cookie, so
  // its playlist belongs to the round rather than the player. Whoever opens the results first builds
  // it and every other player links to that same playlist -- keyed per-account, a four-player round
  // would instead build four identical unlisted playlists and hand out four different links.
  const sharedAcrossAccounts = service === 'youtube_music';
  const existing = await deps.pool.query<{ playlist_external_id: string | null; matched_submission_ids: string[] }>(
    `SELECT playlist_external_id, matched_submission_ids FROM round_exports
     WHERE round_id = $1 AND service = $2 AND ($3::boolean OR account_id = $4)
     ORDER BY created_at LIMIT 1`,
    [roundId, service, sharedAcrossAccounts, accountId],
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

    // ponytail: no locking against two concurrent exports of the same round reaching this point
    // together -- the UNIQUE constraint keeps one account's *record* to one row, but a genuine race
    // (or two players racing on a shared-account service) could still create two playlists upstream.
    // Add a per-round+service advisory lock if double-exports show up in practice.
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

  return {
    service,
    playlistExternalId,
    playlistUrl: playlistExternalId ? PLAYLIST_URL[service](playlistExternalId) : null,
    matchedCount: matchedIds.size,
    skipped,
  };
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
      'SELECT service, access_token FROM service_links WHERE account_id = $1 AND service = $2',
      [accountId, 'apple_music'],
    );
    const accessTokenByService = new Map<ExportableService, string>(
      linksResult.rows.map((row) => [row.service, row.access_token]),
    );
    // youtube_music has no per-user link: every export uses the one server-held account cookie.
    if (deps.youtubeMusicCookie) {
      accessTokenByService.set('youtube_music', deps.youtubeMusicCookie);
    }

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
