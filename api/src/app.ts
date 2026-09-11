import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import type {
  AppleMusicLinkableAdapter,
  EmbedOnlyMusicServiceAdapter,
  MusicServiceAdapter,
} from './adapters/types.js';
import { createAccountsRouter } from './routes/accounts.js';
import { createAppleMusicAuthRouter } from './routes/appleMusicAuth.js';
import { createAuthRouter } from './routes/auth.js';
import { createExportRouter } from './routes/export.js';
import { createGoogleAuthRouter, type GoogleProfile } from './routes/googleAuth.js';
import { createGuessingRouter } from './routes/guessing.js';
import { createLeaguesRouter } from './routes/leagues.js';
import { createNotificationsRouter } from './routes/notifications.js';
import { createResultsRouter } from './routes/results.js';
import { createSubmissionsRouter } from './routes/submissions.js';
import type { EmailChannel, PushChannel } from './notifications/types.js';

export interface AppDeps {
  pool: Pool;
  sessionSecret: string;
  /** Origin of the web client, where emailed password-reset and sign-in links land. */
  appBaseUrl: string;
  /** Google OAuth client id and the redirect URI registered against it. Unset leaves the routes
   *  inert: /auth/google/start answers 503 rather than sending users to a malformed Google URL. */
  googleClientId?: string;
  googleRedirectUri?: string;
  /** Injected so the callback — the most security-sensitive route here — is testable without Google. */
  googleTokenExchange: (code: string) => Promise<GoogleProfile>;
  appleMusicAdapter: MusicServiceAdapter & AppleMusicLinkableAdapter;
  youtubeMusicAdapter: MusicServiceAdapter;
  // App-owned music.youtube.com session cookie shared by all users' exports — see youtubeMusicAdapter.ts.
  youtubeMusicCookie?: string;
  bandcampAdapter: EmbedOnlyMusicServiceAdapter;
  pushChannel: PushChannel;
  emailChannel: EmailChannel;
}

export function createApp(deps: AppDeps): Express {
  // Both halves of "usable appBaseUrl" live here, the one place all three consumers read it from —
  // and unlike server.ts, reachable from tests. A trailing slash would build //auth/complete; a
  // schemeless value ("mixtape-party.com") makes every redirect relative, since res.redirect passes
  // it through verbatim and the browser resolves it against /auth/google/, 404ing the callback and
  // pointing emailed links nowhere. Named value over `new URL`'s bare "Invalid URL".
  const appBaseUrl = deps.appBaseUrl.trim().replace(/\/$/, '');
  if (!/^https?:\/\/[^/]/i.test(appBaseUrl)) {
    throw new Error(`appBaseUrl must be absolute (http:// or https://), got "${deps.appBaseUrl}"`);
  }
  deps = { ...deps, appBaseUrl };
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(createAccountsRouter(deps));
  app.use(createAuthRouter(deps));
  app.use(createGoogleAuthRouter(deps));
  app.use(createAppleMusicAuthRouter(deps));
  app.use(createLeaguesRouter(deps));
  app.use(createSubmissionsRouter(deps));
  app.use(createGuessingRouter(deps));
  app.use(createResultsRouter(deps));
  app.use(createExportRouter(deps));
  app.use(createNotificationsRouter(deps));
  // Must be last and 4-arity for Express to treat it as error middleware. Express 5 routes
  // rejected handler promises here, so a rejection is a 500 rather than a dead process.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  });
  return app;
}
