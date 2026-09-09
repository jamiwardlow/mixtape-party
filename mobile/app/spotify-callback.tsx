import { router, useRootNavigationState } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../lib/session';

export default function SpotifyCallback() {
  const { token, profile } = useSession();
  const navState = useRootNavigationState();

  useEffect(() => {
    // On web, this closes the popup and resolves the promise in the opener
    // window. On native there's no popup to close, so this always fails —
    // bounce out instead of stranding whoever lands on this route. Wait for
    // the root navigator to attach first, since this route is often the one
    // a cold-start deep link lands on before the navigator is ready, and an
    // imperative replace() before that is silently dropped. The target must
    // match RootNavigator's own Stack.Protected guards (_layout.tsx) — e.g.
    // replacing straight to /home when the user isn't onboarded yet targets
    // a route that isn't mounted, and silently no-ops.
    if (!navState?.key) return;
    const result = WebBrowser.maybeCompleteAuthSession();
    if (result.type !== 'success') {
      const signedIn = token !== null;
      const onboarded = profile?.onboarded === true;
      router.replace(!signedIn ? '/sign-in' : !onboarded ? '/onboarding' : '/home');
    }
  }, [token, profile?.onboarded, navState?.key]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Finishing Spotify sign-in…</Text>
    </View>
  );
}
