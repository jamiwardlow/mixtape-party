import {
  ServiceUnavailableError,
  type EmbedOnlyMusicServiceAdapter,
  type MusicServiceAdapter,
  type PlaybackLaunchHandle,
  type ServiceName,
  type TrackRef,
  type TrackResult,
} from './types.js';

/** A pasted URL this fake resolves successfully, for exercising the Bandcamp submit-by-URL flow in tests. */
export const FAKE_BANDCAMP_URL = 'https://fakeartist.bandcamp.com/track/fake-song';

/** Search query that makes a `youtube_music` fake throw {@link ServiceUnavailableError}, to exercise the fallback path. */
export const SEARCH_UNAVAILABLE_QUERY = 'SEARCH_UNAVAILABLE';

/**
 * In-memory stand-in for a real music-service adapter, used to exercise the
 * backend API (Seam 1) without hitting a real third-party service.
 */
export class FakeMusicServiceAdapter implements MusicServiceAdapter {
  private nextTrackId = 1;

  constructor(readonly service: ServiceName = 'youtube_music') {}

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

  isTrackId(_externalId: string): boolean {
    return true;
  }

  async getPlaybackLaunchHandle(track: TrackResult): Promise<PlaybackLaunchHandle> {
    return { service: this.service, deepLink: `fake://play/${track.externalId}` };
  }

  async getPreviewUrl(track: TrackResult): Promise<string | null> {
    return track.title === 'NO_PREVIEW' ? null : `https://fake.test/preview/${track.externalId}.mp3`;
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

  async getPreviewUrl(track: TrackResult): Promise<string | null> {
    return `https://fake.test/bandcamp-preview/${track.externalId}.mp3`;
  }
}
