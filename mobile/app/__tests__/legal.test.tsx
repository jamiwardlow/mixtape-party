import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { LegalLinks } from '../../lib/legal';
import DeleteAccount from '../delete-account';
import Privacy from '../privacy';
import Terms from '../terms';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() } }));

test('links route to /privacy and /terms', async () => {
  await render(<LegalLinks />);
  await fireEvent.press(screen.getByText('Privacy Policy'));
  await fireEvent.press(screen.getByText('Terms of Use'));
  expect(router.push).toHaveBeenCalledWith('/privacy');
  expect(router.push).toHaveBeenCalledWith('/terms');
});

test('policy names the real data and third parties', async () => {
  await render(<Privacy />);
  for (const word of ['Resend', 'Expo push token', 'Google:', 'Neon', 'delete your account']) {
    expect(screen.getByText(new RegExp(word))).toBeTruthy();
  }
});

test('terms render', async () => {
  await render(<Terms />);
  expect(screen.getByText('Be good to your league')).toBeTruthy();
});

test('delete-account page explains the in-app path', async () => {
  await render(<DeleteAccount />);
  expect(screen.getByText('In the app')).toBeTruthy();
});
