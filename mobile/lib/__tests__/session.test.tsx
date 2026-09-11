import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { SessionProvider, useSession } from '../session';

// ponytail: the default jest-expo preset runs one platform, so these exercise the SecureStore
// branch of getStored/setStored only — the Platform.OS === 'web' localStorage branch is untested.
// Switch to the jest-expo/universal preset if a web-only storage bug ever shows up.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: async (key: string) => store.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => void store.set(key, value),
    deleteItemAsync: async (key: string) => void store.delete(key),
  };
});

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const PROFILE = { id: 'acc-1', email: 'jami@example.com' };

beforeEach(() => {
  store.clear();
  globalThis.fetch = jest.fn(async (url: unknown) =>
    String(url).endsWith('/accounts/me')
      ? new Response(JSON.stringify(PROFILE))
      : new Response('{}', { status: 404 }),
  ) as unknown as typeof fetch;
});

// renderHook and act are both async in RNTL v14 — an un-awaited call renders outside act().
async function mountSession() {
  const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return result;
}

describe('useSession', () => {
  it('persists the token and loads the profile on signIn', async () => {
    const result = await mountSession();

    await act(async () => {
      await result.current.signIn('tok-abc');
    });

    expect(result.current.token).toBe('tok-abc');
    expect(result.current.profile).toEqual(PROFILE);
    expect(store.get('session_token')).toBe('tok-abc');
  });

  it('restores a stored token on mount', async () => {
    store.set('session_token', 'tok-stored');

    const result = await mountSession();

    expect(result.current.token).toBe('tok-stored');
    expect(result.current.profile).toEqual(PROFILE);
  });

  // The rule worth a test: a code left behind would silently auto-join the next person to sign in.
  it('clears the pending invite code along with the session on signOut', async () => {
    const result = await mountSession();
    await act(async () => {
      await result.current.signIn('tok-abc');
    });
    await act(() => {
      result.current.setPendingInviteCode('LEAGUE-99');
    });
    await waitFor(() => expect(store.get('pending_invite_code')).toBe('LEAGUE-99'));

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.token).toBeNull();
    expect(result.current.profile).toBeNull();
    expect(result.current.pendingInviteCode).toBeNull();
    expect(store.has('pending_invite_code')).toBe(false);
  });
});
