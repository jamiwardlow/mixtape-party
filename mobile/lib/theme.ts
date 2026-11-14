import { useColorScheme } from 'react-native';
import type { ServiceName } from './rounds';

// Sticker Pop: a bold light palette and a die-cut dark one (DESIGN.md "Dark mode"), 3px ink outlines and hard offset shadows.
// Key names are the ones the screens already use, so restyling stays in here and in ui.tsx.
const light = {
  bg: '#FFD93D', // Sunshine
  shell: '#FFFFFF',
  shellPressed: '#FFF3B8',
  ink: '#1A1033',
  shadowColor: '#1A1033',
  inkMuted: '#4A3F6B',
  hairline: '#1A1033',
  reel: '#1A1033',
  accent: '#FF4F9A', // Bubblegum
  accentInk: '#1A1033', // text on any accent fill; stays dark in both schemes
  scrim: 'rgba(0,0,0,0.35)',
  onScrim: '#FFFFFF',
  danger: '#B3124F', // accent is too light to read as text on Sunshine
  cobalt: '#3D5AFE',
  mint: '#5EEAD4',
  tangerine: '#FF8A3D',
  border: 3,
  radius: 20,
  shadow: 4,
  font: { display: 'BagelFatOne_400Regular', body: 'CourierPrime_400Regular', bold: 'CourierPrime_700Bold' },
};

export type Theme = typeof light;

const dark: Theme = {
  ...light,
  bg: '#052A3D',
  shell: '#0C3D55',
  shellPressed: '#165069',
  ink: '#FFFDF5',
  shadowColor: '#FFFDF5',
  inkMuted: '#A8D3E0',
  hairline: '#FFFDF5',
  reel: '#FFFDF5',
  danger: '#FF7AA8',
  cobalt: '#8C9EFF',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

const SERVICE_COLOR = {
  light: { youtube_music: '#FF0000', bandcamp: '#1DA0C3' },
  dark: { youtube_music: '#FF8080', bandcamp: '#3FC0E3' },
};

/** Badge color for a service in the current scheme. */
export function useServiceColor(service: ServiceName): string | undefined {
  return SERVICE_COLOR[useColorScheme() === 'dark' ? 'dark' : 'light'][service];
}

export const SERVICE_META: Record<ServiceName, { label: string }> = {
  youtube_music: { label: 'YouTube Music' },
  bandcamp: { label: 'Bandcamp' },
};
