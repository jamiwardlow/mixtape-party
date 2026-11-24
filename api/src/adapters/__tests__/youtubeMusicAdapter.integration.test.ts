import { expect, it } from 'vitest';
import { YouTubeMusicAdapter } from '../youtubeMusicAdapter.js';
import { runMusicServiceAdapterContractTests } from '../contract.js';

// Exercises the real, unofficial YouTube Music "innertube" API, so this is kept out of the default
// `npm test` run — run explicitly with `npm run test:integration`. Needs no credential.
const adapter = new YouTubeMusicAdapter();

runMusicServiceAdapterContractTests('youtube_music (real API)', () => adapter);

// Export is a watch_videos link (#215): it only works while YouTube keeps turning it into a playlist.
it('watch_videos still redirects an exported id list to a playlist', async () => {
  const res = await fetch(new YouTubeMusicAdapter().playlistUrl('dQw4w9WgXcQ,9bZkp7q19f0'), { redirect: 'manual' });
  // Any 3xx will do (we've seen 302 and 303); the list= target is the contract.
  expect(`${res.status} ${res.headers.get('location')}`).toMatch(/^30\d .*[?&]list=/);
});
