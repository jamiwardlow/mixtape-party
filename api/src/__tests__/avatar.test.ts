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

const png = Buffer.from('89504e470d0a1a0a', 'hex');

async function signUp(app: ReturnType<typeof sharedBuildApp>['app'], email = 'a@example.com') {
  const res = await request(app).post('/accounts').send({ email, password: 'password123' });
  return { id: res.body.accountId as string, auth: `Bearer ${res.body.token}` };
}

describe('account avatar', () => {
  it('uploads, serves and deletes an avatar, reflected in the profile', async () => {
    const { app } = sharedBuildApp(testDb.pool);
    const me = await signUp(app);
    const other = await signUp(app, 'b@example.com');

    expect((await request(app).get('/accounts/me').set('Authorization', me.auth)).body.avatarUrl).toBeNull();

    const put = await request(app).put('/accounts/me/avatar').set('Authorization', me.auth).set('Content-Type', 'image/png').send(png);
    expect(put.status).toBe(200);
    expect(put.body.avatarUrl).toMatch(new RegExp(`^/accounts/${me.id}/avatar\\?v=\\d+$`));

    // Another signed-in account can fetch it; that's what a roster needs.
    const get = await request(app).get(`/accounts/${me.id}/avatar`).set('Authorization', other.auth);
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    expect(get.headers['cache-control']).toContain('max-age');
    expect(Buffer.compare(get.body, png)).toBe(0);

    expect((await request(app).delete('/accounts/me/avatar').set('Authorization', me.auth)).status).toBe(204);
    expect((await request(app).get(`/accounts/${me.id}/avatar`).set('Authorization', me.auth)).status).toBe(404);
    expect((await request(app).get('/accounts/me').set('Authorization', me.auth)).body.avatarUrl).toBeNull();
  });

  it('rejects an oversize body (413) and a wrong type (415)', async () => {
    const { app } = sharedBuildApp(testDb.pool);
    const me = await signUp(app);
    const put = (type: string, body: Buffer) =>
      request(app).put('/accounts/me/avatar').set('Authorization', me.auth).set('Content-Type', type).send(body);

    expect((await put('image/png', Buffer.alloc(201 * 1024))).status).toBe(413);
    expect((await put('image/gif', png)).status).toBe(415);
  });

  it('requires auth, and 404s an unknown or malformed id', async () => {
    const { app } = sharedBuildApp(testDb.pool);
    const me = await signUp(app);

    expect((await request(app).put('/accounts/me/avatar').set('Content-Type', 'image/png').send(png)).status).toBe(401);
    expect((await request(app).delete('/accounts/me/avatar')).status).toBe(401);
    expect((await request(app).get(`/accounts/${me.id}/avatar`)).status).toBe(401);
    expect((await request(app).get('/accounts/not-a-uuid/avatar').set('Authorization', me.auth)).status).toBe(404);
  });
});
