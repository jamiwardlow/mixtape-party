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
  appleMusicAdapter: MusicServiceAdapter & AppleMusicLinkableAdapter;
  youtubeMusicAdapter: MusicServiceAdapter;
  // App-owned music.youtube.com session cookie shared by all users' exports — see youtubeMusicAdapter.ts.
  youtubeMusicCookie?: string;
  bandcampAdapter: EmbedOnlyMusicServiceAdapter;
  pushChannel: PushChannel;
  emailChannel: EmailChannel;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(createAccountsRouter(deps));
  app.use(createAuthRouter(deps));
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
