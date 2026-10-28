import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useLastNotificationResponse } from 'expo-notifications';

/**
 * Routes a tapped push to its round. The hook also yields the response that
 * cold-started the app, so one call covers cold start and foreground/background taps.
 * Pushes carrying a roundId open its guess screen, or its results when `screen` says so (a reply
 * to your comment, or a reaction), scrolled to `focus`. A leagueId with `screen: 'final'` opens the
 * season wrap-up; others just open the app.
 */
export function useOpenTappedNotification(enabled: boolean) {
  // expo-notifications' response API throws on web at render time, which blanks the whole app.
  // Platform.OS never changes at runtime, so the hook order is stable.
  if (Platform.OS === 'web') return;
  const response = useLastNotificationResponse();
  const data = response?.notification.request.content.data;
  const roundId = data?.roundId;
  const finalLeagueId = data?.screen === 'final' ? data.leagueId : undefined;
  const focus = typeof data?.focus === 'string' ? data.focus : undefined;
  const screen = data?.screen === 'results' ? 'results' : 'guess';
  // Keyed on the response object, not roundId: a second tap on the same round is a new response,
  // while a sign-out/in re-render must not replay one already handled.
  // On cold start the index route's <Redirect> is still replacing '/' with '/home'; a push issued
  // before it settles gets replaced along with it, so wait until we've left '/'.
  const atIndex = usePathname() === '/';
  const handled = useRef<typeof response>(null);

  useEffect(() => {
    if (!enabled || atIndex || !response || response === handled.current) return;
    if (typeof finalLeagueId === 'string') {
      handled.current = response;
      router.push({ pathname: '/league/[leagueId]/final', params: { leagueId: finalLeagueId } });
    } else if (typeof roundId === 'string') {
      handled.current = response;
      router.push({ pathname: `/round/[roundId]/${screen}`, params: { roundId, ...(focus && { focus }) } });
    }
  }, [enabled, atIndex, response, roundId, finalLeagueId, screen, focus]);
}
