import { YouTubeMusicAdapter } from '../youtubeMusicAdapter.js';
import { runMusicServiceAdapterContractTests } from '../contract.js';

// Exercises the real, unofficial YouTube Music "innertube" API. Requires a raw browser session
// cookie from a logged-in music.youtube.com session, so this is kept out of the default `npm test`
// run — run explicitly with `npm run test:integration` and a real YOUTUBE_MUSIC_TEST_COOKIE env var set.
runMusicServiceAdapterContractTests(
  'youtube_music (real API)',
  () => new YouTubeMusicAdapter(),
  () => {
    const cookie = process.env.YOUTUBE_MUSIC_TEST_COOKIE;
    if (!cookie) throw new Error('YOUTUBE_MUSIC_TEST_COOKIE is required for the YouTube Music integration contract test');
    return cookie;
  },
);
