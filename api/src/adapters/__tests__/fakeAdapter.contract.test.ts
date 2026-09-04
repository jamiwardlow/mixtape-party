import { FakeMusicServiceAdapter } from '../fakeAdapter.js';
import { runMusicServiceAdapterContractTests } from '../contract.js';

runMusicServiceAdapterContractTests(
  'fake',
  () => new FakeMusicServiceAdapter(),
  () => 'fake-access-token',
);
