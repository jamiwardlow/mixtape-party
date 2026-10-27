import { afterEach, expect, it, vi } from 'vitest';
import { ExpoWebPushChannel } from '../notifications/channels.js';

afterEach(() => vi.unstubAllGlobals());

it('sends the deep-link data in the Expo push body', async () => {
  const fetchMock = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);

  await new ExpoWebPushChannel().send([{ platform: 'expo', token: 'ExponentPushToken[a]' }], {
    title: 't',
    body: 'b',
    data: { roundId: 'round-1' },
  });

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual([
    { to: 'ExponentPushToken[a]', title: 't', body: 'b', data: { roundId: 'round-1' } },
  ]);
});
