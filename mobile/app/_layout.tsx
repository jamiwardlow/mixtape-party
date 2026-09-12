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
  const { token, isLoading } = useSession();

  if (isLoading) return null;

  const signedIn = token !== null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Anchor: an emptied stack falls back to routeNames[0] (StackRouter.getStateForRouteNamesChange).
          index is the one screen that is never guarded and redirects correctly in both directions, so
          every guard flip lands somewhere sane. Keep it first. Not unstable_settings.initialRouteName:
          that is also the deep-link anchor and would mount index beneath /join/<code>, whose redirect
          would hijack the invite preview. */}
      <Stack.Screen name="index" />
      {/* Always reachable: an invite link should show its preview before gating on sign-up. */}
      <Stack.Screen name="join/[code]" />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="home" />
        <Stack.Screen name="create-league" />
        <Stack.Screen name="round/[roundId]/submit" />
        <Stack.Screen name="round/[roundId]/guess" />
        <Stack.Screen name="round/[roundId]/results" />
      </Stack.Protected>
    </Stack>
  );
}
