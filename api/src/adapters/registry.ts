import type { MusicServiceAdapter, PlaybackLaunchHandle, PlaylistService, ServiceName, TrackResult } from './types.js';

export interface AdapterRegistry {
  youtubeMusicAdapter: MusicServiceAdapter;
  bandcampAdapter: MusicServiceAdapter;
}

export const musicServices = (deps: AdapterRegistry): MusicServiceAdapter[] => [deps.youtubeMusicAdapter, deps.bandcampAdapter];

/** The adapter answering to `service`, or undefined for a name none does (e.g. an unvalidated request field). */
export const findService = (deps: AdapterRegistry, service: unknown): MusicServiceAdapter | undefined =>
  musicServices(deps).find((adapter) => adapter.service === service);

/** The adapter for a service name already known to be valid, such as one read back from the database. */
export function serviceFor(deps: AdapterRegistry, service: ServiceName): MusicServiceAdapter {
  const adapter = findService(deps, service);
  if (!adapter) throw new Error(`unsupported service: ${service}`);
  return adapter;
}

export const playlistServices = (deps: AdapterRegistry): PlaylistService[] =>
  musicServices(deps).filter((adapter): adapter is PlaylistService => adapter.exportable && Boolean(adapter.match && adapter.playlistUrl));

/** Names of the services whose submissions go into playlists, for a `service = ANY($n)` filter. */
export const exportableServiceNames = (deps: AdapterRegistry): ServiceName[] =>
  playlistServices(deps).map((adapter) => adapter.service);

/** A `submissions` row, or the part of one a query selected. */
export interface StoredTrackRow {
  service: ServiceName;
  external_id: string;
  title: string;
  artist: string;
  isrc?: string | null;
  /** BIGINT, so pg hands it back as a string. */
  art_id?: string | number | null;
  page_url?: string | null;
}

export const storedTrack = (row: StoredTrackRow): TrackResult => ({
  externalId: row.external_id,
  title: row.title,
  artist: row.artist,
  isrc: row.isrc ?? undefined,
  service: row.service,
  artId: row.art_id == null ? undefined : Number(row.art_id),
  pageUrl: row.page_url ?? undefined,
});

/** The link out to a stored track on its service. */
export const playbackFor = (deps: AdapterRegistry, row: StoredTrackRow): Promise<PlaybackLaunchHandle> =>
  serviceFor(deps, row.service).getPlaybackLaunchHandle(storedTrack(row));

export const thumbnailFor = (deps: AdapterRegistry, row: StoredTrackRow): string | null =>
  serviceFor(deps, row.service).thumbnailUrl(storedTrack(row));
