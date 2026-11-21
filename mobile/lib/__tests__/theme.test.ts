import * as RN from 'react-native';
import { useTheme } from '../theme';

test('useTheme follows the system scheme; accent text stays dark', () => {
  const spy = jest.spyOn(RN, 'useColorScheme');
  spy.mockReturnValue('dark');
  const dark = useTheme(); // only hook inside is the mocked one, so a bare call is fine
  spy.mockReturnValue('light');
  const light = useTheme();
  expect(dark.bg).toBe('#2A1A5E');
  expect(dark.shadowColor).toBe(dark.ink);
  expect(light.bg).toBe('#FFD93D');
  expect(dark.accentInk).toBe(light.accentInk);
});
