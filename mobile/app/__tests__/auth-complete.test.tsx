import { render, waitFor } from '@testing-library/react-native';
import AuthComplete from '../auth/complete';

const mockReplace = jest.fn();
const mockSignIn = jest.fn();
let mockParams: { t?: string } = {};

jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../../lib/session', () => ({
  useSession: () => ({ signIn: mockSignIn, token: null }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  globalThis.fetch = jest.fn(async () => new Response(JSON.stringify({ token: 'session-1' }), { status: 200 })) as unknown as typeof fetch;
});

describe('auth/complete', () => {
  const { Platform } = require('react-native');
  const original = Platform.OS;
  afterEach(() => { Platform.OS = original; });

  it('exchanges the token passed as a route param on native', async () => {
    Platform.OS = 'ios';
    mockParams = { t: 'native-tok' };
    await render(<AuthComplete />);
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('session-1'));
    expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toEqual({ token: 'native-tok' });
  });

  it('exchanges the token from the URL fragment on web', async () => {
    Platform.OS = 'web';
    Object.assign(window, { location: { hash: '#t=web-tok', pathname: '/auth/complete', search: '' }, history: { replaceState: jest.fn() } });
    await render(<AuthComplete />);
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('session-1'));
    expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toEqual({ token: 'web-tok' });
  });
});
