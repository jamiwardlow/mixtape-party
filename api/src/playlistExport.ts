/** Building playlists (#99, #215): a round's, for the results screen and the sweep, and an account's favorites. */
import type { Pool } from 'pg';
import { exportableServiceNames, playbackFor, playlistServices, type AdapterRegistry } from './adapters/registry.js';
import { resolveMatch } from './adapters/matchCache.js';
import type { PlaybackLaunchHandle, PlaylistService, ServiceName, TrackResult } from './adapters/types.js';

/** What building a round's playlists needs; the sweep builds them too (#99), with no request behind it. */
export interface PlaylistExportDeps extends AdapterRegistry {
  pool: Pool;
}

/** What `round_exports` / `favorite_exports` store for a set of matched tracks: their ids, in order, or null for none. */
function playlistIdFor(tracks: Iterable<TrackResult>): string | null {
  return [...tracks].map((t) => t.externalId).join(',') || null;
}

interface SubmissionRow {
  id: string;
  service: ServiceName;
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
  service: ServiceName;
  status: ExportStatus;
  playlistExternalId: string | null;
  playlistUrl: string | null;
  matchedCount: number;
  skipped: SkippedTrack[];
}

/** A leg that produced no playlist, for any of the reasons that can end one: there is no link to give. */
function noPlaylistExport(service: ServiceName, status: ExportStatus): ServiceExport {
  return { service, status, playlistExternalId: null, playlistUrl: null, matchedCount: 0, skipped: [] };
}

/** Resolves each submission to a track on `service`, keyed by submission id; the unmatched are left out. */
async function matchSubmissions(
  deps: PlaylistExportDeps,
  adapter: PlaylistService,
  submissions: SubmissionRow[],
): Promise<Map<string, TrackResult>> {
  const matches = new Map<string, TrackResult>();
  for (const submission of submissions) {
    // A submission already on this exact service is a confirmed match; no need to re-search. One
    // whose id the service wouldn't recognize is left unmatched instead.
    const match =
      submission.service === adapter.service
        ? adapter.isTrackId(submission.external_id) && {
            externalId: submission.external_id,
            title: submission.title,
            artist: submission.artist,
            isrc: submission.isrc ?? undefined,
            service: adapter.service,
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
  deps: PlaylistExportDeps,
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
        playback: await playbackFor(deps, s),
      })),
  );
}

async function exportForService(
  deps: PlaylistExportDeps,
  roundId: string,
  accountId: string,
  adapter: PlaylistService,
  submissions: SubmissionRow[],
): Promise<ServiceExport> {
  const { service } = adapter;

  // The playlist belongs to the round rather than the player: whoever opens the results first
  // matches it and every other player reuses that same match, instead of re-searching per account.
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
    const matches = await matchSubmissions(deps, adapter, submissions);
    playlistExternalId = playlistIdFor(matches.values());
    matchedIds = new Set(matches.keys());

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
    playlistUrl: playlistExternalId ? adapter.playlistUrl(playlistExternalId) : null,
    matchedCount: matchedIds.size,
    skipped,
  };
}

/**
 * Runs one export leg per playlist service. Settled one service at a time so a single broken link
 * cannot take the others down with it (#73): a bare Promise.all rejected the whole request,
 * throwing away a playlist another service had already built -- the client then saw only a 500.
 */
function perService(deps: PlaylistExportDeps, leg: (adapter: PlaylistService) => Promise<ServiceExport>): Promise<ServiceExport[]> {
  return Promise.all(
    playlistServices(deps).map((adapter) =>
      leg(adapter).catch((err: unknown) => {
        // Logged rather than returned: the message names internals, and the client's copy keys
        // off the status. Nothing is persisted, so the next sweep or export request retries from scratch.
        //
        // ponytail: that retry is unbounded and not free -- a service that keeps refusing is
        // re-hit every sweep and results view. Record an attempted_at on round_exports to back off.
        console.error(err);
        return noPlaylistExport(adapter.service, 'failed');
      }),
    ),
  );
}

/**
 * Builds (once per round and service) the playlist of every exportable submission, returning each
 * service's leg. `accountId` only owns the round_exports row; the playlist itself is the round's.
 */
export async function buildRoundExports(
  deps: PlaylistExportDeps,
  roundId: string,
  accountId: string,
): Promise<ServiceExport[]> {
  const submissionsResult = await deps.pool.query<SubmissionRow>(
    `SELECT id, service, external_id, title, artist, isrc FROM submissions
     WHERE round_id = $1 AND service = ANY($2) ORDER BY id`,
    [roundId, exportableServiceNames(deps)],
  );

  return perService(deps, (adapter) => exportForService(deps, roundId, accountId, adapter, submissionsResult.rows));
}

async function exportFavorites(deps: PlaylistExportDeps, accountId: string, adapter: PlaylistService): Promise<ServiceExport> {
  const { service } = adapter;
  // Same league-membership join as GET /favorites, so a favorite from a league the caller left stays out.
  const favorites = (
    await deps.pool.query<SubmissionRow>(
      `SELECT s.id, s.service, s.external_id, s.title, s.artist, s.isrc
       FROM favorites f
       JOIN submissions s ON s.id = f.submission_id
       JOIN rounds r ON r.id = s.round_id
       JOIN league_members lm ON lm.league_id = r.league_id AND lm.account_id = f.account_id
       WHERE f.account_id = $1 AND s.service = ANY($2)
       ORDER BY f.created_at`,
      [accountId, exportableServiceNames(deps)],
    )
  ).rows;

  const matches = await matchSubmissions(deps, adapter, favorites);
  const playlistExternalId = playlistIdFor(matches.values());
  if (playlistExternalId) {
    await deps.pool.query(
      `INSERT INTO favorite_exports (account_id, service, playlist_external_id, exported_submission_ids)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, service) DO UPDATE
       SET playlist_external_id = EXCLUDED.playlist_external_id,
           exported_submission_ids = EXCLUDED.exported_submission_ids`,
      [accountId, service, playlistExternalId, [...matches.keys()]],
    );
  } else {
    await deps.pool.query('DELETE FROM favorite_exports WHERE account_id = $1 AND service = $2', [accountId, service]);
  }

  const matchedIds = new Set(matches.keys());
  return {
    service,
    status: playlistExternalId ? 'ok' : 'no_matches',
    playlistExternalId,
    playlistUrl: playlistExternalId ? adapter.playlistUrl(playlistExternalId) : null,
    matchedCount: matches.size,
    skipped: await skippedTracks(deps, favorites, matchedIds),
  };
}

/**
 * Rebuilds an account's favorites playlist on every service from every current favorite. A link is
 * free to rebuild (#215), so unlike the old shared-account playlist this also drops unfavorited tracks.
 */
export function buildFavoriteExports(deps: PlaylistExportDeps, accountId: string): Promise<ServiceExport[]> {
  return perService(deps, (adapter) => exportFavorites(deps, accountId, adapter));
}
