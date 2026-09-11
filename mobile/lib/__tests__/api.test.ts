import { API_URL, fetchApi } from '../api';

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
