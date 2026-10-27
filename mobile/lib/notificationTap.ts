import { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { useLastNotificationResponse } from 'expo-notifications';

/**
 * Routes a tapped push to its round's guess screen. The hook also yields the response that
 * cold-started the app, so one call covers cold start and foreground/background taps.
 * Only the guessing-open push carries a roundId today; others just open the app.
 */
export function useOpenTappedNotification(enabled: boolean) {
  const response = useLastNotificationResponse();
  const roundId = response?.notification.request.content.data?.roundId;
  // Keyed on the response object, not roundId: a second tap on the same round is a new response,
  // while a sign-out/in re-render must not replay one already handled.
  const handled = useRef<typeof response>(null);

  useEffect(() => {
    if (enabled && response && response !== handled.current && typeof roundId === 'string') {
      handled.current = response;
      router.push({ pathname: '/round/[roundId]/guess', params: { roundId } });
    }
  }, [enabled, response, roundId]);
}
