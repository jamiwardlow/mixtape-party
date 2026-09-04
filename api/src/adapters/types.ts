export type ServiceName = 'spotify' | 'apple_music' | 'youtube_music' | 'bandcamp';

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

/** OAuth account-linking, implemented by adapters whose service supports user-scoped linking (e.g. Spotify). */
export interface OAuthLinkableAdapter {
  getAuthorizeUrl(params: { codeChallenge: string; redirectUri: string; state: string; scope: string }): string;
  exchangeAuthorizationCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; scope: string }>;
  getProfile(accessToken: string): Promise<{ serviceUserId: string; email?: string }>;
}
