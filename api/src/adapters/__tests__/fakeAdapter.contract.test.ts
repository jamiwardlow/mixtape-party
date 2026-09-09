import { FakeMusicServiceAdapter } from '../fakeAdapter.js';
import { runMusicServiceAdapterContractTests } from '../contract.js';

runMusicServiceAdapterContractTests(
  'fake apple_music',
  () => new FakeMusicServiceAdapter('apple_music'),
  () => 'fake-access-token',
);

runMusicServiceAdapterContractTests(
  'fake youtube_music',
  () => new FakeMusicServiceAdapter('youtube_music'),
  () => 'fake-access-token',
);
