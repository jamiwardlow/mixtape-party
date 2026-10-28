import { Router } from 'express';
import type { Pool } from 'pg';
import { adapterFor, playbackAdapterFor, type AdapterRegistry } from '../adapters/registry.js';
import { resolveMatch } from '../adapters/matchCache.js';
import type { MusicServiceAdapter, PlaybackLaunchHandle, ServiceName, TrackResult } from '../adapters/types.js';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { isLeagueMember, loadRound, type RoundInfo } from './rounds.js';

/** What building a round's playlists needs; the sweep builds them too (#99), with no request behind it. */
export interface RoundExportDeps extends AdapterRegistry {
  pool: Pool;
  youtubeMusicCookie?: string;
}

export interface ExportDeps extends AccountsDeps, RoundExportDeps {}

export type ExportableService = Exclude<ServiceName, 'bandcamp'>;
const EXPORTABLE_SERVICES: ExportableService[] = ['youtube_music'];

/**
 * Web address of an exported playlist, the only form of it a client can open (#69). Per-track
 * launch handles come from the adapters; a playlist has no adapter method because the id read back
 * out of `round_exports` is all there is to build one from.
 */
export const PLAYLIST_URL: Record<ExportableService, (externalId: string) => string> = {
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

/**
 * What became of one service's leg of the export (#73). Without this, "the export blew up" and
 * "nothing matched" both reach the client as the same absent playlist url, and the screen has
 * nothing to say beyond silence.
 */
type ExportStatus = 'ok' | 'no_matches' | 'failed';

interface ServiceExport {
  service: ExportableService;
  status: ExportStatus;
  playlistExternalId: string | null;
  playlistUrl: string | null;
  matchedCount: number;
  skipped: SkippedTrack[];
}

/** A leg that produced no playlist, for any of the reasons that can end one: there is no link to give. */
function noPlaylistExport(service: ExportableService, status: ExportStatus): ServiceExport {
  return { service, status, playlistExternalId: null, playlistUrl: null, matchedCount: 0, skipped: [] };
}

/** Resolves each submission to a track on `service`, keyed by submission id; the unmatched are left out. */
async function matchSubmissions(
  deps: RoundExportDeps,
  adapter: MusicServiceAdapter,
  service: ExportableService,
  submissions: SubmissionRow[],
): Promise<Map<string, TrackResult>> {
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
  return matches;
}

/** The tracks that missed the playlist, each with the handle that plays it where it already lives. */
function skippedTracks(
  deps: RoundExportDeps,
  submissions: SubmissionRow[],
  matchedIds: Set<string>,
): Promise<SkippedTrack[]> {
  return Promise.all(
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
}

async function exportForService(
  deps: RoundExportDeps,
  roundId: string,
  accountId: string,
  service: ExportableService,
  accessToken: string,
  playlistName: string,
  submissions: SubmissionRow[],
): Promise<ServiceExport> {
  const adapter = adapterFor(deps, service);

  // The playlist belongs to the round rather than the player: whoever opens the results first builds
  // it under the one app-held account and every other player links to that same playlist. Keyed
  // per-account, a four-player round would instead build four identical unlisted playlists.
  const existing = await deps.pool.query<{ playlist_external_id: string | null; matched_submission_ids: string[] }>(
    `SELECT playlist_external_id, matched_submission_ids FROM round_exports
     WHERE round_id = $1 AND service = $2
     ORDER BY created_at LIMIT 1`,
    [roundId, service],
  );

  let playlistExternalId: string | null;
  let matchedIds: Set<string>;

  if (existing.rowCount) {
    playlistExternalId = existing.rows[0].playlist_external_id;
    matchedIds = new Set(existing.rows[0].matched_submission_ids);
  } else {
    const matches = await matchSubmissions(deps, adapter, service, submissions);

    playlistExternalId = null;
    if (matches.size > 0) {
      const playlist = await adapter.createPlaylist(accessToken, playlistName);
      await adapter.appendToPlaylist(accessToken, playlist, [...matches.values()]);
      playlistExternalId = playlist.externalId;
    }
    matchedIds = new Set(matches.keys());

    // ponytail: no locking against two concurrent exports of the same round reaching this point
    // together -- the UNIQUE constraint keeps one account's *record* to one row, but a genuine race
    // (or two players racing on the shared account) could still create two playlists upstream.
    // Add a per-round+service advisory lock if double-exports show up in practice.
    await deps.pool.query(
      `INSERT INTO round_exports (round_id, account_id, service, playlist_external_id, matched_submission_ids)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (round_id, account_id, service) DO NOTHING`,
      [roundId, accountId, service, playlistExternalId, [...matchedIds]],
    );
  }

  const skipped = await skippedTracks(deps, submissions, matchedIds);

  return {
    service,
    status: playlistExternalId ? 'ok' : 'no_matches',
    playlistExternalId,
    playlistUrl: playlistExternalId ? PLAYLIST_URL[service](playlistExternalId) : null,
    matchedCount: matchedIds.size,
    skipped,
  };
}

/**
 * Builds (once per round and service) the playlist of every non-Bandcamp submission, returning each
 * service's leg. `accountId` only owns the round_exports row; the playlist itself is the round's.
 */
export async function buildRoundExports(
  deps: RoundExportDeps,
  roundId: string,
  round: RoundInfo,
  accountId: string,
): Promise<ServiceExport[]> {
  const submissionsResult = await deps.pool.query<SubmissionRow>(
    `SELECT id, service, external_id, title, artist, isrc FROM submissions
     WHERE round_id = $1 AND service != 'bandcamp' ORDER BY id`,
    [roundId],
  );

  // Every export uses the one server-held YouTube Music account cookie.
  const accessTokenByService = new Map<ExportableService, string>();
  if (deps.youtubeMusicCookie) {
    accessTokenByService.set('youtube_music', deps.youtubeMusicCookie);
  }

  // A round scheduled up front has no theme until the host names one, and "Round 3: null" is
  // not a playlist anyone wants in their library.
  const playlistName = `Mixtape Party — Round ${round.roundNumber}${round.theme ? `: ${round.theme}` : ''}`;
  // Settled one service at a time so a single broken link cannot take the others down with it
  // (#73). A bare Promise.all rejected the whole request, throwing away a playlist another
  // service had already built and written to round_exports -- the client then saw only a 500.
  const services = await Promise.all(
    EXPORTABLE_SERVICES.flatMap((service): Array<ServiceExport | Promise<ServiceExport>> => {
      const accessToken = accessTokenByService.get(service);
      // A missing cookie is app config nobody signed in can act on, so the service stays out of
      // the response entirely.
      if (!accessToken) return [];
      return [
        exportForService(
          deps,
          roundId,
          accountId,
          service,
          accessToken,
          playlistName,
          submissionsResult.rows,
        ).catch((err: unknown) => {
          // Logged rather than returned: the message names internals, and the client's copy keys
          // off the status. Nothing is persisted, so the next sweep or export request retries from scratch.
          //
          // ponytail: that retry is unbounded and not free. A service that keeps refusing
          // re-hits it on every results view, and a leg that fails *between* createPlaylist and
          // appendToPlaylist leaves an empty playlist behind in the app account each time,
          // since no round_exports row records the one already made. Record an attempted_at on
          // round_exports (and reuse the orphaned playlist id) if either starts to bite.
          console.error(err);
          return noPlaylistExport(service, 'failed');
        }),
      ];
    }),
  );
  return services;
}

/**
 * Appends the caller's favorites not yet exported to their one personal playlist, creating it on
 * the first call. Favorites drift over time, unlike a round, so this is a delta, not a one-shot.
 */
async function exportFavorites(
  deps: RoundExportDeps,
  accountId: string,
  service: ExportableService,
  accessToken: string,
): Promise<ServiceExport> {
  const adapter = adapterFor(deps, service);
  // Same league-membership join as GET /favorites, so a favorite from a league the caller left stays out.
  const favorites = (
    await deps.pool.query<SubmissionRow>(
      `SELECT s.id, s.service, s.external_id, s.title, s.artist, s.isrc
       FROM favorites f
       JOIN submissions s ON s.id = f.submission_id
       JOIN rounds r ON r.id = s.round_id
       JOIN league_members lm ON lm.league_id = r.league_id AND lm.account_id = f.account_id
       WHERE f.account_id = $1 AND s.service != 'bandcamp'
       ORDER BY f.created_at`,
      [accountId],
    )
  ).rows;

  const existing = (
    await deps.pool.query<{ playlist_external_id: string; exported_submission_ids: string[] }>(
      'SELECT playlist_external_id, exported_submission_ids FROM favorite_exports WHERE account_id = $1 AND service = $2',
      [accountId, service],
    )
  ).rows[0];
  const exportedIds = new Set(existing?.exported_submission_ids ?? []);
  let playlistExternalId = existing?.playlist_external_id ?? null;

  const matches = await matchSubmissions(
    deps,
    adapter,
    service,
    favorites.filter((f) => !exportedIds.has(f.id)),
  );
  if (matches.size > 0) {
    // ponytail: unfavoriting never removes a track from an exported playlist, since the adapter has
    // no remove method. Add `removeFromPlaylist` to the adapter and diff against favorites to fix.
    const playlist = playlistExternalId
      ? { externalId: playlistExternalId, service }
      : await adapter.createPlaylist(accessToken, 'Mixtape Party — Favorites');
    await adapter.appendToPlaylist(accessToken, playlist, [...matches.values()]);
    playlistExternalId = playlist.externalId;
    await deps.pool.query(
      `INSERT INTO favorite_exports (account_id, service, playlist_external_id, exported_submission_ids)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, service) DO UPDATE
       SET playlist_external_id = EXCLUDED.playlist_external_id,
           exported_submission_ids = EXCLUDED.exported_submission_ids`,
      [accountId, service, playlistExternalId, [...exportedIds, ...matches.keys()]],
    );
  }

  const onPlaylist = new Set([...exportedIds, ...matches.keys()]);
  return {
    service,
    status: playlistExternalId ? 'ok' : 'no_matches',
    playlistExternalId,
    playlistUrl: playlistExternalId ? PLAYLIST_URL[service](playlistExternalId) : null,
    matchedCount: favorites.filter((f) => onPlaylist.has(f.id)).length,
    skipped: await skippedTracks(deps, favorites, onPlaylist),
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
    if (new Date(round.submissionDeadline) > new Date()) {
      res.status(403).json({ error: 'export is not available until the submission deadline passes' });
      return;
    }

    const services = await buildRoundExports(deps, req.params.roundId, round, accountId);
    res.json({ services });
  });

  router.post('/favorites/export', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    // Absent cookie = service absent from the response, as for a round. A failing service must not 500 (#73).
    const services = deps.youtubeMusicCookie
      ? [
          await exportFavorites(deps, accountId, 'youtube_music', deps.youtubeMusicCookie).catch((err: unknown) => {
            console.error(err);
            return noPlaylistExport('youtube_music', 'failed');
          }),
        ]
      : [];
    res.json({ services });
  });

  return router;
}
