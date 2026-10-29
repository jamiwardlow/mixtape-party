import type { ServiceName } from './rounds';

// Sticker Pop: one bold light palette (no dark mode), 3px ink outlines and hard offset shadows.
// Key names are the ones the screens already use, so restyling stays in here and in ui.tsx.
const theme = {
  bg: '#FFD93D', // Sunshine
  shell: '#FFFFFF',
  shellPressed: '#FFF3B8',
  ink: '#1A1033',
  inkMuted: '#4A3F6B',
  hairline: '#1A1033',
  reel: '#1A1033',
  accent: '#FF4F9A', // Bubblegum
  accentInk: '#1A1033',
  danger: '#B3124F', // accent is too light to read as text on Sunshine
  cobalt: '#3D5AFE',
  mint: '#5EEAD4',
  tangerine: '#FF8A3D',
  border: 3,
  radius: 20,
  shadow: 4,
  font: { display: 'BagelFatOne_400Regular', body: 'CourierPrime_400Regular', bold: 'CourierPrime_700Bold' },
};

export type Theme = typeof theme;

export function useTheme(): Theme {
  return theme;
}

export const SERVICE_META: Record<ServiceName, { label: string; color: string }> = {
  youtube_music: { label: 'YouTube Music', color: '#FF0000' },
  bandcamp: { label: 'Bandcamp', color: '#1DA0C3' },
};
