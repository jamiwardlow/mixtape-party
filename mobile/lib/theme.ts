import type { ServiceName } from './rounds';

const dark = {
  bg: '#1B1611',
  shell: '#26201A',
  shellPressed: '#312921',
  ink: '#ECE1CB',
  inkMuted: '#A8987E',
  hairline: '#3B3126',
  reel: '#544738',
  accent: '#E2543A',
  accentInk: '#1B1611',
};

export type Theme = typeof dark;

// Dark is the only v1 theme — the cassette-shelf identity reads as a lit-up
// stereo shelf at night, not a paper insert; there's no light-mode design.
export function useTheme(): Theme {
  return dark;
}

export const SERVICE_META: Record<ServiceName, { label: string; color: string }> = {
  apple_music: { label: 'Apple Music', color: '#FA2D48' },
  youtube_music: { label: 'YouTube Music', color: '#FF0000' },
  bandcamp: { label: 'Bandcamp', color: '#1DA0C3' },
};

export const fonts = {
  hand: 'HomemadeApple_400Regular',
  mono: 'CourierPrime_400Regular',
  monoBold: 'CourierPrime_700Bold',
};
