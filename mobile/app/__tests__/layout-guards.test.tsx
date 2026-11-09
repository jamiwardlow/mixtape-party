import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { Text } from 'react-native';
import RootLayout from '../_layout';
import Index from '../index';
import ResetPassword from '../reset-password';
import { useSession } from '../../lib/session';

const mockStore = new Map<string, string>();
jest.mock('../../lib/storage', () => ({
  deviceStorage: {
    get: async (k: string) => mockStore.get(k) ?? null,
    set: async (k: string, v: string | null) => void (v ? mockStore.set(k, v) : mockStore.delete(k)),
  },
}));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('../../lib/notificationTap', () => ({ useOpenTappedNotification: () => {} }));
jest.mock('../../lib/pushToken', () => ({ useRegisterPushToken: () => {}, unregisterPushToken: async () => {} }));

function Home() {
  const { signOut } = useSession();
  return <Text onPress={signOut}>HOME</Text>;
}

beforeEach(() => {
  mockStore.clear();
  globalThis.fetch = jest.fn(async (url: string) =>
    new Response(JSON.stringify(String(url).includes('/password-resets/confirm') ? { token: 'session-1' } : {}), { status: 200 }),
  ) as unknown as typeof fetch;
});

it('signing out after a password reset lands on sign-in, not reset-password (#192)', async () => {
  await renderRouter(
    {
      _layout: RootLayout,
      index: Index,
      home: Home,
      'sign-in': () => <Text>SIGN IN</Text>,
      'reset-password': ResetPassword,
      'forgot-password': () => <Text>FORGOT</Text>,
    },
    { initialUrl: '/' },
  );
  // Warm open: the user is on sign-in, taps forgot password, then opens the emailed link.
  await screen.findByText('SIGN IN');
  await act(async () => router.push('/forgot-password'));
  await act(async () => router.push('/reset-password?token=abc'));

  await fireEvent.changeText(await screen.findByPlaceholderText('New password'), 'hunter2hunter2');
  await fireEvent.press(screen.getByText('Set password and sign in'));
  await screen.findByText('HOME', {}, { timeout: 3000 });

  await fireEvent.press(screen.getByText('HOME'));
  await waitFor(() => expect(screen.getByText('SIGN IN')).toBeTruthy());
  expect(screen.queryByText('Set password and sign in')).toBeNull();
});
