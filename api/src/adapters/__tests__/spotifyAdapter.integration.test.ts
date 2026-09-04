import { SpotifyAdapter } from '../spotifyAdapter.js';
import { runMusicServiceAdapterContractTests } from '../contract.js';

// Exercises the real Spotify API. Rate-limited and ToS-constrained, so this is kept out of
// the default `npm test` run — run explicitly with `npm run test:integration` and real
// SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / SPOTIFY_TEST_ACCESS_TOKEN env vars set.
runMusicServiceAdapterContractTests(
  'spotify (real API)',
  () =>
    new SpotifyAdapter({
      clientId: process.env.SPOTIFY_CLIENT_ID ?? '',
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? '',
    }),
  () => {
    const token = process.env.SPOTIFY_TEST_ACCESS_TOKEN;
    if (!token) throw new Error('SPOTIFY_TEST_ACCESS_TOKEN is required for the Spotify integration contract test');
    return token;
  },
);
