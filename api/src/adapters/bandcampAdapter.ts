import {
  ServiceUnavailableError,
  type EmbedOnlyMusicServiceAdapter,
  type PlaybackLaunchHandle,
  type TrackResult,
} from './types.js';

const OEMBED_ENDPOINT = 'https://bandcamp.com/api/oembed';
// The oEmbed response's `html` field embeds a player iframe whose src encodes the track/album id,
// e.g. `.../EmbeddedPlayer/album=123/track=456/...` or `.../EmbeddedPlayer/track=456/...`.
const EMBED_SRC_PATTERN = /(track|album)=(\d+)/;

/**
 * Resolves a pasted Bandcamp track/album URL via Bandcamp's public oEmbed endpoint — Bandcamp has
 * no search/discovery API, so submission is link-paste only (no `search`/`match`/playlist ops).
 */
export class BandcampAdapter implements EmbedOnlyMusicServiceAdapter {
  readonly service = 'bandcamp' as const;

  async submit(url: string): Promise<TrackResult | null> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!/(^|\.)bandcamp\.com$/.test(parsed.hostname)) return null;

    let res: Response;
    try {
      res = await fetch(`${OEMBED_ENDPOINT}?url=${encodeURIComponent(url)}&format=json`, {
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      throw new ServiceUnavailableError('bandcamp', 'bandcamp is unreachable', { cause: err });
    }
    if (!res.ok) return null;

    const body = (await res.json()) as { title?: string; author_name?: string; html?: string };
    const embedMatch = body.html?.match(EMBED_SRC_PATTERN);
    if (!body.title || !body.author_name || !embedMatch) return null;

    return {
      externalId: `${embedMatch[1]}=${embedMatch[2]}`,
      title: body.title,
      artist: body.author_name,
      service: this.service,
    };
  }

  async getPlaybackLaunchHandle(track: TrackResult): Promise<PlaybackLaunchHandle> {
    const [, kind, id] = track.externalId.match(/^(track|album)=(\d+)$/) ?? [];
    if (!kind || !id) throw new Error(`invalid bandcamp externalId: ${track.externalId}`);
    const webUrl = `https://player.bandcamp.com/EmbeddedPlayer/${kind}=${id}/size=large/bgcol=333333/linkcol=0f91ff/tracklist=false/artwork=small/transparent=true/`;
    return { service: this.service, deepLink: webUrl, webUrl };
  }
}
