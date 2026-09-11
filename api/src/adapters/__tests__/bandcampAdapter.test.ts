import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BandcampAdapter } from '../bandcampAdapter.js';
import { ServiceUnavailableError } from '../types.js';

// Bandcamp's public oEmbed endpoint started answering HTTP 200 with
// `{"error":true,"error_message":"bad version"}` for every URL (#59), so `submit()` silently
// returned null and pasted links were rejected as invalid. There is no replacement endpoint, so
// the adapter reads the track/album page instead. These fixtures are trimmed captures of real
// pages: if Bandcamp changes the markup, this fails in the default suite rather than in production.
function readFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

function stubFetch(body: string, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => body }) as unknown as Response),
  );
}

const trackPage = readFixture('bandcampTrackPage.html');
const albumPage = readFixture('bandcampAlbumPage.html');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BandcampAdapter.submit', () => {
  it('reads externalId, title and artist off a real track page', async () => {
    stubFetch(trackPage);

    const result = await new BandcampAdapter().submit('https://tycho.bandcamp.com/track/awake');

    expect(result).toEqual({
      externalId: 'track=148177487',
      title: 'Awake',
      artist: 'Tycho',
      service: 'bandcamp',
    });
  });

  it('reads an album page, whose id is an album rather than a track', async () => {
    stubFetch(albumPage);

    const result = await new BandcampAdapter().submit('https://tycho.bandcamp.com/album/awake');

    expect(result).toEqual({
      externalId: 'album=2414419453',
      title: 'Awake',
      artist: 'Tycho',
      service: 'bandcamp',
    });
  });

  // The whole blob arrives HTML-escaped, so a title with an apostrophe or an ampersand only
  // survives if every entity Bandcamp emits decodes. `&amp;` must not decode twice, or the `&quot;`
  // it precedes turns into a quote that breaks the JSON parse.
  it('decodes named, decimal and hex entities in a title', async () => {
    const blob = JSON.stringify({
      id: 1,
      item_type: 'track',
      artist: 'Sam &amp; Dave',
      current: { title: 'Ain&#39;t It A Shame &amp;quot;live&amp;quot; &#x2014; Caf&#xe9;' },
    }).replace(/"/g, '&quot;');
    stubFetch(`<script data-tralbum="${blob}"></script>`);

    const result = await new BandcampAdapter().submit('https://x.bandcamp.com/track/y');

    expect(result?.artist).toBe('Sam & Dave');
    expect(result?.title).toBe('Ain\'t It A Shame &quot;live&quot; — Café');
  });

  // The exact shape #59 arrived in: HTTP 200, no usable payload. Must stay a rejected paste
  // (null), but now with a log line rather than in total silence.
  it('returns null for a 200 whose body carries no parseable track data', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch('{"error":true,"error_message":"bad version"}');

    expect(await new BandcampAdapter().submit('https://tycho.bandcamp.com/track/awake')).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('returns null for a page that carries no track data, such as a 404', async () => {
    stubFetch('<html><body>no such page</body></html>', 404);

    expect(await new BandcampAdapter().submit('https://tycho.bandcamp.com/track/nope')).toBeNull();
  });

  // Scraping a public page invites bot-blocking, and the caller maps null to a 400 telling the
  // player their link is invalid. A refusal is an outage, so it has to throw instead.
  it.each([403, 429, 503])('throws ServiceUnavailableError on HTTP %i rather than rejecting the link', async (status) => {
    stubFetch('<html>blocked</html>', status);

    await expect(new BandcampAdapter().submit('https://tycho.bandcamp.com/track/awake')).rejects.toThrow(
      ServiceUnavailableError,
    );
  });

  it('returns null for a non-Bandcamp host without fetching', async () => {
    stubFetch(trackPage);

    expect(await new BandcampAdapter().submit('https://example.com/not-a-track')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
