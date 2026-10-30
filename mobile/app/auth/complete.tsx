import { router, useLocalSearchParams } from 'expo-router';
import { Platform } from 'react-native';
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
  const { t: nativeToken, v: codeVerifier } = useLocalSearchParams<{ t?: string; v?: string }>();
  const exchanged = useRef(false);

  useEffect(() => {
    // React 19 StrictMode double-invokes effects and these tokens burn on first use: without this
    // guard the second exchange 401s and paints an error over a sign-in that actually worked.
    if (exchanged.current) return;
    exchanged.current = true;

    // Native hands the token over as a route param (no address bar or access log to leak it to);
    // web reads it from the fragment.
    const authToken =
      Platform.OS === 'web' ? new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t') : nativeToken;
    if (!authToken) {
      // A native deep link can open this route with no token while sign-in.tsx is still handing
      // the real one over; bounce to sign-in rather than flashing an error.
      if (Platform.OS !== 'web') {
        router.replace('/sign-in');
        return;
      }
      setError('This sign-in link is missing its token.');
      return;
    }
    // Out of the address bar (and out of document.referrer) before anything else happens.
    if (Platform.OS === 'web') window.history.replaceState(null, '', window.location.pathname + window.location.search);

    (async () => {
      const res = await fetchApi('/sessions/token', { method: 'POST', body: { token: authToken, codeVerifier } });
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
