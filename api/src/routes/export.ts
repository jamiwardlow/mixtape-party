import { Router } from 'express';
import type { Pool } from 'pg';
import { adapterFor, playbackAdapterFor, type AdapterRegistry } from '../adapters/registry.js';
import { resolveMatch } from '../adapters/matchCache.js';
import type { MusicServiceAdapter, PlaybackLaunchHandle, ServiceName, TrackResult } from '../adapters/types.js';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { isLeagueMember, loadRound } from './rounds.js';
import { guessingOpened } from '../roundTimeline.js';

/** What building a round's playlists needs; the sweep builds them too (#99), with no request behind it. */
export interface RoundExportDeps extends AdapterRegistry {
  pool: Pool;
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
  // A comma-joined video id list (#215): YouTube builds an anonymous playlist from it on click, so
  // no account or cookie is involved. Rows exported before #215 hold a real playlist id under the
  // old shared account instead, and keep linking to it.
  // ponytail: YouTube may only queue the first ~50 ids; split into several links if a list outgrows it.
  youtube_music: (externalId) =>
    /^PL[\w-]{16,}$/.test(externalId)
      ? `https://music.youtube.com/playlist?list=${externalId}`
      : `https://www.youtube.com/watch_videos?video_ids=${externalId}`,
};

/** What `round_exports` / `favorite_exports` store for a set of matched tracks: their ids, in order, or null for none. */
function playlistIdFor(tracks: Iterable<TrackResult>): string | null {
  return [...tracks].map((t) => t.externalId).join(',') || null;
}

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
    // A submission already on this exact service is a confirmed match; no need to re-search. One
    // whose id the service wouldn't recognize is left unmatched instead.
    const match =
      submission.service === service
        ? adapter.isTrackId(submission.external_id) && {
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
  submissions: SubmissionRow[],
): Promise<ServiceExport> {
  const adapter = adapterFor(deps, service);

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
    const matches = await matchSubmissions(deps, adapter, service, submissions);
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
  accountId: string,
): Promise<ServiceExport[]> {
  const submissionsResult = await deps.pool.query<SubmissionRow>(
    `SELECT id, service, external_id, title, artist, isrc FROM submissions
     WHERE round_id = $1 AND service != 'bandcamp' ORDER BY id`,
    [roundId],
  );

  // Settled one service at a time so a single broken link cannot take the others down with it
  // (#73). A bare Promise.all rejected the whole request, throwing away a playlist another
  // service had already built and written to round_exports -- the client then saw only a 500.
  return Promise.all(
    EXPORTABLE_SERVICES.map((service) =>
      exportForService(deps, roundId, accountId, service, submissionsResult.rows).catch((err: unknown) => {
        // Logged rather than returned: the message names internals, and the client's copy keys
        // off the status. Nothing is persisted, so the next sweep or export request retries from scratch.
        //
        // ponytail: that retry is unbounded and not free -- a service that keeps refusing is
        // re-hit every sweep and results view. Record an attempted_at on round_exports to back off.
        console.error(err);
        return noPlaylistExport(service, 'failed');
      }),
    ),
  );
}

/**
 * Rebuilds the caller's favorites playlist from every current favorite. A link is free to rebuild
 * (#215), so unlike the old shared-account playlist this also drops unfavorited tracks.
 */
async function exportFavorites(deps: RoundExportDeps, accountId: string, service: ExportableService): Promise<ServiceExport> {
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

  const matches = await matchSubmissions(deps, adapter, service, favorites);
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
    playlistUrl: playlistExternalId ? PLAYLIST_URL[service](playlistExternalId) : null,
    matchedCount: matches.size,
    skipped: await skippedTracks(deps, favorites, matchedIds),
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
    if (!guessingOpened(round, new Date())) {
      res.status(403).json({ error: 'export is not available until the submission deadline passes' });
      return;
    }

    const services = await buildRoundExports(deps, req.params.roundId, accountId);
    res.json({ services });
  });

  router.post('/favorites/export', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    // A failing service must not 500 (#73).
    const services = [
      await exportFavorites(deps, accountId, 'youtube_music').catch((err: unknown) => {
        console.error(err);
        return noPlaylistExport('youtube_music', 'failed');
      }),
    ];
    res.json({ services });
  });

  return router;
}
