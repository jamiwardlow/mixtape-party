export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

type OfflineListener = (offline: boolean) => void;
const offlineListeners = new Set<OfflineListener>();

/** Called with true when a request fails to reach the API, false when one gets any answer. */
export function onOfflineChange(cb: OfflineListener): () => void {
  offlineListeners.add(cb);
  return () => void offlineListeners.delete(cb);
}

const notify = (offline: boolean) => offlineListeners.forEach((cb) => cb(offline));

export function fetchApi(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(
    (res) => {
      notify(false);
      return res;
    },
    (err) => {
      notify(true);
      throw err;
    },
  );
}
