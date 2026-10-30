import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildApp, signUp } from './testHelpers.js';
import { startTestDb, type TestDb } from './testDb.js';
import { createAppleIdentityVerifier, createAppleTokenExchange } from '../routes/appleAuth.js';

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

async function startFlow(app: Express, query = '') {
  const started = await request(app).get(`/auth/apple/start${query}`);
  const cookie = (started.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
  const state = new URL(started.headers.location).searchParams.get('state') as string;
  return { started, cookie, state };
}

const callback = (app: Express, form: Record<string, string>, cookie?: string) => {
  const req = request(app).post('/auth/apple/callback').type('form').send(form);
  return cookie ? req.set('Cookie', cookie) : req;
};

describe('Sign in with Apple', () => {
  it('redirects to Apple with form_post and a cross-site-capable state cookie', async () => {
    const { app } = buildApp(testDb.pool);
    const { started } = await startFlow(app);
    const url = new URL(started.headers.location);
    expect(url.host).toBe('appleid.apple.com');
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    expect(url.searchParams.get('scope')).toBe('name email');
    expect((started.headers['set-cookie'] as unknown as string[])[0]).toMatch(/SameSite=None.*Secure|Secure.*SameSite=None/i);
  });

  it('answers 503 when unconfigured', async () => {
    const { app } = buildApp(testDb.pool, { googleConfigured: false });
    expect((await request(app).get('/auth/apple/start')).status).toBe(503);
  });

  it('creates an account with the name from the first-login `user` field and hands off a token', async () => {
    const { app, appleTokenExchange } = buildApp(testDb.pool);
    appleTokenExchange.issue('c1', { sub: 'apple-1', email: 'New@Example.com' });
    const { cookie, state } = await startFlow(app);

    const res = await callback(app, { code: 'c1', state, user: JSON.stringify({ name: { firstName: 'Ada', lastName: 'Lovelace' } }) }, cookie);

    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^https:\/\/app\.test\/auth\/complete#t=/);
    const { rows } = await testDb.pool.query('SELECT email, display_name, apple_sub FROM accounts');
    expect(rows).toEqual([{ email: 'new@example.com', display_name: 'Ada Lovelace', apple_sub: 'apple-1' }]);
  });

  it('rejects a state whose nonce does not match the cookie', async () => {
    const { app, appleTokenExchange } = buildApp(testDb.pool);
    appleTokenExchange.issue('c1', { sub: 'apple-1', email: 'a@example.com' });
    const victim = await startFlow(app);
    const attacker = await startFlow(app);
    const res = await callback(app, { code: 'c1', state: attacker.state }, victim.cookie);
    expect(res.status).toBe(400);
    expect(await testDb.pool.query('SELECT 1 FROM accounts')).toHaveProperty('rowCount', 0);
  });

  it('refuses an unverified email', async () => {
    const { app, appleTokenExchange } = buildApp(testDb.pool);
    appleTokenExchange.issue('c1', { sub: 'apple-1', email: 'a@example.com', emailVerified: false });
    const { cookie, state } = await startFlow(app);
    expect((await callback(app, { code: 'c1', state }, cookie)).status).toBe(403);
  });

  it('links onto an existing password account but never onto one owned by another apple id', async () => {
    const { app, appleTokenExchange } = buildApp(testDb.pool);
    const existing = await signUp(app, 'a@example.com');
    appleTokenExchange.issue('c1', { sub: 'apple-1', email: 'a@example.com' });
    appleTokenExchange.issue('c2', { sub: 'apple-2', email: 'a@example.com' });

    let flow = await startFlow(app);
    expect((await callback(app, { code: 'c1', state: flow.state }, flow.cookie)).status).toBe(303);
    flow = await startFlow(app);
    expect((await callback(app, { code: 'c2', state: flow.state }, flow.cookie)).status).toBe(409);

    const { rows } = await testDb.pool.query('SELECT id, apple_sub FROM accounts');
    expect(rows).toEqual([{ id: existing.accountId, apple_sub: 'apple-1' }]);
  });

  it('bounces a native cancel back to the app', async () => {
    const { app } = buildApp(testDb.pool);
    const challenge = 'A'.repeat(43);
    const { cookie, state } = await startFlow(app, `?return=${encodeURIComponent('mixtapeparty://auth/complete')}&code_challenge=${challenge}`);
    const res = await callback(app, { state, error: 'user_cancelled_authorize' }, cookie);
    expect(res.headers.location).toBe('mixtapeparty://auth/complete#error=apple_cancelled');
  });
});

describe('createAppleTokenExchange', () => {
  it('signs an ES256 client secret Apple can verify and reads a string email_verified', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const idToken = `x.${Buffer.from(JSON.stringify({ sub: 's', email: 'a@b.co', email_verified: 'true' })).toString('base64url')}.y`;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id_token: idToken }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const exchange = createAppleTokenExchange({
        clientId: 'svc', teamId: 'T', keyId: 'K', redirectUri: 'https://r',
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
      });
      expect(await exchange('code')).toEqual({ sub: 's', email: 'a@b.co', emailVerified: true, name: null });

      const secret = (fetchMock.mock.calls[0][1].body as URLSearchParams).get('client_secret') as string;
      const [h, p, sig] = secret.split('.');
      expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toMatchObject({ iss: 'T', sub: 'svc', aud: 'https://appleid.apple.com' });
      expect(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('native Sign in with Apple', () => {
  it('signs in with the identity token, naming a new account from fullName, and reuses it by sub', async () => {
    const { app, appleTokenExchange } = buildApp(testDb.pool);
    appleTokenExchange.issue('tok', { sub: 'apple-1', email: 'n@example.com' });
    const first = await request(app).post('/auth/apple/native').send({ identityToken: 'tok', fullName: 'Ada Lovelace' });
    const second = await request(app).post('/auth/apple/native').send({ identityToken: 'tok', fullName: 'Other' });
    expect(first.body.token).toEqual(expect.any(String));
    expect(second.status).toBe(200);
    const { rows } = await testDb.pool.query('SELECT display_name, apple_sub FROM accounts');
    expect(rows).toEqual([{ display_name: 'Ada Lovelace', apple_sub: 'apple-1' }]);
  });

  it('rejects a token the verifier refuses', async () => {
    const { app } = buildApp(testDb.pool);
    expect((await request(app).post('/auth/apple/native').send({ identityToken: 'forged' })).status).toBe(401);
    expect((await request(app).post('/auth/apple/native').send({})).status).toBe(400);
  });
});

describe('createAppleIdentityVerifier', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
  const mint = (claims: object, key = privateKey, kid = 'k1') => {
    const b = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const input = `${b({ alg: 'RS256', kid })}.${b({ iss: 'https://appleid.apple.com', aud: 'com.app', exp: Math.floor(Date.now() / 1000) + 60, sub: 's', email: 'a@b.co', email_verified: 'true', ...claims })}`;
    return `${input}.${sign('sha256', Buffer.from(input), key).toString('base64url')}`;
  };
  const verifyToken = createAppleIdentityVerifier('com.app', async () => [jwk]);

  it('accepts a valid token', async () => {
    expect(await verifyToken(mint({}))).toEqual({ sub: 's', email: 'a@b.co', emailVerified: true, name: null });
  });

  it('rejects a forged signature, wrong audience, wrong issuer, and expiry', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(verifyToken(mint({}, other))).rejects.toThrow('bad signature');
    await expect(verifyToken(mint({ aud: 'svc.id' }))).rejects.toThrow('wrong aud');
    await expect(verifyToken(mint({ iss: 'https://evil.test' }))).rejects.toThrow('wrong iss');
    await expect(verifyToken(mint({ exp: 1 }))).rejects.toThrow('expired');
    await expect(verifyToken(mint({}, privateKey, 'unknown'))).rejects.toThrow('no apple key');
  });
});
