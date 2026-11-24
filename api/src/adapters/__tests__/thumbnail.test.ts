import { describe, expect, it } from 'vitest';
import { BandcampAdapter } from '../bandcampAdapter.js';
import { storedTrack } from '../registry.js';
import { YouTubeMusicAdapter } from '../youtubeMusicAdapter.js';

describe('thumbnailUrl', () => {
  it('derives YouTube art from the video id', () => {
    const track = storedTrack({ service: 'youtube_music', external_id: 'abc', title: 't', artist: 'a' });
    expect(new YouTubeMusicAdapter().thumbnailUrl(track)).toBe('https://i.ytimg.com/vi/abc/mqdefault.jpg');
  });

  it('builds Bandcamp art from the stored art_id (a string off a BIGINT), and is null without one', () => {
    const row = { service: 'bandcamp', external_id: 'track=1', title: 't', artist: 'a' } as const;
    const bandcamp = new BandcampAdapter();
    expect(bandcamp.thumbnailUrl(storedTrack({ ...row, art_id: '3370493783' }))).toBe(
      'https://f4.bcbits.com/img/a3370493783_9.jpg',
    );
    expect(bandcamp.thumbnailUrl(storedTrack({ ...row, art_id: null }))).toBeNull();
  });
});
