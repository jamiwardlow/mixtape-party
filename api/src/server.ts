import { createApp } from './app.js';
import { createPool } from './db/pool.js';
import { AppleMusicAdapter } from './adapters/appleMusicAdapter.js';
import { YouTubeMusicAdapter } from './adapters/youtubeMusicAdapter.js';
import { BandcampAdapter } from './adapters/bandcampAdapter.js';
import { ExpoWebPushChannel, NoopEmailChannel, ResendEmailChannel } from './notifications/channels.js';
import { runNotificationSweep } from './notifications/sweep.js';

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) throw new Error('SESSION_SECRET is not set');

// No default: a fallback to localhost would silently email unreachable reset links from Render.
const appBaseUrl = process.env.APP_BASE_URL;
if (!appBaseUrl) throw new Error('APP_BASE_URL is not set');

const appleMusicAdapter = new AppleMusicAdapter({
  teamId: process.env.APPLE_MUSIC_TEAM_ID ?? '',
  keyId: process.env.APPLE_MUSIC_KEY_ID ?? '',
  privateKey: process.env.APPLE_MUSIC_PRIVATE_KEY ?? '',
  storefront: process.env.APPLE_MUSIC_STOREFRONT,
});

const youtubeMusicAdapter = new YouTubeMusicAdapter();
const bandcampAdapter = new BandcampAdapter();
const pushChannel = new ExpoWebPushChannel();
// No key, no sender: local dev and CI need neither a Resend account nor outbound mail.
const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM;
if (resendApiKey && !emailFrom) throw new Error('EMAIL_FROM is not set');
const emailChannel = resendApiKey ? new ResendEmailChannel(resendApiKey, emailFrom!) : new NoopEmailChannel();

const pool = createPool();
const app = createApp({
  pool,
  sessionSecret,
  appBaseUrl,
  appleMusicAdapter,
  youtubeMusicAdapter,
  youtubeMusicCookie: process.env.YOUTUBE_MUSIC_COOKIE,
  bandcampAdapter,
  pushChannel,
  emailChannel,
});
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`api listening on :${port}`));

// ponytail: single-process sweep assumed, no advisory lock against a concurrent duplicate tick.
// Add a per-round/league advisory lock (or a dedicated worker) if this API ever runs more than one instance.
setInterval(() => {
  runNotificationSweep({ pool, pushChannel, emailChannel }).catch((err) => console.error('notification sweep failed', err));
}, 60_000);
