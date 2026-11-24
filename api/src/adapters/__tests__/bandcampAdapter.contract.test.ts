import { FAKE_BANDCAMP_URL, FakeBandcampAdapter } from '../fakeAdapter.js';
import { runMusicServiceAdapterContractTests } from '../contract.js';

runMusicServiceAdapterContractTests(
  'bandcamp (fake)',
  () => new FakeBandcampAdapter(),
  () => FAKE_BANDCAMP_URL,
);
