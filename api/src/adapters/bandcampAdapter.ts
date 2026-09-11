import {
  ServiceUnavailableError,
  type EmbedOnlyMusicServiceAdapter,
  type PlaybackLaunchHandle,
  type TrackResult,
} from './types.js';

/**
 * Bandcamp's public oEmbed endpoint (`/api/oembed`) now answers HTTP 200 with
 * `{"error":true,"error_message":"bad version"}` for every URL, and there is no replacement: every
 * `/api/oembed/<n>/<fn>` spelling answers `"bad function"` and track pages carry no
 * `application/json+oembed` discovery link (#59). So we read the track/album page itself.
 *
 * Every Bandcamp track/album page embeds a `data-tralbum` attribute holding an HTML-entity-encoded
 * JSON blob with the id, item type, artist and title. It is the only source present on every page
 * shape we tried — `og:video` and `twitter:player` carry the player id but are both absent on
 * tracks with no streamable audio.
 */
const TRALBUM_PATTERN = /data-tralbum="([^"]*)"/;
const ENTITIES: Record<string, string> = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>' };

/**
 * Decodes the HTML entities Bandcamp escapes the attribute with. Single-pass, so an encoded
 * `&amp;quot;` can't decode twice into a quote that breaks the JSON. Titles carrying an apostrophe
 * or an accent are common, and Bandcamp escapes those as numeric refs in either base.
 */
function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:([a-zA-Z]+)|#(\d+)|#[xX]([0-9a-fA-F]+));/g,
    (match, name: string | undefined, decimal: string | undefined, hex: string | undefined) => {
      if (name) return ENTITIES[name.toLowerCase()] ?? match;
      return String.fromCodePoint(parseInt(decimal ?? hex ?? '', decimal ? 10 : 16));
    },
  );
}

interface TralbumData {
  id?: number;
  item_type?: string;
  artist?: string;
  current?: { title?: string };
}

/**
 * Resolves a pasted Bandcamp track/album URL by reading the page — Bandcamp has no
 * search/discovery API, so submission is link-paste only (no `search`/`match`/playlist ops).
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
      res = await fetch(parsed.toString(), { signal: AbortSignal.timeout(5000) });
    } catch (err) {
      throw new ServiceUnavailableError('bandcamp', 'bandcamp is unreachable', { cause: err });
    }
    // Reading a public page (rather than an API) invites bot-blocking and rate-limiting, so
    // separate "this paste isn't a track" from "Bandcamp is refusing us": only a 404/410 means the
    // URL is genuinely not a track page. Anything else is an outage the caller must surface as
    // 503, not as a 400 telling the player their perfectly good link is invalid.
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new ServiceUnavailableError('bandcamp', `bandcamp returned HTTP ${res.status}`);
    }
    if (!res.ok) return null;

    const encoded = (await res.text()).match(TRALBUM_PATTERN)?.[1];
    const data = encoded ? safeParse(decodeHtmlEntities(encoded)) : null;

    const title = data?.current?.title;
    const { id, item_type: itemType, artist } = data ?? {};
    if (typeof id !== 'number' || !artist || !title || (itemType !== 'track' && itemType !== 'album')) {
      // A 200 whose markup we can't parse is the shape #59 arrived in: no error, no log line, just
      // a link rejected as invalid. The daily contract job catches it within a day; this makes an
      // intra-day break diagnosable instead of silent.
      console.error('bandcamp page parse failed', parsed.toString());
      return null;
    }

    return {
      externalId: `${itemType}=${id}`,
      title,
      artist,
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

function safeParse(json: string): TralbumData | null {
  try {
    return JSON.parse(json) as TralbumData;
  } catch {
    return null;
  }
}
