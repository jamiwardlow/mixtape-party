import { render, screen, waitFor } from '@testing-library/react-native';
import ResetPassword from '../reset-password';

let mockParams: { token?: string } = {};
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('../../lib/session', () => ({ useSession: () => ({ signIn: jest.fn() }) }));

beforeEach(() => {
  mockParams = { token: 'tok' };
});

it('shows the expired screen up front when the token is no longer live', async () => {
  globalThis.fetch = jest.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch;
  await render(<ResetPassword />);
  expect(await screen.findByText(/expired or was already used/)).toBeTruthy();
});

it('shows the password form when the token is live', async () => {
  globalThis.fetch = jest.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
  await render(<ResetPassword />);
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  expect(screen.getByPlaceholderText('New password')).toBeTruthy();
});
