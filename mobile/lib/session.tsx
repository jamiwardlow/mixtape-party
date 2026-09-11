import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { fetchApi } from './api';

const TOKEN_KEY = 'session_token';
const INVITE_KEY = 'pending_invite_code';

async function getStored(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function setStored(key: string, value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return;
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
    return;
  }
  if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
}

export interface Profile {
  id: string;
  email: string;
}

interface SessionContextValue {
  token: string | null;
  profile: Profile | null;
  isLoading: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /**
   * Persisted, not in-memory: Google sign-in navigates the whole page away and back, and a magic
   * link opens a fresh page load, so an in-memory code is gone by the time /home tries the
   * auto-join — and the user lands on an empty shelf with no idea the join was dropped.
   *
   * ponytail: a magic link opened in a *different* browser than it was requested from still loses
   * the code. Fixing that means carrying the invite code in the emailed link itself; not worth it
   * until someone reports it.
   */
  pendingInviteCode: string | null;
  setPendingInviteCode: (code: string | null) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingInviteCode, setPendingInviteCodeState] = useState<string | null>(null);

  function setPendingInviteCode(code: string | null): void {
    setPendingInviteCodeState(code);
    void setStored(INVITE_KEY, code);
  }

  async function loadProfile(currentToken: string): Promise<void> {
    const res = await fetchApi('/accounts/me', { token: currentToken });
    if (res.ok) setProfile(await res.json());
  }

  useEffect(() => {
    (async () => {
      setPendingInviteCodeState(await getStored(INVITE_KEY));
      const stored = await getStored(TOKEN_KEY);
      if (stored) {
        setToken(stored);
        await loadProfile(stored);
      }
      setIsLoading(false);
    })();
  }, []);

  async function signIn(newToken: string): Promise<void> {
    await setStored(TOKEN_KEY, newToken);
    setToken(newToken);
    await loadProfile(newToken);
  }

  async function signOut(): Promise<void> {
    await setStored(TOKEN_KEY, null);
    // Goes with the session: a code left behind outlives the account that opened the invite, and
    // the next person to sign in on this browser would silently auto-join their league.
    setPendingInviteCode(null);
    setToken(null);
    setProfile(null);
  }

  async function refreshProfile(): Promise<void> {
    if (token) await loadProfile(token);
  }

  return (
    <SessionContext.Provider
      value={{ token, profile, isLoading, signIn, signOut, refreshProfile, pendingInviteCode, setPendingInviteCode }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
