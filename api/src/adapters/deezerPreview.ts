import type { TrackRef } from './types.js';

interface DeezerTrack {
  title?: string;
  isrc?: string;
  preview?: string;
  artist?: { name?: string };
}

const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/**
 * Finds a 30s preview mp3 on Deezer (no auth) for a track by title and artist. A search by name can
 * land on a cover, live cut or remaster, so when both sides have an ISRC it must match; otherwise the
 * title and artist must both match exactly once normalized; anything looser returns null and the caller
 * falls back to the playback link. Never throws: a preview is a convenience.
 */
export async function findDeezerPreview(track: TrackRef): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(`${track.title} ${track.artist}`)}&limit=10`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const { data } = (await res.json()) as { data?: DeezerTrack[] };
    const match = (data ?? []).find(
      (d) =>
        d.preview &&
        (track.isrc && d.isrc
          ? track.isrc === d.isrc
          : normalize(track.title) !== '' && // all-non-Latin names normalize to '' and would match anything
            normalize(d.title ?? '') === normalize(track.title) &&
            normalize(d.artist?.name ?? '') === normalize(track.artist)),
    );
    return match?.preview ?? null;
  } catch {
    return null;
  }
}
