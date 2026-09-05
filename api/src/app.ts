import cors from 'cors';
import express, { type Express } from 'express';
import type { Pool } from 'pg';
import type {
  AppleMusicLinkableAdapter,
  EmbedOnlyMusicServiceAdapter,
  MusicServiceAdapter,
  OAuthLinkableAdapter,
  YouTubeMusicLinkableAdapter,
} from './adapters/types.js';
import { createAccountsRouter } from './routes/accounts.js';
import { createAppleMusicAuthRouter } from './routes/appleMusicAuth.js';
import { createExportRouter } from './routes/export.js';
import { createGuessingRouter } from './routes/guessing.js';
import { createLeaguesRouter } from './routes/leagues.js';
import { createNotificationsRouter } from './routes/notifications.js';
import { createResultsRouter } from './routes/results.js';
import { createSpotifyAuthRouter } from './routes/spotifyAuth.js';
import { createSubmissionsRouter } from './routes/submissions.js';
import { createYouTubeMusicAuthRouter } from './routes/youtubeMusicAuth.js';
import type { EmailChannel, PushChannel } from './notifications/types.js';

export interface AppDeps {
  pool: Pool;
  sessionSecret: string;
  spotifyAdapter: MusicServiceAdapter & OAuthLinkableAdapter;
  appleMusicAdapter: MusicServiceAdapter & AppleMusicLinkableAdapter;
  youtubeMusicAdapter: MusicServiceAdapter & YouTubeMusicLinkableAdapter;
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
  app.use(createSpotifyAuthRouter(deps));
  app.use(createAppleMusicAuthRouter(deps));
  app.use(createYouTubeMusicAuthRouter(deps));
  app.use(createLeaguesRouter(deps));
  app.use(createSubmissionsRouter(deps));
  app.use(createGuessingRouter(deps));
  app.use(createResultsRouter(deps));
  app.use(createExportRouter(deps));
  app.use(createNotificationsRouter(deps));
  return app;
}
