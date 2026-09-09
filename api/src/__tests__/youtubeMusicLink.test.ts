import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { FakeBandcampAdapter, FakeMusicServiceAdapter, SEARCH_UNAVAILABLE_QUERY } from '../adapters/fakeAdapter.js';
import { FakeEmailChannel, FakePushChannel } from '../notifications/fakeChannels.js';
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

function buildApp() {
  const appleMusicAdapter = new FakeMusicServiceAdapter('apple_music');
  const youtubeMusicAdapter = new FakeMusicServiceAdapter('youtube_music');
  const app = createApp({
    pool: testDb.pool,
    sessionSecret: 'test-secret',
    appleMusicAdapter,
    youtubeMusicAdapter,
    bandcampAdapter: new FakeBandcampAdapter(),
    pushChannel: new FakePushChannel(),
    emailChannel: new FakeEmailChannel(),
  });
  return { app, youtubeMusicAdapter };
}

async function signUp(app: import('express').Express) {
  const res = await request(app).post('/accounts').send({ email: 'ytmlinker@example.com', password: 'password123' });
  return { accountId: res.body.accountId as string, token: res.body.token as string };
}

describe('YouTube Music account linking', () => {
  it('a user can link a YouTube Music account via a session cookie', async () => {
    const { app, youtubeMusicAdapter } = buildApp();
    const { token } = await signUp(app);

    youtubeMusicAdapter.validCookies.set('valid-cookie', { serviceUserId: 'youtube-music-user-1' });

    const callback = await request(app)
      .post('/auth/youtube-music/callback')
      .set('Authorization', `Bearer ${token}`)
      .send({ cookie: 'valid-cookie' });

    expect(callback.status).toBe(201);
    expect(callback.body).toMatchObject({
      linked: true,
      service: 'youtube_music',
      serviceUserId: 'youtube-music-user-1',
    });

    const me = await request(app).get('/accounts/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.onboarded).toBe(true);
    expect(me.body.services).toEqual([
      expect.objectContaining({ service: 'youtube_music', serviceUserId: 'youtube-music-user-1' }),
    ]);
  });

  it('rejects a callback with an invalid cookie', async () => {
    const { app } = buildApp();
    const { token } = await signUp(app);

    const res = await request(app)
      .post('/auth/youtube-music/callback')
      .set('Authorization', `Bearer ${token}`)
      .send({ cookie: 'never-issued' });

    expect(res.status).toBe(400);
  });

  it('surfaces a search-unavailable error instead of a bad-cookie error when YouTube Music is unreachable', async () => {
    const { app } = buildApp();
    const { token } = await signUp(app);

    const res = await request(app)
      .post('/auth/youtube-music/callback')
      .set('Authorization', `Bearer ${token}`)
      .send({ cookie: SEARCH_UNAVAILABLE_QUERY });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('search unavailable');
  });
});
