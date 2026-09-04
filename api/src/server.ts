import { createApp } from './app.js';
import { createPool } from './db/pool.js';
import { SpotifyAdapter } from './adapters/spotifyAdapter.js';

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) throw new Error('SESSION_SECRET is not set');

const spotifyAdapter = new SpotifyAdapter({
  clientId: process.env.SPOTIFY_CLIENT_ID ?? '',
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? '',
});

const app = createApp({ pool: createPool(), sessionSecret, spotifyAdapter });
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`api listening on :${port}`));
