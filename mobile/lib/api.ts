export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

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
  });
}
