import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { FakeBandcampAdapter, FakeMusicServiceAdapter } from '../adapters/fakeAdapter.js';
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
    appBaseUrl: 'https://app.test',
    appleMusicAdapter,
    youtubeMusicAdapter,
    bandcampAdapter: new FakeBandcampAdapter(),
    pushChannel: new FakePushChannel(),
    emailChannel: new FakeEmailChannel(),
  });
  return { app, appleMusicAdapter };
}

async function signUp(app: import('express').Express) {
  const res = await request(app).post('/accounts').send({ email: 'amlinker@example.com', password: 'password123' });
  return { accountId: res.body.accountId as string, token: res.body.token as string };
}

describe('Apple Music account linking', () => {
  it('a user can link an Apple Music account via a Music User Token', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { token } = await signUp(app);

    appleMusicAdapter.validMusicUserTokens.set('valid-mut', { serviceUserId: 'apple-music-user-1' });

    const callback = await request(app)
      .post('/auth/apple-music/callback')
      .set('Authorization', `Bearer ${token}`)
      .send({ musicUserToken: 'valid-mut' });

    expect(callback.status).toBe(201);
    expect(callback.body).toMatchObject({ linked: true, service: 'apple_music', serviceUserId: 'apple-music-user-1' });

    const me = await request(app).get('/accounts/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.services).toEqual([
      expect.objectContaining({ service: 'apple_music', serviceUserId: 'apple-music-user-1' }),
    ]);
  });

  it('rejects a callback with an invalid Music User Token', async () => {
    const { app } = buildApp();
    const { token } = await signUp(app);

    const res = await request(app)
      .post('/auth/apple-music/callback')
      .set('Authorization', `Bearer ${token}`)
      .send({ musicUserToken: 'never-issued' });

    expect(res.status).toBe(400);
  });
});
