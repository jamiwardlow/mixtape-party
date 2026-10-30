import { afterEach, expect, it, vi } from 'vitest';
import { ExpoWebPushChannel, ResendEmailChannel } from '../notifications/channels.js';

afterEach(() => vi.unstubAllGlobals());

it('sends the deep-link data in the Expo push body', async () => {
  const fetchMock = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);

  await new ExpoWebPushChannel({ query: async () => ({}) } as never).send([{ platform: 'expo', token: 'ExponentPushToken[a]' }], {
    title: 't',
    body: 'b',
    data: { roundId: 'round-1' },
  });

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual([
    { to: 'ExponentPushToken[a]', title: 't', body: 'b', data: { roundId: 'round-1' } },
  ]);
});

it('sends escaped HTML plus the unchanged plain-text part to Resend', async () => {
  const fetchMock = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);

  await new ResendEmailChannel('key', 'from@x.com').send('to@x.com', {
    title: 'Hi <b>',
    body: '<script>alert(1)</script> & co',
    link: 'https://a.test/?x=1&y=2',
    appLink: 'https://app.test/round/1',
  });

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  const sent = JSON.parse(init.body as string);
  expect(sent.text).toBe('<script>alert(1)</script> & co\n\nhttps://a.test/?x=1&y=2\n\nhttps://app.test/round/1');
  expect(sent.html).not.toContain('<script>');
  expect(sent.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
  expect(sent.html).toContain('Hi &lt;b&gt;');
  expect(sent.html).toContain('href="https://a.test/?x=1&amp;y=2"');
});

it('does not swallow an escaped character after a URL in the body into the link', async () => {
  const fetchMock = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);

  await new ResendEmailChannel('key', 'from@x.com').send('to@x.com', { title: 't', body: 'go https://a.test/x<b' });

  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string).html).toContain('<a href="https://a.test/x">https://a.test/x</a>&lt;b');
});
