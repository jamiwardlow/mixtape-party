import { findDeezerPreview } from './deezerPreview.js';
import {
  ServiceUnavailableError,
  type MusicServiceAdapter,
  type PlaybackLaunchHandle,
  type TrackRef,
  type TrackResult,
} from './types.js';

const ORIGIN = 'https://music.youtube.com';
const API_BASE = `${ORIGIN}/youtubei/v1`;
// Public innertube key used by the YouTube Music web client (not a secret; embedded in every page load).
const INNERTUBE_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const CLIENT_CONTEXT = { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00' } };
const REQUEST_TIMEOUT_MS = 5000;

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
 * Every innertube call routes through here: it normalizes any failure (network error, bad status,
 * unparseable body) into a {@link ServiceUnavailableError}.
 */
async function innertubePost(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

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
    const detail = await res.text().catch(() => '');
    throw new ServiceUnavailableError(
      'youtube_music',
      `youtube music ${endpoint} failed: ${res.status} ${detail.slice(0, 600)}`,
    );
  }
  try {
    return await res.json();
  } catch (err) {
    throw new ServiceUnavailableError('youtube_music', 'youtube music returned an unreadable response', {
      cause: err,
    });
  }
}

/**
 * Real YouTube Music integration via its unofficial "innertube" web-client API — there is no
 * official Google API for YouTube Music search. Unauthenticated and undocumented, so
 * every request routes through {@link innertubePost}, and a response that doesn't match the shape
 * this adapter expects is raised as a {@link ServiceUnavailableError} rather than left to produce
 * garbage results or a hung request.
 */
export class YouTubeMusicAdapter implements MusicServiceAdapter {
  readonly service = 'youtube_music' as const;

  async search(query: string): Promise<TrackResult[]> {
    const body = (await innertubePost('search', {
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

  /** A video id is 11 url-safe base64 characters; anything else (e.g. the fake demo-league picks) makes browse/edit_playlist 400 the whole batch. */
  isTrackId(externalId: string): boolean {
    return /^[\w-]{11}$/.test(externalId);
  }

  async getPlaybackLaunchHandle(track: TrackResult): Promise<PlaybackLaunchHandle> {
    return { service: this.service, deepLink: `${ORIGIN}/watch?v=${track.externalId}` };
  }

  getPreviewUrl(track: TrackResult): Promise<string | null> {
    return findDeezerPreview(track);
  }
}
