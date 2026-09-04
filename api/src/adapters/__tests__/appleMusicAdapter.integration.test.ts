import { AppleMusicAdapter } from '../appleMusicAdapter.js';
import { runMusicServiceAdapterContractTests } from '../contract.js';

// Exercises the real Apple Music API. Requires a developer key + a Music User Token from a
// subscribed account, so this is kept out of the default `npm test` run — run explicitly with
// `npm run test:integration` and real APPLE_MUSIC_TEAM_ID / APPLE_MUSIC_KEY_ID /
// APPLE_MUSIC_PRIVATE_KEY / APPLE_MUSIC_TEST_MUSIC_USER_TOKEN env vars set.
runMusicServiceAdapterContractTests(
  'apple_music (real API)',
  () =>
    new AppleMusicAdapter({
      teamId: process.env.APPLE_MUSIC_TEAM_ID ?? '',
      keyId: process.env.APPLE_MUSIC_KEY_ID ?? '',
      privateKey: process.env.APPLE_MUSIC_PRIVATE_KEY ?? '',
    }),
  () => {
    const token = process.env.APPLE_MUSIC_TEST_MUSIC_USER_TOKEN;
    if (!token) throw new Error('APPLE_MUSIC_TEST_MUSIC_USER_TOKEN is required for the Apple Music integration contract test');
    return token;
  },
);
