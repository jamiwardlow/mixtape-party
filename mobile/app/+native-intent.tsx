/**
 * Emailed magic links carry their token in the URL fragment (`/auth/complete#t=…`, see
 * api/src/routes/auth.ts), and Expo Router drops fragments on native — so the app opened on
 * /auth/complete with no token and bounced to sign-in. Move it to the `t` param complete.tsx reads.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const url = new URL(path, 'https://x.invalid');
    const t = new URLSearchParams(url.hash.replace(/^#/, '')).get('t');
    if (url.pathname === '/auth/complete' && t) return `/auth/complete?t=${encodeURIComponent(t)}`;
  } catch {}
  return path;
}
