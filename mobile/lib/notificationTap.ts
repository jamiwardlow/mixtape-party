import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { useLastNotificationResponse } from 'expo-notifications';

/**
 * Routes a tapped push to its round. The hook also yields the response that
 * cold-started the app, so one call covers cold start and foreground/background taps.
 * Pushes carrying a roundId open its guess screen, or its results when `screen` says so (a reply
 * to your comment, or a reaction), scrolled to `focus`; others just open the app.
 */
export function useOpenTappedNotification(enabled: boolean) {
  // expo-notifications' response API throws on web at render time, which blanks the whole app.
  // Platform.OS never changes at runtime, so the hook order is stable.
  if (Platform.OS === 'web') return;
  const response = useLastNotificationResponse();
  const data = response?.notification.request.content.data;
  const roundId = data?.roundId;
  const focus = typeof data?.focus === 'string' ? data.focus : undefined;
  const screen = data?.screen === 'results' ? 'results' : 'guess';
  // Keyed on the response object, not roundId: a second tap on the same round is a new response,
  // while a sign-out/in re-render must not replay one already handled.
  const handled = useRef<typeof response>(null);

  useEffect(() => {
    if (enabled && response && response !== handled.current && typeof roundId === 'string') {
      handled.current = response;
      router.push({ pathname: `/round/[roundId]/${screen}`, params: { roundId, ...(focus && { focus }) } });
    }
  }, [enabled, response, roundId, screen, focus]);
}
