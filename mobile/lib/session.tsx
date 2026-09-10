import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { fetchApi } from './api';

const TOKEN_KEY = 'session_token';

async function getStoredToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(TOKEN_KEY);
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function setStoredToken(value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return;
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
    return;
  }
  if (value) await SecureStore.setItemAsync(TOKEN_KEY, value);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
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
  // ponytail: kept in memory only (lost if the app is killed mid sign-up); persist to
  // SecureStore alongside the session token if that gap turns out to matter.
  pendingInviteCode: string | null;
  setPendingInviteCode: (code: string | null) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(null);

  async function loadProfile(currentToken: string): Promise<void> {
    const res = await fetchApi('/accounts/me', { token: currentToken });
    if (res.ok) setProfile(await res.json());
  }

  useEffect(() => {
    (async () => {
      const stored = await getStoredToken();
      if (stored) {
        setToken(stored);
        await loadProfile(stored);
      }
      setIsLoading(false);
    })();
  }, []);

  async function signIn(newToken: string): Promise<void> {
    await setStoredToken(newToken);
    setToken(newToken);
    await loadProfile(newToken);
  }

  async function signOut(): Promise<void> {
    await setStoredToken(null);
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
