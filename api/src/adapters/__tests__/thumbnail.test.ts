import { describe, expect, it } from 'vitest';
import { thumbnailUrlOf } from '../thumbnail.js';

describe('thumbnailUrlOf', () => {
  it('derives YouTube art from the video id', () => {
    expect(thumbnailUrlOf('youtube_music', 'abc')).toBe('https://i.ytimg.com/vi/abc/mqdefault.jpg');
  });

  it('builds Bandcamp art from the stored art_id (a string off a BIGINT), and is null without one', () => {
    expect(thumbnailUrlOf('bandcamp', 'track=1', '3370493783')).toBe('https://f4.bcbits.com/img/a3370493783_9.jpg');
    expect(thumbnailUrlOf('bandcamp', 'track=1', null)).toBeNull();
  });
});
