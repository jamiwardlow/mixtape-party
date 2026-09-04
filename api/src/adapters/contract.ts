import { describe, expect, it } from 'vitest';
import type { MusicServiceAdapter } from './types.js';

/**
 * Shared conformance checks for any MusicServiceAdapter implementation (Seam 2).
 * Asserts on the interface's observable behavior only, never a specific SDK call sequence.
 */
export function runMusicServiceAdapterContractTests(
  label: string,
  makeAdapter: () => MusicServiceAdapter,
  makeAccessToken: () => Promise<string> | string,
) {
  describe(`MusicServiceAdapter contract: ${label}`, () => {
    it('search returns results shaped as TrackResult for this service', async () => {
      const adapter = makeAdapter();
      const results = await adapter.search('test query');
      expect(Array.isArray(results)).toBe(true);
      for (const result of results) {
        expect(result.service).toBe(adapter.service);
        expect(typeof result.externalId).toBe('string');
        expect(typeof result.title).toBe('string');
        expect(typeof result.artist).toBe('string');
      }
    });

    it('createPlaylist then appendToPlaylist succeeds without throwing', async () => {
      const adapter = makeAdapter();
      const accessToken = await makeAccessToken();
      const playlist = await adapter.createPlaylist(accessToken, `contract-test-${Date.now()}`);
      expect(playlist.service).toBe(adapter.service);
      const [track] = await adapter.search('test query');
      await expect(adapter.appendToPlaylist(accessToken, playlist, [track])).resolves.not.toThrow();
    });

    it('getPlaybackLaunchHandle returns a deep link for this service', async () => {
      const adapter = makeAdapter();
      const [track] = await adapter.search('test query');
      const handle = await adapter.getPlaybackLaunchHandle(track);
      expect(handle.service).toBe(adapter.service);
      expect(typeof handle.deepLink).toBe('string');
      expect(handle.deepLink.length).toBeGreaterThan(0);
    });
  });
}
