import { act, renderHook, waitFor } from '@testing-library/react-native';
import { API_URL } from '../api';
import { useApi, useResource } from '../client';

const mockSignOut = jest.fn();
let mockToken: string | null = 'tok-1';
jest.mock('../session', () => ({ useSession: () => ({ token: mockToken, signOut: mockSignOut }) }));
let mockFocus: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    mockFocus = cb;
    require('react').useEffect(cb, [cb]);
  },
}));

let fetchMock: jest.Mock;
const respond = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

beforeEach(() => {
  jest.clearAllMocks();
  mockToken = 'tok-1';
  fetchMock = jest.fn(async () => respond(200, { hi: 1 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

const callApi = async () => (await renderHook(() => useApi())).result.current;

describe('useApi', () => {
  it('sends the session token and resolves parsed JSON', async () => {
    const r = await (await callApi())('/x', { method: 'POST', body: { a: 1 } });
    expect(r).toEqual({ ok: true, data: { hi: 1 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/x`);
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect(init.body).toBe('{"a":1}');
  });

  it("resolves the server's error message, or the fallback", async () => {
    fetchMock.mockResolvedValueOnce(respond(400, { error: 'bad theme' }));
    expect(await (await callApi())('/x', { fallback: 'nope' })).toEqual({ ok: false, status: 400, error: 'bad theme' });
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 502 }));
    expect(await (await callApi())('/x', { fallback: 'nope' })).toEqual({ ok: false, status: 502, error: 'nope' });
  });

  it('resolves status 0 instead of rejecting when offline', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await (await callApi())('/x', { fallback: 'nope' })).toEqual({ ok: false, status: 0, error: 'nope' });
  });

  it('handles empty 204 bodies', async () => {
    fetchMock.mockResolvedValueOnce(respond(204));
    expect(await (await callApi())('/x')).toEqual({ ok: true, data: undefined });
  });

  it('signs out on a 401 to an authenticated request, not an anonymous one', async () => {
    fetchMock.mockResolvedValue(respond(401, { error: 'unauthorized' }));
    await (await callApi())('/x');
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    mockToken = null;
    await (await callApi())('/sessions', { method: 'POST' });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('uploads raw bytes with their content type', async () => {
    await (await callApi())('/avatar', { method: 'PUT', upload: { bytes: 'raw' as unknown as Blob, contentType: 'image/jpeg' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe('raw');
    expect(init.headers['Content-Type']).toBe('image/jpeg');
  });
});

describe('useResource', () => {
  it('loads, then exposes the data', async () => {
    const { result } = await renderHook(() => useResource<{ hi: number }>('/x', 'nope'));
    await waitFor(() => expect(result.current.data).toEqual({ hi: 1 }));
    expect(result.current.error).toBeNull();
  });

  it('exposes the error when the first load fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const { result } = await renderHook(() => useResource('/x', 'Could not load'));
    await waitFor(() => expect(result.current.error).toBe('Could not load'));
  });

  it('waits for a path and a token', async () => {
    await renderHook(() => useResource(null, 'nope'));
    mockToken = null;
    await renderHook(() => useResource('/x', 'nope'));
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the data when a refetch fails', async () => {
    const { result } = await renderHook(() => useResource('/x', 'nope'));
    await waitFor(() => expect(result.current.data).toEqual({ hi: 1 }));
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await act(async () => result.current.reload());
    expect(result.current.data).toEqual({ hi: 1 });
    expect(result.current.error).toBeNull();
  });

  it('refetches on focus', async () => {
    const { result } = await renderHook(() => useResource('/x', 'nope'));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    fetchMock.mockResolvedValueOnce(respond(200, { hi: 2 }));
    await act(async () => mockFocus!());
    expect(result.current.data).toEqual({ hi: 2 });
  });

  it('ignores a response that lands after the path changed', async () => {
    let slow!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((res) => (slow = res)));
    fetchMock.mockResolvedValueOnce(respond(200, { which: 'b' }));
    const { result, rerender } = await renderHook(({ path }: { path: string }) => useResource(path, 'nope'), {
      initialProps: { path: '/a' },
    });
    await rerender({ path: '/b' });
    await waitFor(() => expect(result.current.data).toEqual({ which: 'b' }));
    await act(async () => slow(respond(200, { which: 'a' })));
    expect(result.current.data).toEqual({ which: 'b' });
  });
});
