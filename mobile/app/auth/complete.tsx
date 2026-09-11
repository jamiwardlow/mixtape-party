import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { useSession } from '../../lib/session';
import { BodyText, ErrorNote, ReelSpinner, Screen, TapeButton } from '../../lib/ui';

/**
 * The landing page for both magic links and the Google redirect. Both arrive carrying a single-use
 * `sign_in` token in the URL *fragment* — never a query param, because `web.output: "server"` means
 * the browser makes a real SSR GET for this route and a query string would deposit a live
 * credential in the web service's access logs.
 */
export default function AuthComplete() {
  const { signIn, token } = useSession();
  const [error, setError] = useState<string | null>(null);
  const exchanged = useRef(false);

  useEffect(() => {
    // React 19 StrictMode double-invokes effects and these tokens burn on first use: without this
    // guard the second exchange 401s and paints an error over a sign-in that actually worked.
    if (exchanged.current) return;
    exchanged.current = true;

    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    const authToken = new URLSearchParams(hash.replace(/^#/, '')).get('t');
    if (!authToken) {
      setError('This sign-in link is missing its token.');
      return;
    }
    // Out of the address bar (and out of document.referrer) before anything else happens.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    (async () => {
      const res = await fetchApi('/sessions/token', { method: 'POST', body: { token: authToken } });
      if (!res.ok) {
        // Belt and braces on the guard above: a spent token plus an existing session is a
        // duplicate exchange, not a failed sign-in.
        if (token) router.replace('/home');
        else setError('This sign-in link has expired or was already used.');
        return;
      }
      await signIn((await res.json()).token);
      router.replace('/home');
    })().catch(() => setError("Couldn't reach the server. Try again."));
  }, []);

  if (error) {
    return (
      <Screen label="Sign-in link">
        <ErrorNote>{error}</ErrorNote>
        <TapeButton title="Back to sign in" onPress={() => router.replace('/sign-in')} />
      </Screen>
    );
  }

  return (
    <Screen label="Signing you in">
      <ReelSpinner />
      <BodyText style={{ textAlign: 'center' }}>One moment…</BodyText>
    </Screen>
  );
}
