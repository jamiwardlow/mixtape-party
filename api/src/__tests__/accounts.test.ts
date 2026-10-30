import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startTestDb, type TestDb } from './testDb.js';
import { buildApp as sharedBuildApp } from './testHelpers.js';

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

// The shared helper is the single place AppDeps is assembled for tests.
const buildApp = () => sharedBuildApp(testDb.pool).app;

describe('POST /accounts', () => {
  it('creates an account and returns a session token', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/accounts')
      .send({ email: 'new@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.accountId).toBeTruthy();
    expect(res.body.token).toBeTruthy();
  });

  it('rejects a duplicate email', async () => {
    const app = buildApp();
    await request(app).post('/accounts').send({ email: 'dupe@example.com', password: 'password123' });
    const res = await request(app).post('/accounts').send({ email: 'dupe@example.com', password: 'password123' });

    expect(res.status).toBe(409);
  });

  // The sign-up form sends a name now (#81), and it goes through the same trim-and-cap as PATCH --
  // otherwise a name accepted here is one the owner can never edit, because PATCH 400s on it.
  it('stores a name given at sign-up trimmed and capped', async () => {
    const app = buildApp();
    const signup = await request(app)
      .post('/accounts')
      .send({ email: 'padded-signup@example.com', password: 'password123', displayName: `  ${'x'.repeat(45)}  ` });

    const me = await request(app).get('/accounts/me').set('Authorization', `Bearer ${signup.body.token}`);

    expect(signup.status).toBe(201);
    expect(me.body.displayName).toBe('x'.repeat(40));
    const patch = await request(app)
      .patch('/accounts/me')
      .set('Authorization', `Bearer ${signup.body.token}`)
      .send({ displayName: me.body.displayName });
    expect(patch.status).toBe(200);
  });

  it('rejects a short password', async () => {
    const app = buildApp();
    const res = await request(app).post('/accounts').send({ email: 'short@example.com', password: 'short' });

    expect(res.status).toBe(400);
  });
});

describe('POST /sessions', () => {
  it('logs in with correct credentials', async () => {
    const app = buildApp();
    await request(app).post('/accounts').send({ email: 'login@example.com', password: 'password123' });
    const res = await request(app).post('/sessions').send({ email: 'login@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects incorrect credentials', async () => {
    const app = buildApp();
    await request(app).post('/accounts').send({ email: 'login2@example.com', password: 'password123' });
    const res = await request(app).post('/sessions').send({ email: 'login2@example.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
  });
});

describe('GET /accounts/me', () => {
  it('rejects requests without a valid session token', async () => {
    const app = buildApp();
    const res = await request(app).get('/accounts/me').set('Authorization', 'Bearer garbage');

    expect(res.status).toBe(401);
  });
});

describe('PATCH /accounts/me', () => {
  const signUp = async (app: ReturnType<typeof buildApp>, email: string) =>
    (await request(app).post('/accounts').send({ email, password: 'password123' })).body.token as string;

  it('sets a display name that GET /accounts/me then returns', async () => {
    const app = buildApp();
    const token = await signUp(app, 'named@example.com');

    const patch = await request(app)
      .patch('/accounts/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Sam' });

    expect(patch.status).toBe(200);
    expect(patch.body.displayName).toBe('Sam');
    const me = await request(app).get('/accounts/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.displayName).toBe('Sam');
  });

  // Stored trimmed, not just validated trimmed -- a roster of names padded with stray spaces
  // reads ragged, and nothing downstream trims on the way out.
  it('stores a surrounding-whitespace name trimmed', async () => {
    const app = buildApp();
    const token = await signUp(app, 'padded@example.com');

    const res = await request(app)
      .patch('/accounts/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: '  Sam  ' });

    expect(res.body.displayName).toBe('Sam');
  });

  it('rejects a whitespace-only name', async () => {
    const app = buildApp();
    const token = await signUp(app, 'blank@example.com');

    const res = await request(app)
      .patch('/accounts/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: '   ' });

    expect(res.status).toBe(400);
  });

  it('rejects a name longer than 40 characters', async () => {
    const app = buildApp();
    const token = await signUp(app, 'long@example.com');

    const res = await request(app)
      .patch('/accounts/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'x'.repeat(41) });

    expect(res.status).toBe(400);
  });

  it('rejects requests without a session token', async () => {
    const app = buildApp();
    const res = await request(app).patch('/accounts/me').send({ displayName: 'Sam' });

    expect(res.status).toBe(401);
  });
});

describe('PATCH /accounts/me pronouns and About Me (#176)', () => {
  const patch = async (app: ReturnType<typeof buildApp>, token: string, body: object) =>
    request(app).patch('/accounts/me').set('Authorization', `Bearer ${token}`).send(body);
  const signUp = async (app: ReturnType<typeof buildApp>, email: string) =>
    (await request(app).post('/accounts').send({ email, password: 'password123' })).body.token as string;

  it('saves both fields without touching the name, and GET returns them', async () => {
    const app = buildApp();
    const token = await signUp(app, 'about@example.com');
    await patch(app, token, { displayName: 'Sam' });

    const res = await patch(app, token, { pronouns: ' she/her · JAH-mee ', aboutMe: 'Hi\nthere' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ displayName: 'Sam', pronouns: 'she/her · JAH-mee', aboutMe: 'Hi\nthere' });
    const me = await request(app).get('/accounts/me').set('Authorization', `Bearer ${token}`);
    expect(me.body).toMatchObject({ pronouns: 'she/her · JAH-mee', aboutMe: 'Hi\nthere' });
  });

  it('clears a field when blank', async () => {
    const app = buildApp();
    const token = await signUp(app, 'clear@example.com');
    await patch(app, token, { pronouns: 'they/them' });

    const res = await patch(app, token, { pronouns: '  ' });

    expect(res.body.pronouns).toBeNull();
  });

  it('rejects over-length input', async () => {
    const app = buildApp();
    const token = await signUp(app, 'over@example.com');

    expect((await patch(app, token, { pronouns: 'x'.repeat(41) })).status).toBe(400);
    expect((await patch(app, token, { aboutMe: 'x'.repeat(501) })).status).toBe(400);
    expect((await patch(app, token, { aboutMe: 'x'.repeat(500) })).status).toBe(200);
  });

  it('rejects non-text values and an empty body', async () => {
    const app = buildApp();
    const token = await signUp(app, 'junk@example.com');

    expect((await patch(app, token, { pronouns: 5 })).status).toBe(400);
    expect((await patch(app, token, {})).status).toBe(400);
  });
});
