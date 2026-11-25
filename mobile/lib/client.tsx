import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { fetchApi, useReconnectEpoch, type Upload } from './api';
import { useSession } from './session';
import { ErrorNote, ReelSpinner, Screen, TapeButton } from './ui';

/** `status` 0 means the request never reached the API (offline, timeout). */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export interface ApiOptions {
  method?: string;
  body?: unknown;
  upload?: Upload;
  /** Shown when the server gives no message of its own, or can't be reached. */
  fallback?: string;
}

export type Api = <T = unknown>(path: string, opts?: ApiOptions) => Promise<ApiResult<T>>;

const DEFAULT_FALLBACK = 'Something went wrong. Try again.';

/**
 * The session-aware client: sends the signed-in token, never rejects, and signs out when the API
 * says the token is dead. requireAuth is the only thing answering 401 to a request that carries a
 * token (a wrong password is a 403), so a 401 here always means the session is gone.
 */
export function useApi(): Api {
  const { token, signOut } = useSession();
  return useCallback<Api>(
    async <T,>(path: string, opts: ApiOptions = {}): Promise<ApiResult<T>> => {
      const fallback = opts.fallback ?? DEFAULT_FALLBACK;
      let res: Response;
      try {
        res = await fetchApi(path, { method: opts.method, body: opts.body, upload: opts.upload, token: token ?? undefined });
      } catch {
        return { ok: false, status: 0, error: fallback };
      }
      const text = await res.text().catch(() => '');
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      if (res.ok) return { ok: true, data: json as T };
      if (res.status === 401 && token) void signOut();
      const message = (json as { error?: unknown } | undefined)?.error;
      return { ok: false, status: res.status, error: typeof message === 'string' ? message : fallback };
    },
    [token, signOut],
  );
}

export interface Resource<T> {
  /** Null until the first successful load of this path. */
  data: T | null;
  /** Set only while there is no data to show: a failed refetch keeps the last good data. */
  error: string | null;
  /** The failed load's status alongside `error` (0 = offline), for screens that word each case. */
  status: number | null;
  reload: () => Promise<void>;
  /** Patch the loaded data after a mutation, without a round trip. */
  setData: (update: (prev: T) => T) => void;
}

/**
 * Loads `path` for a screen, and loads it again on every focus (screens stay mounted under pushed
 * ones) and whenever connectivity comes back. A response for an older request is dropped. Pass a
 * null path to wait (e.g. for a route param).
 */
export function useResource<T>(path: string | null, fallback: string): Resource<T> {
  const api = useApi();
  const { token } = useSession();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [state, setState] = useState<{ path: string; data: T | null; error: string | null; status: number | null } | null>(null);
  const latest = useRef(0);

  const epoch = useReconnectEpoch();
  const reload = useCallback(async () => {
    if (!path || !token) return;
    const id = ++latest.current;
    const r = await apiRef.current<T>(path, { fallback });
    if (id !== latest.current) return;
    setState((prev) => {
      const kept = prev?.path === path ? prev.data : null;
      return r.ok ? { path, data: r.data, error: null, status: null } : { path, data: kept, error: r.error, status: r.status };
    });
    // epoch: a reconnect re-runs the focus effect below, which refetches.
  }, [path, token, fallback, epoch]);
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const current = state?.path === path ? state : null;
  const setData = useCallback(
    (update: (prev: T) => T) => setState((s) => (s?.data != null ? { ...s, data: update(s.data) } : s)),
    [],
  );
  return {
    data: current?.data ?? null,
    error: current && current.data == null ? current.error : null,
    status: current && current.data == null ? current.status : null,
    reload,
    setData,
  };
}

/** Renders the screen chrome for a resource that failed to load (with a way home) or is still loading; children once it is ready. */
export function ResourceGate({
  label,
  error,
  ready,
  children,
}: {
  label: string;
  error: string | null;
  ready: boolean;
  children: React.ReactNode;
}) {
  if (error) {
    return (
      <Screen label={label}>
        <ErrorNote>{error}</ErrorNote>
        <TapeButton title="Back to home" onPress={() => router.replace('/home')} />
      </Screen>
    );
  }
  if (!ready) {
    return (
      <Screen label={label}>
        <ReelSpinner />
      </Screen>
    );
  }
  return <>{children}</>;
}
