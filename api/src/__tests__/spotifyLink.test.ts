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
  const spotifyAdapter = new FakeMusicServiceAdapter('spotify');
  const appleMusicAdapter = new FakeMusicServiceAdapter('apple_music');
  const youtubeMusicAdapter = new FakeMusicServiceAdapter('youtube_music');
  const app = createApp({
    pool: testDb.pool,
    sessionSecret: 'test-secret',
    spotifyAdapter,
    appleMusicAdapter,
    youtubeMusicAdapter,
    bandcampAdapter: new FakeBandcampAdapter(),
    pushChannel: new FakePushChannel(),
    emailChannel: new FakeEmailChannel(),
  });
  return { app, spotifyAdapter };
}

async function signUp(app: import('express').Express) {
  const res = await request(app).post('/accounts').send({ email: 'linker@example.com', password: 'password123' });
  return { accountId: res.body.accountId as string, token: res.body.token as string };
}

describe('Spotify account linking', () => {
  it('a new user can sign up and link a Spotify account via OAuth', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { token } = await signUp(app);

    const authorize = await request(app)
      .get('/auth/spotify/authorize-url')
      .query({ redirectUri: 'mixtapeparty://spotify-callback' })
      .set('Authorization', `Bearer ${token}`);
    expect(authorize.status).toBe(200);
    expect(authorize.body.url).toContain('authorize');

    spotifyAdapter.validAuthCodes.set('valid-code', { serviceUserId: 'spotify-user-1', email: 'linker@spotify.com' });

    const callback = await request(app)
      .post('/auth/spotify/callback')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'valid-code', state: authorize.body.state });

    expect(callback.status).toBe(201);
    expect(callback.body).toMatchObject({ linked: true, service: 'spotify', serviceUserId: 'spotify-user-1' });

    const me = await request(app).get('/accounts/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.onboarded).toBe(true);
    expect(me.body.services).toEqual([
      expect.objectContaining({ service: 'spotify', serviceUserId: 'spotify-user-1' }),
    ]);
  });

  it('rejects a callback with a tampered state', async () => {
    const { app } = buildApp();
    const { token } = await signUp(app);

    const res = await request(app)
      .post('/auth/spotify/callback')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'valid-code', state: 'tampered.state' });

    expect(res.status).toBe(400);
  });

  it('rejects a callback with an invalid authorization code', async () => {
    const { app } = buildApp();
    const { token } = await signUp(app);

    const authorize = await request(app)
      .get('/auth/spotify/authorize-url')
      .query({ redirectUri: 'mixtapeparty://spotify-callback' })
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post('/auth/spotify/callback')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'never-issued-code', state: authorize.body.state });

    expect(res.status).toBe(400);
  });

  it('re-linking the same service updates rather than duplicates the row', async () => {
    const { app, spotifyAdapter } = buildApp();
    const { token } = await signUp(app);
    spotifyAdapter.validAuthCodes.set('code-a', { serviceUserId: 'spotify-user-a' });
    spotifyAdapter.validAuthCodes.set('code-b', { serviceUserId: 'spotify-user-b' });

    const authorize1 = await request(app)
      .get('/auth/spotify/authorize-url')
      .query({ redirectUri: 'mixtapeparty://spotify-callback' })
      .set('Authorization', `Bearer ${token}`);
    await request(app)
      .post('/auth/spotify/callback')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'code-a', state: authorize1.body.state });

    const authorize2 = await request(app)
      .get('/auth/spotify/authorize-url')
      .query({ redirectUri: 'mixtapeparty://spotify-callback' })
      .set('Authorization', `Bearer ${token}`);
    await request(app)
      .post('/auth/spotify/callback')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'code-b', state: authorize2.body.state });

    const me = await request(app).get('/accounts/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.services).toHaveLength(1);
    expect(me.body.services[0].serviceUserId).toBe('spotify-user-b');
  });
});
