import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { Pool } from 'pg';
import { hashPassword, signSessionToken, verifyPassword, verifySessionToken } from '../auth.js';
import { isSessionTokenRevoked, revokeSessionToken } from '../authTokens.js';

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
    (req as unknown as AuthedRequest).accountId = accountId;
    next();
  };
}

export function createAccountsRouter(deps: AccountsDeps): Router {
  const router = Router();

  router.post('/accounts', async (req, res) => {
    const { email, password, displayName } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'email and a password of at least 8 characters are required' });
      return;
    }

    const passwordHash = hashPassword(password);
    try {
      const result = await deps.pool.query<{ id: string }>(
        'INSERT INTO accounts (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id',
        [email.toLowerCase(), passwordHash, displayName ?? null],
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
    const accountId = (req as unknown as AuthedRequest).accountId;
    const accountResult = await deps.pool.query<{ id: string; email: string; display_name: string | null }>(
      'SELECT id, email, display_name FROM accounts WHERE id = $1',
      [accountId],
    );
    const account = accountResult.rows[0];
    if (!account) {
      res.status(404).json({ error: 'account not found' });
      return;
    }
    const linksResult = await deps.pool.query<{ service: string; service_user_id: string; created_at: string }>(
      'SELECT service, service_user_id, created_at FROM service_links WHERE account_id = $1',
      [accountId],
    );
    res.json({
      id: account.id,
      email: account.email,
      displayName: account.display_name,
      services: linksResult.rows.map((row) => ({
        service: row.service,
        serviceUserId: row.service_user_id,
        linkedAt: row.created_at,
      })),
    });
  });

  return router;
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
}
