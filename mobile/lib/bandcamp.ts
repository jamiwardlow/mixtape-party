// Mirrors the data-tralbum parse in api/src/adapters/bandcampAdapter.ts. Bandcamp bot-walls our
// server, so on a device (residential IP) we read the page ourselves and send the result.
import { Linking } from 'react-native';

const ENTITIES: Record<string, string> = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>' };

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:([a-zA-Z]+)|#(\d+)|#[xX]([0-9a-fA-F]+));/g, (match, name, decimal, hex) =>
    name ? (ENTITIES[name.toLowerCase()] ?? match) : String.fromCodePoint(parseInt(decimal ?? hex, decimal ? 10 : 16)),
  );
}

export interface ResolvedBandcamp {
  externalId: string;
  title: string;
  artist: string;
  artId?: number;
  pageUrl: string;
}

export async function resolveBandcampUrl(url: string): Promise<ResolvedBandcamp | null> {
  try {
    const host = new URL(url).hostname;
    if (!/(^|\.)bandcamp\.com$/.test(host)) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const encoded = (await res.text()).match(/data-tralbum="([^"]*)"/)?.[1];
    if (!encoded) return null;
    const data = JSON.parse(decodeHtmlEntities(encoded));
    const title = data?.current?.title;
    if (typeof data?.id !== 'number' || !data.artist || !title || (data.item_type !== 'track' && data.item_type !== 'album')) {
      return null;
    }
    return {
      externalId: `${data.item_type}=${data.id}`,
      title,
      artist: data.artist,
      artId: typeof data.art_id === 'number' ? data.art_id : undefined,
      pageUrl: url,
    };
  } catch {
    return null;
  }
}

async function fetchPlayerData(embedId: string): Promise<any | null> {
  try {
    if (!/^(track|album)=\d{1,20}$/.test(embedId)) return null;
    const res = await fetch(`https://bandcamp.com/EmbeddedPlayer/${embedId}`);
    if (!res.ok) return null;
    const encoded = (await res.text()).match(/data-player-data="([^"]*)"/)?.[1];
    return encoded ? JSON.parse(decodeHtmlEntities(encoded)) : null;
  } catch {
    return null;
  }
}

/** Device-side twin of BandcampAdapter.getPreviewUrl: the signed mp3-128 of the first track. */
export async function fetchBandcampPreview(embedId: string): Promise<string | null> {
  return (await fetchPlayerData(embedId))?.tracks?.[0]?.file?.['mp3-128'] ?? null;
}

/** Opens a playback link. For Bandcamp the API now returns the track's real page (#197). */
export const openPlaybackLink = (href: string) => Linking.openURL(href);
