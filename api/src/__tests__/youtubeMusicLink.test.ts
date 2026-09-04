import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { FakeBandcampAdapter, FakeMusicServiceAdapter, SEARCH_UNAVAILABLE_QUERY } from '../adapters/fakeAdapter.js';
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
  });
  return { app, spotifyAdapter, youtubeMusicAdapter };
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

  it('a player can link Spotify, Apple Music, and YouTube Music all at once', async () => {
    const { app, spotifyAdapter, youtubeMusicAdapter } = buildApp();
    const { token } = await signUp(app);

    const authorize = await request(app)
      .get('/auth/spotify/authorize-url')
      .query({ redirectUri: 'mixtapeparty://spotify-callback' })
      .set('Authorization', `Bearer ${token}`);
    spotifyAdapter.validAuthCodes.set('spotify-code', { serviceUserId: 'spotify-user-1' });
    await request(app)
      .post('/auth/spotify/callback')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'spotify-code', state: authorize.body.state });

    youtubeMusicAdapter.validCookies.set('ytm-cookie', { serviceUserId: 'youtube-music-user-1' });
    await request(app)
      .post('/auth/youtube-music/callback')
      .set('Authorization', `Bearer ${token}`)
      .send({ cookie: 'ytm-cookie' });

    const me = await request(app).get('/accounts/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.services).toHaveLength(2);
    expect(me.body.services.map((s: { service: string }) => s.service).sort()).toEqual(['spotify', 'youtube_music']);
  });
});
