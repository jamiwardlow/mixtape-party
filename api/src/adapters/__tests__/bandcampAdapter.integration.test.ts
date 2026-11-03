import { describe, expect, it } from 'vitest';
import { BandcampAdapter } from '../bandcampAdapter.js';
import { runEmbedOnlyAdapterContractTests } from '../contract.js';
import { ServiceUnavailableError } from '../types.js';

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
// An embed URL, not the track page: Bandcamp serves datacenter IPs (CI runners, Cloud Run) a "Client
// Challenge" bot wall on track pages, which is why the app now asks for Share → Embed code (#169).
// The player page is the path that works from there. Track 148177487 is tycho/awake from #59.
const DEFAULT_URL = 'https://bandcamp.com/EmbeddedPlayer/track=148177487';

// Bandcamp bot-walls datacenter IPs (CI runners, Cloud Run), so a challenge says nothing about the parse.
// Skip rather than fail; production exposure is tracked separately (#184 follow-up).
// ponytail: probes once at load; run the suite from a residential IP to get real coverage.
const blocked = await new BandcampAdapter()
  .submit(process.env.BANDCAMP_TEST_URL || DEFAULT_URL)
  .then(() => false, (err) => err instanceof ServiceUnavailableError);
if (blocked) console.warn('bandcamp contract tests skipped: bot challenge / unavailable from this network');
const suite = blocked ? describe.skip : describe;

suite('bandcamp contract (real API)', () => {
  runEmbedOnlyAdapterContractTests(
    'bandcamp (real API)',
    () => new BandcampAdapter(),
    () => process.env.BANDCAMP_TEST_URL || DEFAULT_URL,
  );
});

// #102: the preview reads the `file` shape off the embedded player page, which can change without notice.
suite('bandcamp preview (real API)', () => {
  it('finds a streamable mp3 for a known streamable track', async () => {
    const adapter = new BandcampAdapter();
    const track = await adapter.submit(process.env.BANDCAMP_TEST_URL || DEFAULT_URL);
    expect(await adapter.getPreviewUrl(track!)).toMatch(/^https:\/\/.+\/mp3-128\//);
  });
});
