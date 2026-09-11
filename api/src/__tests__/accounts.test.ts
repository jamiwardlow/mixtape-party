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
  it('reports an empty services list for a new account with zero linked services', async () => {
    const app = buildApp();
    const signup = await request(app).post('/accounts').send({ email: 'fresh@example.com', password: 'password123' });

    const res = await request(app).get('/accounts/me').set('Authorization', `Bearer ${signup.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body.services).toEqual([]);
  });

  it('rejects requests without a valid session token', async () => {
    const app = buildApp();
    const res = await request(app).get('/accounts/me').set('Authorization', 'Bearer garbage');

    expect(res.status).toBe(401);
  });
});
