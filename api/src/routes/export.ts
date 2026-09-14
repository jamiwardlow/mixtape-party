import { Router } from 'express';
import { adapterFor, playbackAdapterFor, type AdapterRegistry } from '../adapters/registry.js';
import { resolveMatch } from '../adapters/matchCache.js';
import { ServiceAccountError, type PlaybackLaunchHandle, type ServiceName, type TrackResult } from '../adapters/types.js';
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

/**
 * What became of one service's leg of the export (#73). Without this, "the export blew up",
 * "nothing matched" and "you never linked" all reach the client as the same absent playlist url,
 * and the screen has nothing to say beyond silence.
 *
 * `denied` is deliberately not called "no subscription": it is what Apple answers to a library
 * write it refuses, and it will not say why (a lapsed subscription and a revoked Music User Token
 * look identical), so the name records the refusal rather than guessing at the cause.
 */
type ExportStatus = 'ok' | 'no_matches' | 'not_linked' | 'denied' | 'failed';

interface ServiceExport {
  service: ExportableService;
  status: ExportStatus;
  playlistExternalId: string | null;
  playlistUrl: string | null;
  matchedCount: number;
  skipped: SkippedTrack[];
}

/**
 * Whether the service exports through one app-held account rather than a per-user link. Everything
 * that differs between the two -- who the playlist belongs to, whether a missing token is the
 * user's problem -- keys off this one fact, so it is named once rather than re-derived per site.
 */
function isAppOwned(service: ExportableService): boolean {
  return service === 'youtube_music';
}

/** A leg that produced no playlist, for any of the reasons that can end one: there is no link to give. */
function noPlaylistExport(service: ExportableService, status: ExportStatus): ServiceExport {
  return { service, status, playlistExternalId: null, playlistUrl: null, matchedCount: 0, skipped: [] };
}

async function exportForService(
  deps: ExportDeps,
  roundId: string,
  accountId: string,
  service: ExportableService,
  accessToken: string,
  playlistName: string,
  submissions: SubmissionRow[],
): Promise<ServiceExport> {
  const adapter = adapterFor(deps, service);

  // An app-owned service's playlist belongs to the round rather than the player: whoever opens the
  // results first builds it and every other player links to that same playlist. Keyed per-account, a
  // four-player round would instead build four identical unlisted playlists and hand out four links.
  const sharedAcrossAccounts = isAppOwned(service);
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
    status: playlistExternalId ? 'ok' : 'no_matches',
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
    // Settled one service at a time so a single broken link cannot take the others down with it
    // (#73). A bare Promise.all rejected the whole request, throwing away a playlist another
    // service had already built and written to round_exports -- the client then saw only a 500.
    const services = await Promise.all(
      EXPORTABLE_SERVICES.flatMap((service): Array<ServiceExport | Promise<ServiceExport>> => {
        const accessToken = accessTokenByService.get(service);
        if (!accessToken) {
          // An app-owned service's token is the one server-held cookie, not a user link: a missing
          // one is app config nobody signed in can act on, so it stays out of the response entirely
          // rather than being reported to this user as something they failed to link.
          return isAppOwned(service) ? [] : [noPlaylistExport(service, 'not_linked')];
        }
        return [
          exportForService(
            deps,
            req.params.roundId,
            accountId,
            service,
            accessToken,
            playlistName,
            submissionsResult.rows,
          ).catch((err: unknown) => {
            // Logged rather than returned: the message names internals, and the client's copy keys
            // off the status. Nothing is persisted, so the next results view retries from scratch --
            // which is what a user who fixes their subscription wants.
            //
            // ponytail: that retry is unbounded and not free. An account the service keeps refusing
            // re-hits it on every results view, and a leg that fails *between* createPlaylist and
            // appendToPlaylist leaves an empty playlist behind in the user's library each time,
            // since no round_exports row records the one already made. Record an attempted_at on
            // round_exports (and reuse the orphaned playlist id) if either starts to bite.
            console.error(err);
            return noPlaylistExport(service, err instanceof ServiceAccountError ? 'denied' : 'failed');
          }),
        ];
      }),
    );

    res.json({ services });
  });

  return router;
}
