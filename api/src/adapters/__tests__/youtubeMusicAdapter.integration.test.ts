import { YouTubeMusicAdapter } from '../youtubeMusicAdapter.js';
import { runMusicServiceAdapterContractTests } from '../contract.js';

// Exercises the real, unofficial YouTube Music "innertube" API. Requires a raw browser session
// cookie from a logged-in music.youtube.com session, so this is kept out of the default `npm test`
// run — run explicitly with `npm run test:integration` and a real YOUTUBE_MUSIC_TEST_COOKIE env var set.
const adapter = new YouTubeMusicAdapter();

runMusicServiceAdapterContractTests(
  'youtube_music (real API)',
  () => adapter,
  () => {
    const cookie = process.env.YOUTUBE_MUSIC_TEST_COOKIE;
    if (!cookie) throw new Error('YOUTUBE_MUSIC_TEST_COOKIE is required for the YouTube Music integration contract test');
    return cookie;
  },
  // The cookie belongs to the shared app account, so without this the daily scheduled run
  // (.github/workflows/music-service-contract.yml) leaves a contract-test playlist behind forever.
  // ponytail: only cleans up the playlist this run made — a run killed mid-test still leaks one.
  // Sweep every `contract-test-*` playlist at startup instead if leaks show up again.
  (cookie, playlist) => adapter.deletePlaylist(cookie, playlist),
);
