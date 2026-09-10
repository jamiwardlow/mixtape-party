import { createHash } from 'node:crypto';
import {
  ServiceUnavailableError,
  type MusicServiceAdapter,
  type PlaybackLaunchHandle,
  type PlaylistRef,
  type TrackRef,
  type TrackResult,
} from './types.js';

const ORIGIN = 'https://music.youtube.com';
const API_BASE = `${ORIGIN}/youtubei/v1`;
// Public innertube key used by the YouTube Music web client (not a secret; embedded in every page load).
const INNERTUBE_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const CLIENT_CONTEXT = { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00' } };
const REQUEST_TIMEOUT_MS = 5000;

function sapisidHashAuth(cookie: string): string {
  const match = cookie.match(/(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)/);
  if (!match) throw new ServiceUnavailableError('youtube_music', 'cookie is missing a SAPISID value');
  const timestamp = Math.floor(Date.now() / 1000);
  const hash = createHash('sha1').update(`${timestamp} ${match[1]} ${ORIGIN}`).digest('hex');
  return `SAPISIDHASH ${timestamp}_${hash}`;
}

interface SongRun {
  text: string;
}
interface MusicResponsiveListItemRenderer {
  // Not a top-level `videoId`: YouTube Music moved it under playlistItemData. A renderer without
  // one is a non-track row (an album or artist shelf entry), which search drops.
  playlistItemData?: { videoId: string };
  flexColumns: Array<{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: SongRun[] } } }>;
}
interface SearchResponseShape {
  contents?: {
    tabbedSearchResultsRenderer?: {
      tabs: Array<{
        tabRenderer: {
          content: {
            sectionListRenderer: {
              contents: Array<{
                musicShelfRenderer?: {
                  contents: Array<{ musicResponsiveListItemRenderer: MusicResponsiveListItemRenderer }>;
                };
              }>;
            };
          };
        };
      }>;
    };
  };
}

/**
 * Real YouTube Music integration via its unofficial "innertube" web-client API — there is no
 * official Google API for YouTube Music search/playlists. Unauthenticated and undocumented, so
 * every request routes through {@link post}, which normalizes any failure (network error, bad
 * status, or a response that doesn't match the shape this adapter expects) into a
 * {@link ServiceUnavailableError} rather than letting a silent upstream change produce garbage
 * results or a hung request.
 */
export class YouTubeMusicAdapter implements MusicServiceAdapter {
  readonly service = 'youtube_music' as const;

  private async post(endpoint: string, body: Record<string, unknown>, cookie?: string): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cookie) {
      headers.Cookie = cookie;
      headers.Authorization = sapisidHashAuth(cookie);
      headers['X-Origin'] = ORIGIN;
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/${endpoint}?key=${INNERTUBE_KEY}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ context: CLIENT_CONTEXT, ...body }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ServiceUnavailableError('youtube_music', 'youtube music is unreachable', { cause: err });
    }
    if (!res.ok) {
      throw new ServiceUnavailableError('youtube_music', `youtube music request failed: ${res.status}`);
    }
    try {
      return await res.json();
    } catch (err) {
      throw new ServiceUnavailableError('youtube_music', 'youtube music returned an unreadable response', {
        cause: err,
      });
    }
  }

  async search(query: string): Promise<TrackResult[]> {
    const body = (await this.post('search', {
      query,
      params: 'EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D', // filter: songs only
    })) as SearchResponseShape;

    const sections = body.contents?.tabbedSearchResultsRenderer?.tabs[0]?.tabRenderer.content.sectionListRenderer
      .contents;
    if (!sections) {
      throw new ServiceUnavailableError('youtube_music', 'youtube music search response was not shaped as expected');
    }

    const items = sections.flatMap((section) => section.musicShelfRenderer?.contents ?? []);
    return items
      .map((item) => item.musicResponsiveListItemRenderer)
      .filter((renderer): renderer is MusicResponsiveListItemRenderer & { playlistItemData: { videoId: string } } =>
        Boolean(renderer.playlistItemData?.videoId),
      )
      .map((renderer) => ({
        externalId: renderer.playlistItemData.videoId,
        title: renderer.flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer.text.runs[0]?.text ?? '',
        artist: renderer.flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer.text.runs[0]?.text ?? '',
        service: this.service,
      }));
  }

  async match(track: TrackRef): Promise<TrackResult | null> {
    const results = await this.search(track.isrc ?? `${track.title} ${track.artist}`);
    return results[0] ?? null;
  }

  async createPlaylist(accessToken: string, name: string): Promise<PlaylistRef> {
    // UNLISTED, not PRIVATE: this playlist is built under one shared, server-held account (see
    // createPlaylist's accessToken) and shared to arbitrary listeners via its watch link.
    const body = (await this.post('playlist/create', { title: name, privacyStatus: 'UNLISTED' }, accessToken)) as {
      playlistId: string;
    };
    return { externalId: body.playlistId, service: this.service };
  }

  async appendToPlaylist(accessToken: string, playlist: PlaylistRef, tracks: TrackResult[]): Promise<void> {
    await this.post(
      'browse/edit_playlist',
      {
        playlistId: playlist.externalId,
        actions: tracks.map((t) => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: t.externalId })),
      },
      accessToken,
    );
  }

  async getPlaybackLaunchHandle(track: TrackResult): Promise<PlaybackLaunchHandle> {
    return { service: this.service, deepLink: `${ORIGIN}/watch?v=${track.externalId}` };
  }
}
