import { createApp } from './app.js';
import { createPool } from './db/pool.js';
import { SpotifyAdapter } from './adapters/spotifyAdapter.js';
import { AppleMusicAdapter } from './adapters/appleMusicAdapter.js';

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) throw new Error('SESSION_SECRET is not set');

const spotifyAdapter = new SpotifyAdapter({
  clientId: process.env.SPOTIFY_CLIENT_ID ?? '',
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? '',
});

const appleMusicAdapter = new AppleMusicAdapter({
  teamId: process.env.APPLE_MUSIC_TEAM_ID ?? '',
  keyId: process.env.APPLE_MUSIC_KEY_ID ?? '',
  privateKey: process.env.APPLE_MUSIC_PRIVATE_KEY ?? '',
  storefront: process.env.APPLE_MUSIC_STOREFRONT,
});

const app = createApp({ pool: createPool(), sessionSecret, spotifyAdapter, appleMusicAdapter });
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`api listening on :${port}`));
