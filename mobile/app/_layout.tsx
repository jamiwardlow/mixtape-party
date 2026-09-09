/**
 * THESIS: Identity is a physical object handed to a friend, not a database row —
 * every league is a labeled cassette, and who submitted or guessed stays
 * handwritten and unrevealed until the round turns over. Refuses the generic
 * avatar-badge party-app default.
 * OWN-WORLD: Warm shell palette (cream/near-black bases, one record-red accent).
 * Courier Prime for all printed chrome — labels, badges, buttons, counters.
 * Homemade Apple ballpoint script reserved for handwritten identity only. Rounded
 * J-card shells, twin reel holes, dashed sprocket dividers, a two-reel spinner
 * standing in for loading.
 * STORY: A player recognizes their leagues as cassettes on a shelf, submits or
 * guesses without their name leaking, then reads results as handwritten credits
 * revealed once the round ends.
 * FIRST VIEWPORT: Home — a spine-label header (title, reel holes, mono caps),
 * a stack of league J-cards each showing a hand-lettered league name and a
 * printed phase-label button as the primary tap target, then a quiet
 * "create a league" strip and sign-out link.
 * FORM: MY PICK card (mixtape/cassette culture), #1 on my ranked list. Roll
 * seed 95244d10 assigned index 7 (gig-ticket ephemera); not shipped — the
 * user chose the pick instead.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md
 */
import { CourierPrime_400Regular, CourierPrime_700Bold, useFonts as useCourierPrime } from '@expo-google-fonts/courier-prime';
import { HomemadeApple_400Regular, useFonts as useHomemadeApple } from '@expo-google-fonts/homemade-apple';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../lib/session';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [courierLoaded] = useCourierPrime({ CourierPrime_400Regular, CourierPrime_700Bold });
  const [handLoaded] = useHomemadeApple({ HomemadeApple_400Regular });
  const fontsReady = courierLoaded && handLoaded;

  useEffect(() => {
    if (fontsReady) SplashScreen.hideAsync();
  }, [fontsReady]);

  if (!fontsReady) return null;

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
      {/* Always reachable: an invite link should show its preview before gating on sign-up. */}
      <Stack.Screen name="join/[code]" />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !onboarded}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && onboarded}>
        <Stack.Screen name="home" />
        <Stack.Screen name="create-league" />
        <Stack.Screen name="round/[roundId]/submit" />
        <Stack.Screen name="round/[roundId]/guess" />
        <Stack.Screen name="round/[roundId]/results" />
      </Stack.Protected>
    </Stack>
  );
}
