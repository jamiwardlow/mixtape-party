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
app.use(express.static(path.join(__dirname, 'dist/client'), { maxAge: '1h' }));
app.use(createRequestHandler({ build: path.join(__dirname, 'dist/server') }));

// Cloud Run injects PORT.
app.listen(Number(process.env.PORT) || 8080, '0.0.0.0');
