import { FakeMusicServiceAdapter } from '../fakeAdapter.js';
import { runMusicServiceAdapterContractTests } from '../contract.js';

runMusicServiceAdapterContractTests(
  'fake youtube_music',
  () => new FakeMusicServiceAdapter('youtube_music'),
  () => 'fake-access-token',
);
