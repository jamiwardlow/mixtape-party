import { useEffect, useState } from 'react';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

type OfflineListener = (offline: boolean) => void;
const offlineListeners = new Set<OfflineListener>();

/** Called with true when a request fails to reach the API, false when one gets any answer. */
export function onOfflineChange(cb: OfflineListener): () => void {
  offlineListeners.add(cb);
  return () => void offlineListeners.delete(cb);
}

let wasOffline = false;
let reconnects = 0;

const notify = (offline: boolean) => {
  if (wasOffline && !offline) reconnects++;
  wasOffline = offline;
  offlineListeners.forEach((cb) => cb(offline));
};

/** Bumps on every offline -> online edge. Put it in a load effect's deps so the screen refetches. */
export function useReconnectEpoch(): number {
  const [, force] = useState(0);
  useEffect(() => onOfflineChange(() => force((n) => n + 1)), []);
  return reconnects;
}

/** fetch that rejects after `ms` instead of hanging on a stalled connection (no spinner can outlive it). */
export function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 15_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

/** Raw bytes sent as-is instead of a JSON body (the avatar endpoint). */
export interface Upload {
  bytes: Blob;
  contentType: string;
}

export function fetchApi(
  path: string,
  opts: { method?: string; body?: unknown; token?: string; upload?: Upload } = {},
): Promise<Response> {
  const { upload } = opts;
  return fetchWithTimeout(
    `${API_URL}${path}`,
    {
      method: opts.method ?? 'GET',
      headers: {
        'Content-Type': upload ? upload.contentType : 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: upload ? upload.bytes : opts.body ? JSON.stringify(opts.body) : undefined,
    },
    upload ? 60_000 : undefined, // uploads on a slow link legitimately take longer
  ).then(
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
