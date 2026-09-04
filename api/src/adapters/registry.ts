import type { EmbedOnlyMusicServiceAdapter, MusicServiceAdapter, ServiceName } from './types.js';

export interface AdapterRegistry {
  spotifyAdapter: MusicServiceAdapter;
  appleMusicAdapter: MusicServiceAdapter;
  youtubeMusicAdapter: MusicServiceAdapter;
  bandcampAdapter: EmbedOnlyMusicServiceAdapter;
}

/** Resolves the search/match-capable adapter for a service (Seam 2 lookup). Bandcamp has no search, so it's excluded. */
export function adapterFor(
  deps: AdapterRegistry,
  service: Exclude<ServiceName, 'bandcamp'>,
): MusicServiceAdapter {
  switch (service) {
    case 'spotify':
      return deps.spotifyAdapter;
    case 'apple_music':
      return deps.appleMusicAdapter;
    case 'youtube_music':
      return deps.youtubeMusicAdapter;
    default:
      throw new Error(`unsupported service: ${service}`);
  }
}

/** Resolves whichever adapter (full or embed-only) can produce a playback launch handle for a submission's service. */
export function playbackAdapterFor(
  deps: AdapterRegistry,
  service: ServiceName,
): MusicServiceAdapter | EmbedOnlyMusicServiceAdapter {
  return service === 'bandcamp' ? deps.bandcampAdapter : adapterFor(deps, service);
}
