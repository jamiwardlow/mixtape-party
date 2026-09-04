import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../lib/session';

export default function RootLayout() {
  return (
    <SessionProvider>
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    </SessionProvider>
  );
}

function RootNavigator() {
  const { token, profile, isLoading } = useSession();

  if (isLoading) return null;

  const signedIn = token !== null;
  const onboarded = profile?.onboarded === true;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Always reachable: the web OAuth popup lands here in its own window/session state. */}
      <Stack.Screen name="spotify-callback" />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !onboarded}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && onboarded}>
        <Stack.Screen name="home" />
      </Stack.Protected>
    </Stack>
  );
}
