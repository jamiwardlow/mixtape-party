export type ServiceName = 'apple_music' | 'youtube_music' | 'bandcamp';

export interface TrackRef {
  isrc?: string;
  title: string;
  artist: string;
}

export interface TrackResult extends TrackRef {
  externalId: string;
  service: ServiceName;
}

export interface PlaylistRef {
  externalId: string;
  service: ServiceName;
}

export interface PlaybackLaunchHandle {
  service: ServiceName;
  deepLink: string;
  webUrl?: string;
}

/** Shared contract every per-service music adapter must satisfy (Seam 2). */
export interface MusicServiceAdapter {
  readonly service: ServiceName;
  search(query: string, accessToken?: string): Promise<TrackResult[]>;
  match(track: TrackRef, accessToken?: string): Promise<TrackResult | null>;
  createPlaylist(accessToken: string, name: string): Promise<PlaylistRef>;
  appendToPlaylist(accessToken: string, playlist: PlaylistRef, tracks: TrackResult[]): Promise<void>;
  getPlaybackLaunchHandle(track: TrackResult): Promise<PlaybackLaunchHandle>;
}

/**
 * Contract for a service with no catalog search/discovery API (currently only Bandcamp): a player
 * submits a track by pasting its URL instead of searching, and it's excluded from cross-service
 * playlist export since there's no ID to match against the other services' catalogs.
 */
export interface EmbedOnlyMusicServiceAdapter {
  readonly service: ServiceName;
  /** Resolves a pasted track/album URL into a track, or null if the URL isn't a valid/resolvable link. */
  submit(url: string): Promise<TrackResult | null>;
  getPlaybackLaunchHandle(track: TrackResult): Promise<PlaybackLaunchHandle>;
}

/**
 * Music User Token account-linking, implemented by adapters whose service hands the client an
 * opaque per-user token directly (e.g. Apple Music via MusicKit), with no OAuth code exchange.
 */
export interface AppleMusicLinkableAdapter {
  getDeveloperToken(): Promise<string>;
  linkMusicUserToken(musicUserToken: string): Promise<{ serviceUserId: string }>;
}

/**
 * Thrown by an adapter whose underlying API is unauthenticated/unofficial and can go down or
 * change shape without notice (currently only YouTube Music). Callers must catch this
 * specifically and surface an explicit "unavailable" state rather than a generic 500.
 */
export class ServiceUnavailableError extends Error {
  constructor(
    readonly service: ServiceName,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ServiceUnavailableError';
  }
}
