import { BandcampAdapter } from './bandcampAdapter.js';
import { ServiceUnavailableError, type PlaybackLaunchHandle, type TrackRef, type TrackResult } from './types.js';
import { YouTubeMusicAdapter } from './youtubeMusicAdapter.js';

/** A pasted URL this fake resolves successfully, for exercising the Bandcamp submit-by-URL flow in tests. */
export const FAKE_BANDCAMP_URL = 'https://fakeartist.bandcamp.com/track/fake-song';

/** Search query that makes the fake throw {@link ServiceUnavailableError}, to exercise the fallback path. */
export const SEARCH_UNAVAILABLE_QUERY = 'SEARCH_UNAVAILABLE';

/**
 * In-memory stand-in for {@link YouTubeMusicAdapter}, used to exercise the backend API (Seam 1)
 * without hitting YouTube. Only the network calls are faked; the capabilities built on them
 * (submission, thumbnail, playlist link) are the real adapter's.
 */
export class FakeMusicServiceAdapter extends YouTubeMusicAdapter {
  private nextTrackId = 1;

  /** Test hook: titles this adapter will fail to match, to exercise export fallback. */
  readonly forcedNoMatchTitles = new Set<string>();

  async search(query: string): Promise<TrackResult[]> {
    if (query === SEARCH_UNAVAILABLE_QUERY) {
      throw new ServiceUnavailableError('youtube_music', 'youtube music is unreachable');
    }
    return [{ externalId: `fake-track-${this.nextTrackId++}`, title: query, artist: 'Fake Artist', service: this.service }];
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

  /** Accepts any non-empty id; tests reassign it on the instance to exercise rejected or failing ids. */
  isTrackId(externalId: string): boolean {
    return externalId !== '';
  }

  async getPlaybackLaunchHandle(track: TrackResult): Promise<PlaybackLaunchHandle> {
    return { service: this.service, deepLink: `fake://play/${track.externalId}` };
  }

  async getPreviewUrl(track: TrackResult): Promise<string | null> {
    return track.title === 'NO_PREVIEW' ? null : `https://fake.test/preview/${track.externalId}.mp3`;
  }
}

/** In-memory stand-in for {@link BandcampAdapter}: only reading Bandcamp is faked. */
export class FakeBandcampAdapter extends BandcampAdapter {
  private nextTrackId = 1;

  async submit(url: string): Promise<TrackResult | null> {
    if (url !== FAKE_BANDCAMP_URL) return null;
    return {
      externalId: `track=${this.nextTrackId++}`,
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
