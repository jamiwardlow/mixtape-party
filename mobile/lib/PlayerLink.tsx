import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { PressScale } from './ui';

/** Wraps a player's name/avatar so tapping it opens their public profile (#177). */
export function PlayerLink({ accountId, children }: { accountId: string; children: ReactNode }) {
  return (
    <PressScale
      accessibilityRole="link"
      onPress={() => router.push({ pathname: '/player/[id]', params: { id: accountId } })}
    >
      {children}
    </PressScale>
  );
}
