import { BagelFatOne_400Regular } from '@expo-google-fonts/bagel-fat-one';
import { CourierPrime_400Regular, CourierPrime_700Bold } from '@expo-google-fonts/courier-prime';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useOpenTappedNotification } from '../lib/notificationTap';
import { useRegisterPushToken } from '../lib/pushToken';
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
  const [fontsLoaded, fontError] = useFonts({ BagelFatOne_400Regular, CourierPrime_400Regular, CourierPrime_700Bold });

  const signedIn = token !== null;
  // A tap while loading or signed out waits, then routes once the guarded screens exist.
  useOpenTappedNotification(!isLoading && signedIn);
  useRegisterPushToken(token);

  // A font failure falls back to system fonts rather than blocking the app.
  if (isLoading || (!fontsLoaded && !fontError)) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Anchor: an emptied stack falls back to routeNames[0] (StackRouter.getStateForRouteNamesChange).
          index is the one screen that is never guarded and redirects correctly in both directions, so
          every guard flip lands somewhere sane. Keep it first. Not unstable_settings.initialRouteName:
          that is also the deep-link anchor and would mount index beneath /join/<code>, whose redirect
          would hijack the invite preview. */}
      <Stack.Screen name="index" />
      {/* Always reachable: an invite link should show its preview before gating on sign-up. */}
      <Stack.Screen name="join/index" />
      <Stack.Screen name="join/[code]" />
      {/* Store requirement: public and readable signed out. */}
      <Stack.Screen name="privacy" />
      <Stack.Screen name="terms" />
      <Stack.Screen name="delete-account" />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="home" />
        <Stack.Screen name="create-league" />
        <Stack.Screen name="account" />
        <Stack.Screen name="favorites" />
        <Stack.Screen name="league/[leagueId]/index" />
        <Stack.Screen name="league/[leagueId]/schedule" />
        <Stack.Screen name="round/[roundId]/index" />
        <Stack.Screen name="round/[roundId]/submit" />
        <Stack.Screen name="round/[roundId]/guess" />
        <Stack.Screen name="round/[roundId]/results" />
      </Stack.Protected>
    </Stack>
  );
}
