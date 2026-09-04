import type { Pool } from 'pg';
import { ServiceUnavailableError, type MusicServiceAdapter, type TrackRef, type TrackResult } from './types.js';

function matchKeyFor(track: TrackRef): string {
  return track.isrc ? `isrc:${track.isrc}` : `ta:${track.title.trim().toLowerCase()}|${track.artist.trim().toLowerCase()}`;
}

/**
 * Resolves a track against a service's catalog through the global, permanent match cache
 * (`track_matches`): a cache hit (including a confirmed no-match) is reused instead of re-searching.
 * A transient {@link ServiceUnavailableError} is treated as "no match for this attempt" but is
 * never written to the cache, so a later export can retry it.
 */
export async function resolveMatch(pool: Pool, adapter: MusicServiceAdapter, track: TrackRef): Promise<TrackResult | null> {
  const matchKey = matchKeyFor(track);
  const cached = await pool.query<{ external_id: string | null; title: string; artist: string; isrc: string | null }>(
    'SELECT external_id, title, artist, isrc FROM track_matches WHERE match_key = $1 AND service = $2',
    [matchKey, adapter.service],
  );
  if (cached.rowCount) {
    const row = cached.rows[0];
    return row.external_id
      ? { externalId: row.external_id, title: row.title, artist: row.artist, isrc: row.isrc ?? undefined, service: adapter.service }
      : null;
  }

  let result: TrackResult | null;
  try {
    result = await adapter.match(track);
  } catch (err) {
    if (err instanceof ServiceUnavailableError) return null;
    throw err;
  }

  await pool.query(
    `INSERT INTO track_matches (match_key, service, external_id, title, artist, isrc)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (match_key, service) DO NOTHING`,
    [matchKey, adapter.service, result?.externalId ?? null, result?.title ?? track.title, result?.artist ?? track.artist, result?.isrc ?? track.isrc ?? null],
  );
  return result;
}
