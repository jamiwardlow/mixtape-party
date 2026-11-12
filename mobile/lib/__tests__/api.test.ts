import { API_URL, fetchApi, onOfflineChange } from '../api';

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue(new Response('{}'));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

const callArgs = () => fetchMock.mock.calls[0] as [string, RequestInit];

describe('fetchApi', () => {
  it('GETs the path off API_URL with no auth header', async () => {
    await fetchApi('/accounts/me');
    const [url, init] = callArgs();

    // API_URL comes from EXPO_PUBLIC_API_URL at module load, so assert against the constant.
    expect(url).toBe(`${API_URL}/accounts/me`);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBeUndefined();
  });

  it('sends a bearer token when one is passed', async () => {
    await fetchApi('/accounts/me', { token: 'tok-123' });

    expect(callArgs()[1].headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok-123',
    });
  });

  it('JSON-encodes the body and keeps the given method', async () => {
    await fetchApi('/leagues', { method: 'POST', body: { name: 'Mixtape' } });
    const [, init] = callArgs();

    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"Mixtape"}');
  });
});

describe('fetchApi timeout', () => {
  it('rejects and reports offline when the server never answers', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted')))),
    );
    const offline = jest.fn();
    const off = onOfflineChange(offline);

    const p = fetchApi('/accounts/me');
    const assertion = expect(p).rejects.toThrow('aborted');
    jest.advanceTimersByTime(15_000);
    await assertion;

    expect(offline).toHaveBeenCalledWith(true);
    off();
    jest.useRealTimers();
  });
});
