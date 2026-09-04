import { BandcampAdapter } from '../bandcampAdapter.js';
import { runEmbedOnlyAdapterContractTests } from '../contract.js';

// Exercises Bandcamp's real public oEmbed endpoint. Requires network access, so this is kept out
// of the default `npm test` run — run explicitly with `npm run test:integration`. Uses a stable,
// long-lived Bandcamp track URL; override with a real BANDCAMP_TEST_URL env var if it ever 404s.
runEmbedOnlyAdapterContractTests(
  'bandcamp (real API)',
  () => new BandcampAdapter(),
  () => process.env.BANDCAMP_TEST_URL ?? 'https://radiohead.bandcamp.com/track/creep',
);
