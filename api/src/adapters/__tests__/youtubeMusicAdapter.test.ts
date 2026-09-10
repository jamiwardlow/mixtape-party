import { afterEach, describe, expect, it, vi } from 'vitest';
import { YouTubeMusicAdapter } from '../youtubeMusicAdapter.js';
import searchResponse from './fixtures/ytmSearchResponse.json' with { type: 'json' };

// The contract test next door hits the real innertube API, but it needs a session cookie and so
// runs only under `npm run test:integration`. That gap let a response-shape change ship: videoId
// moved under playlistItemData, every result was filtered out, and search silently returned [].
// This parses a captured real response so the default suite catches the next such drift.
function stubFetch(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('YouTubeMusicAdapter.search', () => {
  it('reads externalId, title and artist out of a real search response', async () => {
    stubFetch(searchResponse);

    const results = await new YouTubeMusicAdapter().search('nina simone feeling good');

    expect(results).toEqual([
      { externalId: 'BNMKGYiJpvg', title: 'Feeling Good', artist: 'Nina Simone', service: 'youtube_music' },
      { externalId: '0IlSP9vVpMQ', title: "Don't Let Me Be Misunderstood", artist: 'Nina Simone', service: 'youtube_music' },
    ]);
  });

  it('drops shelf rows that carry no videoId, such as artist and album entries', async () => {
    stubFetch(searchResponse);

    const results = await new YouTubeMusicAdapter().search('nina simone');

    // The fixture holds three rows; the third is an artist row with no playlistItemData.
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.externalId)).toBe(true);
  });
});
