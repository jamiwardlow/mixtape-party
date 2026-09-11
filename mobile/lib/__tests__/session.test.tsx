import { type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { SessionProvider, useSession } from '../session';
import type { SessionStorage } from '../storage';

function fakeStorage(): SessionStorage {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      if (value) map.set(key, value);
      else map.delete(key);
    },
  };
}

const PROFILE = { id: 'acc-1', email: 'jami@example.com' };

let storage: SessionStorage;

beforeEach(() => {
  storage = fakeStorage();
  globalThis.fetch = jest.fn(async (url: unknown) =>
    String(url).endsWith('/accounts/me')
      ? new Response(JSON.stringify(PROFILE))
      : new Response('{}', { status: 404 }),
  ) as unknown as typeof fetch;
});

// renderHook and act are both async in RNTL v14 — an un-awaited call renders outside act().
async function mountSession() {
  const wrapper = ({ children }: PropsWithChildren) => (
    <SessionProvider storage={storage}>{children}</SessionProvider>
  );
  const { result } = await renderHook(() => useSession(), { wrapper });
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
    expect(await storage.get('session_token')).toBe('tok-abc');
  });

  it('restores a stored token on mount', async () => {
    await storage.set('session_token', 'tok-stored');

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
    await waitFor(async () => expect(await storage.get('pending_invite_code')).toBe('LEAGUE-99'));

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.token).toBeNull();
    expect(result.current.profile).toBeNull();
    expect(result.current.pendingInviteCode).toBeNull();
    expect(await storage.get('pending_invite_code')).toBeNull();
  });
});
