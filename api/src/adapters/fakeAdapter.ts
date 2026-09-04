import type {
  MusicServiceAdapter,
  OAuthLinkableAdapter,
  PlaybackLaunchHandle,
  PlaylistRef,
  TrackRef,
  TrackResult,
} from './types.js';

/**
 * In-memory stand-in for a real music-service adapter, used to exercise the
 * backend API (Seam 1) without hitting a real third-party service.
 */
export class FakeMusicServiceAdapter implements MusicServiceAdapter, OAuthLinkableAdapter {
  readonly service = 'spotify' as const;

  private nextTrackId = 1;
  private nextPlaylistId = 1;
  readonly playlists = new Map<string, TrackResult[]>();

  /** Test hook: authorization codes this fake will accept, mapped to the profile they resolve to. */
  readonly validAuthCodes = new Map<string, { serviceUserId: string; email?: string }>();

  async search(query: string): Promise<TrackResult[]> {
    return [
      {
        externalId: `fake-track-${this.nextTrackId++}`,
        title: query,
        artist: 'Fake Artist',
        service: this.service,
      },
    ];
  }

  async match(track: TrackRef): Promise<TrackResult | null> {
    return {
      externalId: `fake-match-${track.title}`,
      title: track.title,
      artist: track.artist,
      isrc: track.isrc,
      service: this.service,
    };
  }

  async createPlaylist(_accessToken: string, name: string): Promise<PlaylistRef> {
    const externalId = `fake-playlist-${this.nextPlaylistId++}`;
    this.playlists.set(externalId, []);
    return { externalId, service: this.service };
  }

  async appendToPlaylist(_accessToken: string, playlist: PlaylistRef, tracks: TrackResult[]): Promise<void> {
    const existing = this.playlists.get(playlist.externalId);
    if (!existing) throw new Error(`unknown fake playlist ${playlist.externalId}`);
    existing.push(...tracks);
  }

  async getPlaybackLaunchHandle(track: TrackResult): Promise<PlaybackLaunchHandle> {
    return { service: this.service, deepLink: `fake://play/${track.externalId}` };
  }

  getAuthorizeUrl(params: { redirectUri: string; state: string }): string {
    return `https://fake-spotify.test/authorize?redirect_uri=${encodeURIComponent(params.redirectUri)}&state=${encodeURIComponent(params.state)}`;
  }

  async exchangeAuthorizationCode(params: { code: string }) {
    if (!this.validAuthCodes.has(params.code)) {
      throw new Error('invalid_grant');
    }
    return {
      accessToken: `fake-access-${params.code}`,
      refreshToken: `fake-refresh-${params.code}`,
      expiresIn: 3600,
      scope: 'playlist-modify-private',
    };
  }

  async getProfile(accessToken: string) {
    const code = accessToken.replace('fake-access-', '');
    const profile = this.validAuthCodes.get(code);
    if (!profile) throw new Error('invalid_token');
    return profile;
  }
}
