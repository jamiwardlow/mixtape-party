import { linkAppleMusic } from '../appleMusic';

const authorize = jest.fn<Promise<string>, []>();
const configure = jest.fn();
let fetchMock: jest.Mock;

function apiResponse(path: string): Response {
  if (path.includes('/developer-token')) return new Response(JSON.stringify({ token: 'dev-tok' }));
  return new Response(JSON.stringify({ linked: true }), { status: 201 });
}

beforeEach(() => {
  jest.clearAllMocks();
  authorize.mockResolvedValue('mut-1');
  configure.mockResolvedValue({ authorize });
  // Set, so the CDN script-injection path is skipped -- that branch needs a DOM this runner
  // (jest-environment-node) does not have.
  (globalThis as { MusicKit?: unknown }).MusicKit = { configure };
  fetchMock = jest.fn(async (url: string) => apiResponse(url));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

// The whole point of the flow: a Music User Token minted in the browser has to reach the API, or
// the account stays unlinked and the Apple export leg never runs.
it('authorizes with the API-issued developer token and posts the Music User Token back', async () => {
  await linkAppleMusic('session-tok');

  expect(fetchMock.mock.calls[0][0]).toContain('/auth/apple-music/developer-token');
  expect(configure).toHaveBeenCalledWith(expect.objectContaining({ developerToken: 'dev-tok' }));

  const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
  expect(url).toContain('/auth/apple-music/callback');
  expect(init.method).toBe('POST');
  expect(init.body).toBe(JSON.stringify({ musicUserToken: 'mut-1' }));
  expect(init.headers).toMatchObject({ Authorization: 'Bearer session-tok' });
});

it('fails before opening Apple when the API has no developer token', async () => {
  fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));

  await expect(linkAppleMusic('session-tok')).rejects.toThrow(/isn't available/);
  expect(configure).not.toHaveBeenCalled();
});

it('fails when the user cancels the Apple popup', async () => {
  authorize.mockRejectedValue(new Error('AUTHORIZATION_ERROR'));

  await expect(linkAppleMusic('session-tok')).rejects.toThrow(/didn’t finish/);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('fails when the API rejects the Music User Token', async () => {
  fetchMock.mockImplementation(async (url: string) =>
    url.includes('/developer-token') ? apiResponse(url) : new Response('{}', { status: 400 }),
  );

  await expect(linkAppleMusic('session-tok')).rejects.toThrow(/couldn't verify/);
});
