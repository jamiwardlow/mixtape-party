import { FakeMusicServiceAdapter } from '../fakeAdapter.js';
import { runMusicServiceAdapterContractTests } from '../contract.js';

runMusicServiceAdapterContractTests('fake youtube_music', () => new FakeMusicServiceAdapter());
