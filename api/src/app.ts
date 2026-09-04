import cors from 'cors';
import express, { type Express } from 'express';
import type { Pool } from 'pg';
import type { MusicServiceAdapter, OAuthLinkableAdapter } from './adapters/types.js';
import { createAccountsRouter } from './routes/accounts.js';
import { createGuessingRouter } from './routes/guessing.js';
import { createLeaguesRouter } from './routes/leagues.js';
import { createSpotifyAuthRouter } from './routes/spotifyAuth.js';
import { createSubmissionsRouter } from './routes/submissions.js';

export interface AppDeps {
  pool: Pool;
  sessionSecret: string;
  spotifyAdapter: MusicServiceAdapter & OAuthLinkableAdapter;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(createAccountsRouter(deps));
  app.use(createSpotifyAuthRouter(deps));
  app.use(createLeaguesRouter(deps));
  app.use(createSubmissionsRouter(deps));
  app.use(createGuessingRouter(deps));
  return app;
}
