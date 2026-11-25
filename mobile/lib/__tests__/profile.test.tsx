import { renderHook } from '@testing-library/react-native';
import { useProfile } from '../profile';

const mockRefresh = jest.fn(async () => {});
const mockSetPending = jest.fn();
let mockPending: string | null = null;
jest.mock('../session', () => ({
  useSession: () => ({
    token: 'tok-1',
    signOut: jest.fn(),
    profile: { id: 'a1', email: 'ada@example.com' },
    refreshProfile: mockRefresh,
    pendingInviteCode: mockPending,
    setPendingInviteCode: mockSetPending,
  }),
}));

let fetchMock: jest.Mock;
const respond = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });

beforeEach(() => {
  jest.clearAllMocks();
  mockPending = null;
  fetchMock = jest.fn(async () => respond(200, {}));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

const actions = async () => (await renderHook(() => useProfile())).result.current;

describe('update', () => {
  it('patches the fields, then re-reads the profile', async () => {
    const r = await (await actions()).update({ displayName: 'Ada' });
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/accounts\/me$/);
    expect(init).toMatchObject({ method: 'PATCH', body: JSON.stringify({ displayName: 'Ada' }) });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('leaves the profile alone when the save fails', async () => {
    fetchMock.mockResolvedValueOnce(respond(400, { error: 'too long' }));
    expect(await (await actions()).update({ displayName: 'x' })).toEqual({ ok: false, status: 400, error: 'too long' });
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe('avatar', () => {
  it('uploads the bytes as JPEG, then re-reads the profile', async () => {
    await (await actions()).uploadAvatar('raw' as unknown as Blob);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/accounts\/me\/avatar$/);
    expect(init).toMatchObject({ method: 'PUT', body: 'raw' });
    expect(init.headers['Content-Type']).toBe('image/jpeg');
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('removes with DELETE, then re-reads the profile', async () => {
    await (await actions()).removeAvatar();
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(mockRefresh).toHaveBeenCalled();
  });
});

describe('joinInvite', () => {
  it('clears the pending code once the server answers, even with a refusal', async () => {
    mockPending = 'ABC';
    fetchMock.mockResolvedValueOnce(respond(404, { error: 'nope' }));
    const r = await (await actions()).joinInvite('ABC');
    expect(r.ok).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/leagues\/invite\/ABC\/join$/);
    expect(mockSetPending).toHaveBeenCalledWith(null);
  });

  // A request that never landed keeps the code, so the join is retried on the next load.
  it('keeps the pending code when offline', async () => {
    mockPending = 'ABC';
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await (await actions()).joinInvite('ABC')).toMatchObject({ ok: false, status: 0 });
    expect(mockSetPending).not.toHaveBeenCalled();
  });

  it("doesn't drop a different league's pending code", async () => {
    mockPending = 'OTHER';
    await (await actions()).joinInvite('ABC');
    expect(mockSetPending).not.toHaveBeenCalled();
  });
});
