import { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { useLastNotificationResponse } from 'expo-notifications';

/**
 * Routes a tapped push to its round. The hook also yields the response that
 * cold-started the app, so one call covers cold start and foreground/background taps.
 * Pushes carrying a roundId open its guess screen, or its results when `screen` says so (a reply
 * to your comment); others just open the app.
 */
export function useOpenTappedNotification(enabled: boolean) {
  const response = useLastNotificationResponse();
  const data = response?.notification.request.content.data;
  const roundId = data?.roundId;
  const screen = data?.screen === 'results' ? 'results' : 'guess';
  // Keyed on the response object, not roundId: a second tap on the same round is a new response,
  // while a sign-out/in re-render must not replay one already handled.
  const handled = useRef<typeof response>(null);

  useEffect(() => {
    if (enabled && response && response !== handled.current && typeof roundId === 'string') {
      handled.current = response;
      router.push({ pathname: `/round/[roundId]/${screen}`, params: { roundId } });
    }
  }, [enabled, response, roundId, screen]);
}
