import {
  ServiceUnavailableError,
  type AppleMusicLinkableAdapter,
  type EmbedOnlyMusicServiceAdapter,
  type MusicServiceAdapter,
  type PlaybackLaunchHandle,
  type PlaylistRef,
  type ServiceName,
  type TrackRef,
  type TrackResult,
  type YouTubeMusicLinkableAdapter,
} from './types.js';

/** A pasted URL this fake resolves successfully, for exercising the Bandcamp submit-by-URL flow in tests. */
export const FAKE_BANDCAMP_URL = 'https://fakeartist.bandcamp.com/track/fake-song';

/** Search query that makes a `youtube_music` fake throw {@link ServiceUnavailableError}, to exercise the fallback path. */
export const SEARCH_UNAVAILABLE_QUERY = 'SEARCH_UNAVAILABLE';

/**
 * In-memory stand-in for a real music-service adapter, used to exercise the
 * backend API (Seam 1) without hitting a real third-party service.
 */
export class FakeMusicServiceAdapter
  implements MusicServiceAdapter, AppleMusicLinkableAdapter, YouTubeMusicLinkableAdapter
{
  private nextTrackId = 1;
  private nextPlaylistId = 1;
  readonly playlists = new Map<string, TrackResult[]>();

  constructor(readonly service: ServiceName = 'apple_music') {}

  /** Test hook: Music User Tokens this fake will accept, mapped to the profile they resolve to. */
  readonly validMusicUserTokens = new Map<string, { serviceUserId: string }>();

  /** Test hook: session cookies this fake will accept, mapped to the profile they resolve to. */
  readonly validCookies = new Map<string, { serviceUserId: string }>();

  /** Test hook: titles that this specific adapter instance (i.e. this one service) will fail to match, to exercise cross-service export fallback. */
  readonly forcedNoMatchTitles = new Set<string>();

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
    if (track.title === 'NO_MATCH' || this.forcedNoMatchTitles.has(track.title)) return null;
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

/** In-memory stand-in for {@link BandcampAdapter}, used to exercise the submit-by-URL flow without hitting Bandcamp. */
export class FakeBandcampAdapter implements EmbedOnlyMusicServiceAdapter {
  readonly service = 'bandcamp' as const;
  private nextTrackId = 1;

  async submit(url: string): Promise<TrackResult | null> {
    if (url !== FAKE_BANDCAMP_URL) return null;
    return {
      externalId: `fake-bandcamp-track-${this.nextTrackId++}`,
      title: 'Fake Bandcamp Song',
      artist: 'Fake Bandcamp Artist',
      service: this.service,
    };
  }

  async getPlaybackLaunchHandle(track: TrackResult): Promise<PlaybackLaunchHandle> {
    return { service: this.service, deepLink: `fake://bandcamp-play/${track.externalId}` };
  }
}
