import { createApp } from './app.js';
import { createAppleIdentityVerifier, createAppleTokenExchange } from './routes/appleAuth.js';
import { createGoogleTokenExchange } from './routes/googleAuth.js';
import { createPool } from './db/pool.js';
import { YouTubeMusicAdapter } from './adapters/youtubeMusicAdapter.js';
import { BandcampAdapter } from './adapters/bandcampAdapter.js';
import { ExpoWebPushChannel, NoopEmailChannel, ResendEmailChannel } from './notifications/channels.js';

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) throw new Error('SESSION_SECRET is not set');

// No default: a fallback to localhost would silently email unreachable reset links from Cloud Run.
const appBaseUrl = process.env.APP_BASE_URL;
if (!appBaseUrl) throw new Error('APP_BASE_URL is not set');

// Google sign-in is optional, so a missing variable disables it rather than throwing. All three
// or nothing, decided here: a half-configured client would still redirect users to Google and only
// fail at the callback, where the secret is finally needed. The redirect URI comes from config so
// a forged Host header can never send an authorization code somewhere else.
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && googleClientSecret && process.env.GOOGLE_REDIRECT_URI);
const googleClientId = googleConfigured ? process.env.GOOGLE_CLIENT_ID : undefined;
const googleRedirectUri = googleConfigured ? process.env.GOOGLE_REDIRECT_URI : undefined;
const googleTokenExchange = createGoogleTokenExchange({
  clientId: googleClientId ?? '',
  clientSecret: googleClientSecret ?? '',
  redirectUri: googleRedirectUri ?? '',
});

// Sign in with Apple: same all-or-nothing rule. The private key is the .p8 contents; Secret Manager
// often flattens its newlines to a literal \n, so restore them.
const appleKey = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const appleConfigured = Boolean(
  process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && appleKey && process.env.APPLE_REDIRECT_URI,
);
const appleClientId = appleConfigured ? process.env.APPLE_CLIENT_ID : undefined;
const appleRedirectUri = appleConfigured ? process.env.APPLE_REDIRECT_URI : undefined;
const appleTokenExchange = createAppleTokenExchange({
  clientId: appleClientId ?? '',
  teamId: process.env.APPLE_TEAM_ID ?? '',
  keyId: process.env.APPLE_KEY_ID ?? '',
  privateKey: appleKey ?? '',
  redirectUri: appleRedirectUri ?? '',
});

const appleIdentityVerifier = createAppleIdentityVerifier(process.env.APPLE_BUNDLE_ID ?? 'com.mixtapeparty.app');

const youtubeMusicAdapter = new YouTubeMusicAdapter();
const bandcampAdapter = new BandcampAdapter();
// No key, no sender: local dev and CI need neither a Resend account nor outbound mail.
const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM;
if (resendApiKey && !emailFrom) throw new Error('EMAIL_FROM is not set');
const emailChannel = resendApiKey ? new ResendEmailChannel(resendApiKey, emailFrom!) : new NoopEmailChannel();

const pool = createPool();
const pushChannel = new ExpoWebPushChannel(pool);
const app = createApp({
  pool,
  sessionSecret,
  appBaseUrl,
  googleClientId,
  googleRedirectUri,
  googleTokenExchange,
  appleClientId,
  appleRedirectUri,
  appleTokenExchange,
  appleIdentityVerifier,
  youtubeMusicAdapter,
  youtubeMusicCookie: process.env.YOUTUBE_MUSIC_COOKIE,
  bandcampAdapter,
  pushChannel,
  emailChannel,
  reportEmail: process.env.REPORT_EMAIL,
  sweepSecret: process.env.SWEEP_SECRET,
  inboundWebhookSecret: process.env.RESEND_WEBHOOK_SECRET,
  resendApiKey,
  emailFrom,
  forwardTo: process.env.INBOUND_FORWARD_TO,
});
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`api listening on :${port}`));
