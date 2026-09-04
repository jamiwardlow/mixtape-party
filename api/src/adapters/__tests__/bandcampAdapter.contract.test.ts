import { FAKE_BANDCAMP_URL, FakeBandcampAdapter } from '../fakeAdapter.js';
import { runEmbedOnlyAdapterContractTests } from '../contract.js';

runEmbedOnlyAdapterContractTests(
  'bandcamp (fake)',
  () => new FakeBandcampAdapter(),
  () => FAKE_BANDCAMP_URL,
);
