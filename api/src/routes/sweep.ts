import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { Pool } from 'pg';
import { runNotificationSweep } from '../notifications/sweep.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { EmailChannel, PushChannel } from '../notifications/types.js';

export interface SweepDeps extends AdapterRegistry {
  youtubeMusicCookie?: string;
  pool: Pool;
  pushChannel: PushChannel;
  emailChannel: EmailChannel;
  /** Shared secret Cloud Scheduler sends as x-sweep-secret. Unset disables the endpoint (503), never allow-all. */
  sweepSecret?: string;
}

function secretMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createSweepRouter(deps: SweepDeps): Router {
  const router = Router();

  // ponytail: no advisory lock against a concurrent duplicate sweep (overlapping Scheduler calls or
  // multiple instances). Add a per-round/league advisory lock if duplicate notifications show up.
  router.post('/internal/sweep', async (req, res) => {
    if (!deps.sweepSecret) {
      res.status(503).json({ error: 'sweep not configured' });
      return;
    }
    if (!secretMatches(req.get('x-sweep-secret'), deps.sweepSecret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    await runNotificationSweep({
      pool: deps.pool,
      pushChannel: deps.pushChannel,
      emailChannel: deps.emailChannel,
      playlists: deps,
    });
    res.json({ ok: true });
  });

  return router;
}
