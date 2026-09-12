import { useColorScheme } from 'react-native';
import type { ServiceName } from './rounds';

// Placeholder chrome, not a design. The cassette/J-card visual world was pulled
// out while the rest of the app is being built; these are neutral OS-ish greys
// that follow the system light/dark setting. The key names are the ones the
// screens already use, so a real theme can drop straight back in here.
const light = {
  bg: '#ffffff',
  shell: '#f2f2f7',
  shellPressed: '#e5e5ea',
  ink: '#000000',
  inkMuted: '#6c6c70',
  hairline: '#c6c6c8',
  reel: '#c6c6c8',
  accent: '#007aff',
  accentInk: '#ffffff',
};

const dark: typeof light = {
  bg: '#000000',
  shell: '#1c1c1e',
  shellPressed: '#2c2c2e',
  ink: '#ffffff',
  inkMuted: '#98989f',
  hairline: '#38383a',
  reel: '#38383a',
  accent: '#0a84ff',
  accentInk: '#ffffff',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const SERVICE_META: Record<ServiceName, { label: string; color: string }> = {
  apple_music: { label: 'Apple Music', color: '#FA2D48' },
  youtube_music: { label: 'YouTube Music', color: '#FF0000' },
  bandcamp: { label: 'Bandcamp', color: '#1DA0C3' },
};
