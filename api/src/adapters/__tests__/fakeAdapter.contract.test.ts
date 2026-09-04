import { FakeMusicServiceAdapter } from '../fakeAdapter.js';
import { runMusicServiceAdapterContractTests } from '../contract.js';

runMusicServiceAdapterContractTests(
  'fake spotify',
  () => new FakeMusicServiceAdapter('spotify'),
  () => 'fake-access-token',
);

runMusicServiceAdapterContractTests(
  'fake apple_music',
  () => new FakeMusicServiceAdapter('apple_music'),
  () => 'fake-access-token',
);
