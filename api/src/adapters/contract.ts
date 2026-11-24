import { describe, expect, it } from 'vitest';
import type { MusicServiceAdapter, TrackResult } from './types.js';

/**
 * Shared conformance checks for any MusicServiceAdapter implementation (Seam 2), one test per
 * capability. Asserts on the interface's observable behavior only, never a specific SDK call
 * sequence. A paste-a-URL service (no `search`) needs `validUrl` to get a sample track.
 */
export function runMusicServiceAdapterContractTests(
  label: string,
  makeAdapter: () => MusicServiceAdapter,
  validUrl?: () => Promise<string> | string,
) {
  async function sample(adapter: MusicServiceAdapter): Promise<TrackResult> {
    if (adapter.search) return (await adapter.search('test query'))[0];
    const resolution = await adapter.resolveSubmission({ url: await validUrl!() });
    if (!('track' in resolution)) throw new Error(`sample url did not resolve: ${resolution.error}`);
    return resolution.track;
  }

  function expectTrack(track: TrackResult | null | undefined, adapter: MusicServiceAdapter) {
    expect(track?.service).toBe(adapter.service);
    expect(typeof track?.externalId).toBe('string');
    expect(typeof track?.title).toBe('string');
    expect(typeof track?.artist).toBe('string');
  }

  describe(`MusicServiceAdapter contract: ${label}`, () => {
    it('is either searchable or resolves a pasted url', async () => {
      const adapter = makeAdapter();
      if (!adapter.search) {
        expect(validUrl).toBeDefined();
        return;
      }
      const results = await adapter.search('test query');
      // A response-shape change shows up as an empty array, not an error (#54): every result gets
      // filtered out and nothing throws. An empty result for a common query is the drift signal.
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) expectTrack(result, adapter);
    });

    it('match finds a track on this service, or null', async () => {
      const adapter = makeAdapter();
      if (!adapter.match) return;
      const track = await sample(adapter);
      const matched = await adapter.match(track);
      if (matched !== null) expectTrack(matched, adapter);
    });

    it("isTrackId recognizes this service's own ids and rejects an empty one", async () => {
      const adapter = makeAdapter();
      expect(adapter.isTrackId((await sample(adapter)).externalId)).toBe(true);
      expect(adapter.isTrackId('')).toBe(false);
    });

    it('resolveSubmission turns a submit request into a track on this service', async () => {
      const adapter = makeAdapter();
      const request = adapter.search ? { ...(await sample(adapter)) } : { url: await validUrl!() };
      const resolution = await adapter.resolveSubmission(request);
      expect('track' in resolution && resolution.track).toBeTruthy();
      if ('track' in resolution) expectTrack(resolution.track, adapter);
    });

    it('resolveSubmission rejects a malformed request with a 400', async () => {
      const adapter = makeAdapter();
      expect(await adapter.resolveSubmission({})).toMatchObject({ status: 400 });
      if (!adapter.search) {
        expect(await adapter.resolveSubmission({ url: 'https://example.com/not-a-track' })).toMatchObject({ status: 400 });
      }
    });

    it('thumbnailUrl is a url or null', async () => {
      const adapter = makeAdapter();
      const thumbnail = adapter.thumbnailUrl(await sample(adapter));
      expect(thumbnail === null || /^https:\/\//.test(thumbnail)).toBe(true);
    });

    it('getPlaybackLaunchHandle returns a deep link for this service', async () => {
      const adapter = makeAdapter();
      const handle = await adapter.getPlaybackLaunchHandle(await sample(adapter));
      expect(handle.service).toBe(adapter.service);
      expect(handle.deepLink.length).toBeGreaterThan(0);
    });

    it('getPreviewUrl returns a url or null', async () => {
      const adapter = makeAdapter();
      const preview = await adapter.getPreviewUrl(await sample(adapter));
      expect(preview === null || /^https?:\/\//.test(preview)).toBe(true);
    });

    it('previewFallback, when offered, is a flat record of strings', async () => {
      const adapter = makeAdapter();
      if (!adapter.previewFallback) return;
      for (const value of Object.values(adapter.previewFallback(await sample(adapter)))) {
        expect(typeof value).toBe('string');
      }
    });

    it('an exportable service can link a playlist', () => {
      const adapter = makeAdapter();
      expect(typeof adapter.exportable).toBe('boolean');
      if (adapter.exportable) {
        expect(adapter.match).toBeDefined();
        expect(adapter.playlistUrl?.('abc')).toMatch(/^https:\/\//);
      }
    });
  });
}
