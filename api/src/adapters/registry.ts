import type { MusicServiceAdapter, ServiceName } from './types.js';

export interface AdapterRegistry {
  spotifyAdapter: MusicServiceAdapter;
  appleMusicAdapter: MusicServiceAdapter;
}

/** Resolves the adapter for a submission/search's service (Seam 2 lookup, shared by every route that needs it). */
export function adapterFor(deps: AdapterRegistry, service: ServiceName): MusicServiceAdapter {
  switch (service) {
    case 'spotify':
      return deps.spotifyAdapter;
    case 'apple_music':
      return deps.appleMusicAdapter;
    default:
      throw new Error(`unsupported service: ${service}`);
  }
}
