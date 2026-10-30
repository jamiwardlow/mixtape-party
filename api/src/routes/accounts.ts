import express, { Router, type ErrorRequestHandler, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { Pool } from 'pg';
import { hashPassword, signSessionToken, verifyPassword, verifySessionToken } from '../auth.js';
import { isSessionTokenRevoked, revokeSessionToken } from '../authTokens.js';
import { isUuid } from './blocks.js';

export interface AccountsDeps {
  pool: Pool;
  sessionSecret: string;
}

export interface AuthedRequest extends Request {
  accountId: string;
}

export function bearerToken(req: Request): string | null {
  const header = req.header('authorization');
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

// Params typed as plain strings, not Express 5's default `string | string[]` (which exists only for
// wildcard routes, of which this app has none). Left at the default, this guard would widen
// req.params to `string | string[]` on every route it protects.
export function requireAuth(deps: Pick<AccountsDeps, 'sessionSecret' | 'pool'>): RequestHandler<Record<string, string>> {
  return async (req: Request, res: Response, next: NextFunction) => {
    const unauthorized = () => void res.status(401).json({ error: 'unauthorized' });
    const token = bearerToken(req);
    if (!token) return unauthorized();
    // A valid signature is no longer enough: signing out revokes a token that still verifies, so
    // requireAuth also checks the revocation list -- it is the one chokepoint every authenticated
    // route already passes through, which is what makes one check here cover all of them (#64).
    const accountId = verifySessionToken(token, deps.sessionSecret);
    if (!accountId || (await isSessionTokenRevoked(deps.pool, token))) return unauthorized();
    // A deleted account's tokens still verify (they are stateless), so check the account itself.
    // An unknown id passes through to the route, which already answers 404 for it.
    const gone = await deps.pool.query('SELECT 1 FROM accounts WHERE id = $1 AND deleted_at IS NOT NULL', [accountId]);
    if (gone.rows.length > 0) return unauthorized();
    (req as unknown as AuthedRequest).accountId = accountId;
    next();
  };
}

// One rule, both doors. PATCH rejects a name outside it; sign-up silently trims and truncates to
// it instead, because #81 must not add a new way for creating an account to fail over a field
// nobody is required to fill in -- and a name accepted at sign-up that PATCH then refuses would
// leave the owner unable to edit their own name.
const MAX_DISPLAY_NAME = 40;

// ponytail: avatars live in Postgres bytea (client resizes to ~256px, so rows stay small). Move to
// a bucket if avatars grow or get fetched in bulk, e.g. a roster of hundreds.
const MAX_AVATAR_BYTES = 200 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png'];

// 415 before the body is read, 413 when it exceeds the limit (body-parser's error would otherwise
// fall through to the app's 500 handler).
const avatarType: RequestHandler = (req, res, next) => {
  if (AVATAR_TYPES.includes(req.header('content-type')?.split(';')[0].trim().toLowerCase() ?? '')) return next();
    res.status(415).json({ error: 'avatar must be image/jpeg or image/png' });
};
const avatarTooLarge: ErrorRequestHandler = (err, _req, res, next) => {
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'avatar must be at most 200kb' });
    return;
  }
  next(err);
};
const avatarRaw = express.raw({ type: () => true, limit: MAX_AVATAR_BYTES });

export function createAccountsRouter(deps: AccountsDeps): Router {
  const router = Router();

  router.post('/accounts', async (req, res) => {
    const { email, password, displayName } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'email and a password of at least 8 characters are required' });
      return;
    }

    const passwordHash = hashPassword(password);
    const name = typeof displayName === 'string' ? displayName.trim().slice(0, MAX_DISPLAY_NAME) || null : null;
    try {
      const result = await deps.pool.query<{ id: string }>(
        'INSERT INTO accounts (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id',
        [email.toLowerCase(), passwordHash, name],
      );
      const accountId = result.rows[0].id;
      const token = signSessionToken(accountId, deps.sessionSecret);
      res.status(201).json({ accountId, token });
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: 'email already registered' });
        return;
      }
      throw err;
    }
  });

  router.post('/sessions', async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }
    const result = await deps.pool.query<{ id: string; password_hash: string | null }>(
      'SELECT id, password_hash FROM accounts WHERE email = $1',
      [email.toLowerCase()],
    );
    const account = result.rows[0];
    if (!account?.password_hash || !verifyPassword(password, account.password_hash)) {
      res.status(401).json({ error: 'invalid email or password' });
      return;
    }
    const token = signSessionToken(account.id, deps.sessionSecret);
    res.json({ accountId: account.id, token });
  });

  // Sign-out. Behind requireAuth like every other authenticated route, so signing out with an
  // already-revoked token is a 401 -- harmless, since the client discards the token regardless.
  router.delete('/sessions', requireAuth(deps), async (req, res) => {
    await revokeSessionToken(deps.pool, bearerToken(req)!);
    res.status(204).end();
  });

  router.get('/accounts/me', requireAuth(deps), async (req, res) => {
    await sendProfile(deps.pool, (req as unknown as AuthedRequest).accountId, res);
  });

  // The only way an account that signed up without a name -- password and magic-link accounts, i.e.
  // nearly all of them -- ever gets one. Responds with the /accounts/me body so the client reuses
  // one parser. No uniqueness check: two friends in a league can both be "Sam" (#81).
  router.patch('/accounts/me', requireAuth(deps), async (req, res) => {
    const { displayName } = (req.body ?? {}) as Record<string, unknown>;
    // Trimmed before the length check *and* before storing -- " Sam " kept verbatim makes a roster
    // of otherwise aligned names read ragged.
    const name = typeof displayName === 'string' ? displayName.trim() : '';
    if (name.length === 0 || name.length > MAX_DISPLAY_NAME) {
      res.status(400).json({ error: `displayName must be 1-${MAX_DISPLAY_NAME} characters` });
      return;
    }
    const accountId = (req as unknown as AuthedRequest).accountId;
    await deps.pool.query('UPDATE accounts SET display_name = $2 WHERE id = $1', [accountId, name]);
    await sendProfile(deps.pool, accountId, res);
  });

  // Deletion scrubs the account row in place rather than dropping it: every table references it
  // ON DELETE CASCADE, so a real DELETE would erase the leaver's submissions and guesses and rewrite
  // other players' scores. What stays, unlinked from any person: their submitted tracks, guesses,
  // comments, replies and reactions, and their league membership (shown as "A player"). What goes:
  // email, password, Google link, name, avatar, push tokens, notification settings and inbox,
  // favorites and exports, and any pending sign-in/reset tokens. Every session dies via deleted_at.
  router.delete('/accounts/me', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const { password, confirmEmail } = (req.body ?? {}) as Record<string, unknown>;
    const { rows } = await deps.pool.query<{ email: string; password_hash: string | null }>(
      'SELECT email, password_hash FROM accounts WHERE id = $1',
      [accountId],
    );
    const account = rows[0];
    if (!account) {
      res.status(404).json({ error: 'account not found' });
      return;
    }
    // Re-prove it's them: the password, or for accounts without one (magic link, Google) their email.
    const proof = account.password_hash ? password : confirmEmail;
    if (typeof proof !== 'string' || !proof) {
      res.status(400).json({ error: account.password_hash ? 'password is required' : 'confirmEmail is required' });
      return;
    }
    const proven = account.password_hash
      ? verifyPassword(proof, account.password_hash)
      : proof.trim().toLowerCase() === account.email;
    if (!proven) {
      res.status(403).json({ error: account.password_hash ? 'incorrect password' : 'that is not your email address' });
      return;
    }

    const client = await deps.pool.connect();
    try {
      await client.query('BEGIN');
      // Hosting someone else's season to its end isn't something to abandon mid-game. A season is
      // over once its last round's guessing deadline has passed (same rule as isSeasonConcluded).
      const hosting = await client.query(
        `SELECT 1 FROM leagues l
          WHERE l.host_account_id = $1
            AND EXISTS (SELECT 1 FROM league_members m WHERE m.league_id = l.id AND m.account_id <> $1)
            AND NOT EXISTS (SELECT 1 FROM rounds r WHERE r.league_id = l.id AND r.round_number >= l.season_length AND r.guessing_deadline <= now())
          LIMIT 1`,
        [accountId],
      );
      if (hosting.rows.length > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: "You're hosting a league that's still playing. Wait until its season ends, then delete your account." });
        return;
      }
      for (const table of ['push_tokens', 'notification_settings', 'notifications', 'favorites', 'favorite_exports', 'auth_tokens']) {
        await client.query(`DELETE FROM ${table} WHERE account_id = $1`, [accountId]);
      }
      await client.query(
        `UPDATE accounts SET email = 'deleted-' || id || '@deleted.invalid', password_hash = NULL, google_sub = NULL, apple_sub = NULL,
                display_name = NULL, avatar = NULL, avatar_content_type = NULL, avatar_updated_at = NULL, deleted_at = now()
          WHERE id = $1`,
        [accountId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.status(204).end();
  });

  router.put('/accounts/me/avatar', requireAuth(deps), avatarType, avatarRaw, async (req: Request, res: Response) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'avatar body is required' });
      return;
    }
    const accountId = (req as unknown as AuthedRequest).accountId;
    const contentType = req.header('content-type')!.split(';')[0].trim().toLowerCase();
    await deps.pool.query(
      'UPDATE accounts SET avatar = $2, avatar_content_type = $3, avatar_updated_at = now() WHERE id = $1',
      [accountId, req.body, contentType],
    );
    await sendProfile(deps.pool, accountId, res);
  }, avatarTooLarge);

  router.delete('/accounts/me/avatar', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    await deps.pool.query(
      'UPDATE accounts SET avatar = NULL, avatar_content_type = NULL, avatar_updated_at = NULL WHERE id = $1',
      [accountId],
    );
    res.status(204).end();
  });

  router.get('/accounts/:id/avatar', requireAuth(deps), async (req, res) => {
    const result = isUuid(req.params.id)
      ? await deps.pool.query<{ avatar: Buffer | null; avatar_content_type: string | null }>(
          'SELECT avatar, avatar_content_type FROM accounts WHERE id = $1',
          [req.params.id],
        )
      : undefined;
    const row = result?.rows[0];
    if (!row?.avatar) {
      res.status(404).json({ error: 'no avatar' });
      return;
    }
    // private: the response is per-authenticated-viewer, so shared caches must not keep it. The
    // avatarUrl's ?v= changes on every upload, which is what makes a long max-age safe.
    res.set('Cache-Control', 'private, max-age=86400').type(row.avatar_content_type!).send(row.avatar);
  });

  return router;
}

export const avatarUrlOf = (id: string, updatedAt: Date | null) =>
  updatedAt ? `/accounts/${id}/avatar?v=${updatedAt.getTime()}` : null;

async function sendProfile(pool: Pool, accountId: string, res: Response): Promise<void> {
  const accountResult = await pool.query<{
    id: string;
    email: string;
    display_name: string | null;
    avatar_updated_at: Date | null;
  }>(
    'SELECT id, email, display_name, avatar_updated_at FROM accounts WHERE id = $1',
    [accountId],
  );
  const account = accountResult.rows[0];
  if (!account) {
    res.status(404).json({ error: 'account not found' });
    return;
  }
  res.json({
    id: account.id,
    email: account.email,
    displayName: account.display_name,
    avatarUrl: avatarUrlOf(account.id, account.avatar_updated_at),
  });
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
}
