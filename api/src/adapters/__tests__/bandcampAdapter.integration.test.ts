import { BandcampAdapter } from '../bandcampAdapter.js';
import { runEmbedOnlyAdapterContractTests } from '../contract.js';

// Exercises a real Bandcamp track page. Requires network access, so this is kept out of the
// default `npm test` run — run explicitly with `npm run test:integration`. The unit test next door
// covers the same parse against a captured fixture; this one catches the live markup changing.
//
// Uses the track from #59, which is stable and long-lived. The previous default
// (radiohead/creep) parses fine too, but it has no streamable audio, so it's a misleading thing
// to pin a playback assertion to. Override with BANDCAMP_TEST_URL if this ever 404s.
//
// `||`, not `??`: the CI job passes `BANDCAMP_TEST_URL: ${{ vars.BANDCAMP_TEST_URL }}`, and an
// unset repo variable renders as an empty string rather than staying absent. `??` kept that ''
// and the contract test "failed" on `submit('')` in 6ms without ever reaching Bandcamp (#68).
runEmbedOnlyAdapterContractTests(
  'bandcamp (real API)',
  () => new BandcampAdapter(),
  () => process.env.BANDCAMP_TEST_URL || 'https://tycho.bandcamp.com/track/awake',
);
