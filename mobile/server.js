// Production server for the web client (Cloud Run). Serves the static half of `expo export -p web`
// (dist/client) and hands everything else to expo-server's Express adapter, so /join/ABC and
// /round/<id> are server-rendered with their link-preview meta rather than 404ing.
//
// ponytail: `npx expo serve` is Expo's local-preview command, not a hardened prod server, and
// it does not satisfy #36's SSR requirement -- hence this file. No compression/rate limiting:
// add them here if traffic ever warrants.
const path = require('node:path');
const express = require('express');
const { createRequestHandler } = require('expo-server/adapter/express');

const app = express();
app.disable('x-powered-by');
// The marketing page lives at exactly `/` (ahead of expo-server, whose `/` just redirects).
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'landing.html')));
app.get('/landing-favicon.svg', (_req, res) => res.sendFile(path.join(__dirname, 'landing-favicon.svg')));
// Universal links / Android app links (#142). Served here, not from public/, because static
// middleware skips dotfile dirs and AASA has no extension. Set APPLE_TEAM_ID and
// ANDROID_SHA256_CERT_FINGERPRINT (release signing SHA-256, colon-separated) on the Cloud Run
// service; until then the placeholders keep the files valid JSON but verification fails.
const PATHS = ['/auth/*', '/reset-password', '/round/*', '/league/*', '/join/*'];
const teamId = process.env.APPLE_TEAM_ID || 'TEAMID_PLACEHOLDER';
const sha256 = process.env.ANDROID_SHA256_CERT_FINGERPRINT || 'SHA256_PLACEHOLDER';
app.get('/.well-known/apple-app-site-association', (_req, res) =>
  res.json({
    applinks: { details: [{ appIDs: [`${teamId}.com.mixtapeparty.app`], components: PATHS.map((p) => ({ '/': p })) }] },
  }),
);
app.get('/.well-known/assetlinks.json', (_req, res) =>
  res.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'com.mixtapeparty.app', sha256_cert_fingerprints: [sha256] },
    },
  ]),
);
app.use(express.static(path.join(__dirname, 'dist/client'), { maxAge: '1h' }));
app.use(createRequestHandler({ build: path.join(__dirname, 'dist/server') }));

// Cloud Run injects PORT.
app.listen(Number(process.env.PORT) || 8080, '0.0.0.0');
