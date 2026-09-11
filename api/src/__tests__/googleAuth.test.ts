import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildApp, signUp } from './testHelpers.js';
import { startTestDb, type TestDb } from './testDb.js';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, 60_000);

afterEach(async () => {
  await testDb.reset();
});

afterAll(async () => {
  await testDb.teardown();
});

/** Runs `/start` and hands back the two halves of the CSRF binding the callback expects. */
async function startFlow(app: Express) {
  const started = await request(app).get('/auth/google/start');
  const setCookie = started.headers['set-cookie'] as unknown as string[];
  const cookie = setCookie[0].split(';')[0];
  const state = new URL(started.headers.location).searchParams.get('state') as string;
  return { started, cookie, state };
}

function callback(app: Express, { code, state, cookie }: { code?: string; state: string; cookie?: string }) {
  const query = new URLSearchParams({ state, ...(code ? { code } : {}) });
  const req = request(app).get(`/auth/google/callback?${query}`);
  return cookie ? req.set('Cookie', cookie) : req;
}

const countAccounts = async () => (await testDb.pool.query('SELECT id FROM accounts')).rowCount;

describe('GET /auth/google/start', () => {
  it('sets the state cookie and redirects to Google with the configured client and scopes', async () => {
    const { app } = buildApp(testDb.pool);

    const { started, cookie } = await startFlow(app);

    expect(started.status).toBe(302);
    expect(cookie.startsWith('g_state=')).toBe(true);
    const setCookie = (started.headers['set-cookie'] as unknown as string[])[0];
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const url = new URL(started.headers.location);
    expect(url.host).toBe('accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('test-google-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.test/auth/google/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('returns a clear error rather than a malformed Google URL when unconfigured', async () => {
    const { app } = buildApp(testDb.pool, { googleConfigured: false });

    const res = await request(app).get('/auth/google/start');

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/);
  });
});

describe('GET /auth/google/callback', () => {
  it('rejects a state whose nonce does not match the cookie', async () => {
    const { app, googleTokenExchange } = buildApp(testDb.pool);
    googleTokenExchange.issue('code-1', { sub: 'google-1', email: 'a@example.com' });
    const victim = await startFlow(app);
    const attacker = await startFlow(app);

    // The attacker's signed state replayed into the victim's browser: signature valid, nonce wrong.
    const res = await callback(app, { code: 'code-1', state: attacker.state, cookie: victim.cookie });

    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(await countAccounts()).toBe(0);
  });

  it('rejects a callback with no state cookie at all', async () => {
    const { app, googleTokenExchange } = buildApp(testDb.pool);
    googleTokenExchange.issue('code-1', { sub: 'google-1', email: 'a@example.com' });
    const { state } = await startFlow(app);

    const res = await callback(app, { code: 'code-1', state });

    expect(res.status).toBe(400);
    expect(await countAccounts()).toBe(0);
  });

  it('rejects an unverified Google email and creates no account', async () => {
    const { app, googleTokenExchange } = buildApp(testDb.pool);
    googleTokenExchange.issue('code-1', { sub: 'google-1', email: 'victim@example.com', emailVerified: false });
    const { cookie, state } = await startFlow(app);

    const res = await callback(app, { code: 'code-1', state, cookie });

    expect(res.status).toBe(403);
    expect(await countAccounts()).toBe(0);
  });

  it('creates an account with the display name from the Google profile', async () => {
    const { app, googleTokenExchange } = buildApp(testDb.pool);
    googleTokenExchange.issue('code-1', { sub: 'google-1', email: 'New@Example.com', name: 'Ada Lovelace' });
    const { cookie, state } = await startFlow(app);

    const res = await callback(app, { code: 'code-1', state, cookie });

    expect(res.status).toBe(302);
    const { rows } = await testDb.pool.query('SELECT email, display_name, google_sub, password_hash FROM accounts');
    expect(rows).toEqual([
      { email: 'new@example.com', display_name: 'Ada Lovelace', google_sub: 'google-1', password_hash: null },
    ]);
  });

  it('reuses the account for a known sub and leaves the stored email untouched when Google reports a new one', async () => {
    const { app, googleTokenExchange } = buildApp(testDb.pool);
    googleTokenExchange.issue('code-1', { sub: 'google-1', email: 'old@example.com' });
    const first = await startFlow(app);
    await callback(app, { code: 'code-1', state: first.state, cookie: first.cookie });

    googleTokenExchange.issue('code-2', { sub: 'google-1', email: 'renamed@example.com' });
    const second = await startFlow(app);
    const res = await callback(app, { code: 'code-2', state: second.state, cookie: second.cookie });

    expect(res.status).toBe(302);
    const { rows } = await testDb.pool.query('SELECT email FROM accounts');
    expect(rows).toEqual([{ email: 'old@example.com' }]);
  });

  it('links a verified email onto an existing password account without breaking the password', async () => {
    const { app, googleTokenExchange } = buildApp(testDb.pool);
    const existing = await signUp(app, 'both@example.com');
    googleTokenExchange.issue('code-1', { sub: 'google-1', email: 'both@example.com', name: 'Grace' });
    const { cookie, state } = await startFlow(app);

    const res = await callback(app, { code: 'code-1', state, cookie });

    expect(res.status).toBe(302);
    const { rows } = await testDb.pool.query('SELECT id, google_sub FROM accounts');
    expect(rows).toEqual([{ id: existing.accountId, google_sub: 'google-1' }]);

    const signedIn = await request(app).post('/sessions').send({ email: 'both@example.com', password: 'password123' });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.accountId).toBe(existing.accountId);
  });

  it('refuses to sign a second Google identity into an account already linked to another', async () => {
    const { app, googleTokenExchange } = buildApp(testDb.pool);
    const victim = await signUp(app, 'taken@example.com');
    await testDb.pool.query('UPDATE accounts SET google_sub = $1 WHERE id = $2', ['google-1', victim.accountId]);
    googleTokenExchange.issue('code-2', { sub: 'google-2', email: 'taken@example.com' });
    const { cookie, state } = await startFlow(app);

    const res = await callback(app, { code: 'code-2', state, cookie });

    expect(res.status).toBe(409);
    const { rows } = await testDb.pool.query('SELECT id, google_sub FROM accounts');
    expect(rows).toEqual([{ id: victim.accountId, google_sub: 'google-1' }]);
    expect((await testDb.pool.query('SELECT token_hash FROM auth_tokens')).rowCount).toBe(0);
  });

  it('redirects to the sign-in screen when the user cancels consent', async () => {
    const { app } = buildApp(testDb.pool);
    const { cookie } = await startFlow(app);

    const res = await request(app).get('/auth/google/callback?error=access_denied').set('Cookie', cookie);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://app.test/sign-in?error=google_cancelled');
    expect(await countAccounts()).toBe(0);
  });

  it('hands off a sign_in token the client can exchange for a working session', async () => {
    const { app, googleTokenExchange } = buildApp(testDb.pool);
    googleTokenExchange.issue('code-1', { sub: 'google-1', email: 'handoff@example.com', name: 'Alan' });
    const { cookie, state } = await startFlow(app);

    const res = await callback(app, { code: 'code-1', state, cookie });

    expect(res.status).toBe(302);
    const match = /^https:\/\/app\.test\/auth\/complete#t=([A-Za-z0-9_-]+)$/.exec(res.headers.location);
    expect(match).not.toBeNull();

    const exchanged = await request(app).post('/sessions/token').send({ token: (match as RegExpExecArray)[1] });
    expect(exchanged.status).toBe(200);

    const me = await request(app).get('/accounts/me').set('Authorization', `Bearer ${exchanged.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('handoff@example.com');
    expect(me.body.displayName).toBe('Alan');
  });
});
