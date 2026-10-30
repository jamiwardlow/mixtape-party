import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from './testDb.js';
import { ExpoWebPushChannel } from '../notifications/channels.js';
import { runNotificationSweep } from '../notifications/sweep.js';
import { FakeEmailChannel, FakePushChannel } from '../notifications/fakeChannels.js';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, 60_000);

afterEach(async () => {
  vi.unstubAllGlobals();
  await testDb.reset();
});

afterAll(async () => {
  await testDb.teardown();
});

const payload = { title: 't', body: 'b' };

async function seedTokens(...tokens: string[]) {
  const { rows } = await testDb.pool.query<{ id: string }>(
    "INSERT INTO accounts (email, password_hash) VALUES ('a@x.com', 'h') RETURNING id",
  );
  for (const token of tokens) {
    await testDb.pool.query("INSERT INTO push_tokens (account_id, platform, token) VALUES ($1, 'expo', $2)", [rows[0].id, token]);
  }
}

const remaining = async () =>
  (await testDb.pool.query<{ token: string }>('SELECT token FROM push_tokens ORDER BY token')).rows.map((r) => r.token);

const json = (body: unknown) => new Response(JSON.stringify(body));

it('prunes tokens whose receipt says DeviceNotRegistered, keeps the rest', async () => {
  await seedTokens('good', 'dead');
  const channel = new ExpoWebPushChannel(testDb.pool);
  vi.stubGlobal('fetch', async () => json({ data: [{ status: 'ok', id: 't1' }, { status: 'ok', id: 't2' }] }));
  await channel.send([{ platform: 'expo', token: 'good' }, { platform: 'expo', token: 'dead' }], payload);

  // Too fresh to check: no request, nothing pruned.
  const fetchMock = vi.fn(async () => json({ data: { t1: { status: 'ok' }, t2: { status: 'error', details: { error: 'DeviceNotRegistered' } } } }));
  vi.stubGlobal('fetch', fetchMock);
  await channel.checkReceipts();
  expect(fetchMock).not.toHaveBeenCalled();

  await testDb.pool.query("UPDATE push_receipts SET created_at = now() - interval '10 minutes'");
  await channel.checkReceipts();
  expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ ids: ['t1', 't2'] });
  expect(await remaining()).toEqual(['good']);
  expect((await testDb.pool.query('SELECT 1 FROM push_receipts')).rowCount).toBe(0);
});

it('keeps tickets whose receipt is not ready yet', async () => {
  await seedTokens('a');
  const channel = new ExpoWebPushChannel(testDb.pool);
  vi.stubGlobal('fetch', async () => json({ data: [{ status: 'ok', id: 't1' }] }));
  await channel.send([{ platform: 'expo', token: 'a' }], payload);
  await testDb.pool.query("UPDATE push_receipts SET created_at = now() - interval '10 minutes'");

  vi.stubGlobal('fetch', async () => json({ data: {} }));
  await channel.checkReceipts();
  expect((await testDb.pool.query('SELECT 1 FROM push_receipts')).rowCount).toBe(1);
});

it('prunes immediately when the ticket itself reports DeviceNotRegistered', async () => {
  await seedTokens('dead');
  vi.stubGlobal('fetch', async () => json({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }));
  await new ExpoWebPushChannel(testDb.pool).send([{ platform: 'expo', token: 'dead' }], payload);
  expect(await remaining()).toEqual([]);
});

it('maps a mixed batch back to the right tokens and keeps tokens with other receipt errors', async () => {
  await seedTokens('a', 'b', 'c');
  const channel = new ExpoWebPushChannel(testDb.pool);
  vi.stubGlobal('fetch', async () =>
    json({ data: [{ status: 'ok', id: 't1' }, { status: 'ok', id: 't2' }, { status: 'ok', id: 't3' }] }),
  );
  await channel.send(['a', 'b', 'c'].map((token) => ({ platform: 'expo' as const, token })), payload);
  await testDb.pool.query("UPDATE push_receipts SET created_at = now() - interval '10 minutes'");

  vi.stubGlobal('fetch', async () =>
    json({
      data: {
        t1: { status: 'error', details: { error: 'MessageRateExceeded' } },
        t2: { status: 'error', details: { error: 'DeviceNotRegistered' } },
        t3: { status: 'ok' },
      },
    }),
  );
  await channel.checkReceipts();
  expect(await remaining()).toEqual(['a', 'c']);
  expect((await testDb.pool.query('SELECT 1 FROM push_receipts')).rowCount).toBe(0);
});

it('the sweep checks receipts, and a failing check does not fail the sweep', async () => {
  const checkReceipts = vi.fn(async () => {
    throw new Error('expo down');
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const pushChannel = Object.assign(new FakePushChannel(), { checkReceipts });
  await runNotificationSweep({ pool: testDb.pool, pushChannel, emailChannel: new FakeEmailChannel() });
  expect(checkReceipts).toHaveBeenCalledOnce();
});
