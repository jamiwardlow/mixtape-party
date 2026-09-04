import {
  ServiceUnavailableError,
  type AppleMusicLinkableAdapter,
  type MusicServiceAdapter,
  type OAuthLinkableAdapter,
  type PlaybackLaunchHandle,
  type PlaylistRef,
  type ServiceName,
  type TrackRef,
  type TrackResult,
  type YouTubeMusicLinkableAdapter,
} from './types.js';

/** Search query that makes a `youtube_music` fake throw {@link ServiceUnavailableError}, to exercise the fallback path. */
export const SEARCH_UNAVAILABLE_QUERY = 'SEARCH_UNAVAILABLE';

/**
 * In-memory stand-in for a real music-service adapter, used to exercise the
 * backend API (Seam 1) without hitting a real third-party service.
 */
export class FakeMusicServiceAdapter
  implements MusicServiceAdapter, OAuthLinkableAdapter, AppleMusicLinkableAdapter, YouTubeMusicLinkableAdapter
{
  private nextTrackId = 1;
  private nextPlaylistId = 1;
  readonly playlists = new Map<string, TrackResult[]>();

  constructor(readonly service: ServiceName = 'spotify') {}

  /** Test hook: authorization codes this fake will accept, mapped to the profile they resolve to. */
  readonly validAuthCodes = new Map<string, { serviceUserId: string; email?: string }>();

  /** Test hook: Music User Tokens this fake will accept, mapped to the profile they resolve to. */
  readonly validMusicUserTokens = new Map<string, { serviceUserId: string }>();

  /** Test hook: session cookies this fake will accept, mapped to the profile they resolve to. */
  readonly validCookies = new Map<string, { serviceUserId: string }>();

  async search(query: string): Promise<TrackResult[]> {
    if (this.service === 'youtube_music' && query === SEARCH_UNAVAILABLE_QUERY) {
      throw new ServiceUnavailableError('youtube_music', 'youtube music is unreachable');
    }
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
    if (track.title === 'NO_MATCH') return null;
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

  async getDeveloperToken(): Promise<string> {
    return 'fake-developer-token';
  }

  async linkMusicUserToken(musicUserToken: string): Promise<{ serviceUserId: string }> {
    const profile = this.validMusicUserTokens.get(musicUserToken);
    if (!profile) throw new Error('invalid_music_user_token');
    return profile;
  }

  async linkCookie(cookie: string): Promise<{ serviceUserId: string }> {
    if (cookie === SEARCH_UNAVAILABLE_QUERY) {
      throw new ServiceUnavailableError('youtube_music', 'youtube music is unreachable');
    }
    const profile = this.validCookies.get(cookie);
    if (!profile) throw new Error('invalid_cookie');
    return profile;
  }
}
