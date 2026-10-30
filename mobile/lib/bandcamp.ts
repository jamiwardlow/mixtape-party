// Mirrors the data-tralbum parse in api/src/adapters/bandcampAdapter.ts. Bandcamp bot-walls our
// server, so on a device (residential IP) we read the page ourselves and send the result.
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
    };
  } catch {
    return null;
  }
}
