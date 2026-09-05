import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startTestDb, type TestDb } from './testDb.js';
import { buildApp as buildTestApp, signUp } from './testHelpers.js';

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
  return buildTestApp(testDb.pool);
}

describe('notification settings', () => {
  it('defaults both channels to enabled', async () => {
    const { app } = buildApp();
    const { token } = await signUp(app, 'settings@example.com');

    const res = await request(app).get('/notifications/settings').set('Authorization', `Bearer ${token}`);
    expect(res.body).toEqual({ pushEnabled: true, emailEnabled: true });
  });

  it('persists a toggle', async () => {
    const { app } = buildApp();
    const { token } = await signUp(app, 'settings2@example.com');

    await request(app)
      .put('/notifications/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ pushEnabled: false, emailEnabled: true });
    const res = await request(app).get('/notifications/settings').set('Authorization', `Bearer ${token}`);
    expect(res.body).toEqual({ pushEnabled: false, emailEnabled: true });
  });

  it('updates one channel without resetting the other', async () => {
    const { app } = buildApp();
    const { token } = await signUp(app, 'settings3@example.com');

    await request(app)
      .put('/notifications/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ pushEnabled: false, emailEnabled: false });
    const res = await request(app)
      .put('/notifications/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ emailEnabled: true });
    expect(res.body).toEqual({ pushEnabled: false, emailEnabled: true });
  });

  it('rejects an update with neither field', async () => {
    const { app } = buildApp();
    const { token } = await signUp(app, 'settings4@example.com');

    const res = await request(app).put('/notifications/settings').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });
});

describe('push token registration', () => {
  it('registers a token and is idempotent on repeat registration', async () => {
    const { app } = buildApp();
    const { token } = await signUp(app, 'device@example.com');

    const res = await request(app)
      .post('/notifications/push-tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ platform: 'expo', token: 'expo-tok-1' });
    expect(res.status).toBe(201);

    const again = await request(app)
      .post('/notifications/push-tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ platform: 'expo', token: 'expo-tok-1' });
    expect(again.status).toBe(201);
  });

  it('rejects an unknown platform', async () => {
    const { app } = buildApp();
    const { token } = await signUp(app, 'device2@example.com');

    const res = await request(app)
      .post('/notifications/push-tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ platform: 'android', token: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('notification inbox', () => {
  it('lists an account own notifications and lets them be marked read', async () => {
    const { app } = buildApp();
    const { token, accountId } = await signUp(app, 'inbox@example.com');
    await testDb.pool.query(
      "INSERT INTO notifications (account_id, type, title, body) VALUES ($1, 'results_ready', 'Title', 'Body')",
      [accountId],
    );

    const list = await request(app).get('/notifications').set('Authorization', `Bearer ${token}`);
    expect(list.body.notifications).toHaveLength(1);
    const notificationId = list.body.notifications[0].id;
    expect(list.body.notifications[0].readAt).toBeNull();

    const markRead = await request(app)
      .post(`/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${token}`);
    expect(markRead.status).toBe(200);

    const listAfter = await request(app).get('/notifications').set('Authorization', `Bearer ${token}`);
    expect(listAfter.body.notifications[0].readAt).toBeTruthy();
  });

  it('does not show another account notifications', async () => {
    const { app } = buildApp();
    const { accountId } = await signUp(app, 'owner@example.com');
    const { token: otherToken } = await signUp(app, 'stranger@example.com');
    await testDb.pool.query(
      "INSERT INTO notifications (account_id, type, title, body) VALUES ($1, 'results_ready', 'Title', 'Body')",
      [accountId],
    );

    const res = await request(app).get('/notifications').set('Authorization', `Bearer ${otherToken}`);
    expect(res.body.notifications).toEqual([]);
  });
});
