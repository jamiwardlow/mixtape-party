import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SignIn from '../sign-in';
import * as WebBrowser from 'expo-web-browser';
import * as AppleAuthentication from 'expo-apple-authentication';
import { API_URL } from '../../lib/api';

jest.mock('expo-crypto', () => {
  const nodeCrypto = require('node:crypto');
  return {
    getRandomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
    digestStringAsync: async (_alg: string, data: string) => nodeCrypto.createHash('sha256').update(data).digest('base64'),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { BASE64: 'base64' },
  };
});
jest.mock('expo-apple-authentication', () => ({
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const mockSignIn = jest.fn();
const mockPush = jest.fn();
let mockParams: { error?: string; mode?: string } = {};

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../../lib/session', () => ({
  useSession: () => ({ signIn: mockSignIn }),
}));

function ok(body: unknown = { token: 'tok-1' }) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function apiError(error: string, status = 409) {
  return new Response(JSON.stringify({ error }), { status });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  globalThis.fetch = jest.fn(async () => ok()) as unknown as typeof fetch;
});

// render, press and changeText are all async in RNTL v14 — an un-awaited call renders outside
// act() and the next query fails with "`render` function has not been called".
const typeEmail = (email = 'jami@example.com') => fireEvent.changeText(screen.getByPlaceholderText('Email'), email);
const NO_CONTENT = () => new Response(null, { status: 204 });

async function openPasswordScreen(email = 'jami@example.com') {
  await typeEmail(email);
  await fireEvent.press(screen.getByText('Use a password instead'));
}

async function fillPassword(password = 'hunter22') {
  await fireEvent.changeText(screen.getByPlaceholderText('Password'), password);
}

describe('email first', () => {
  it('sends a magic link and shows the inbox state', async () => {
    (fetch as jest.Mock).mockResolvedValue(NO_CONTENT());
    await render(<SignIn />);
    await typeEmail();

    await fireEvent.press(screen.getByText('Email me a link'));

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/magic-links'), expect.objectContaining({ body: JSON.stringify({ email: 'jami@example.com' }) }));
    expect(await screen.findByText('Check your inbox.')).toBeTruthy();
    expect(screen.getByText('jami@example.com')).toBeTruthy();
  });

  it('rejects an empty or malformed email without calling the server', async () => {
    await render(<SignIn />);
    await fireEvent.press(screen.getByText('Email me a link'));
    expect(screen.getByText('Enter your email first')).toBeTruthy();

    await typeEmail('not-an-email');
    await fireEvent.press(screen.getByText('Email me a link'));
    expect(screen.getByText('Enter a valid email address')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('can resend, or go back to correct the address', async () => {
    (fetch as jest.Mock).mockResolvedValue(NO_CONTENT());
    await render(<SignIn />);
    await typeEmail();
    await fireEvent.press(screen.getByText('Email me a link'));
    await waitFor(() => screen.getByText('Resend link'));

    await fireEvent.press(screen.getByText('Resend link'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    await fireEvent.press(screen.getByText('Use a different email'));
    expect(screen.getByText('Email me a link')).toBeTruthy();
  });

  it('shows progress while the link sends', async () => {
    let release!: (r: Response) => void;
    (fetch as jest.Mock).mockReturnValue(new Promise<Response>((r) => { release = r; }));
    await render(<SignIn />);
    await typeEmail();
    const pending = fireEvent.press(screen.getByText('Email me a link'));
    await waitFor(() => expect(screen.getByText('Sending link…')).toBeDisabled());
    await act(async () => { release(NO_CONTENT()); await pending; });
    expect(screen.getByText('Check your inbox.')).toBeTruthy();
  });

  it('reports a network failure instead of rejecting', async () => {
    (fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    await render(<SignIn />);
    await typeEmail();
    await fireEvent.press(screen.getByText('Email me a link'));
    expect(await screen.findByText("Couldn't reach the server. Try again.")).toBeTruthy();
  });

  it('links to terms and privacy', async () => {
    await render(<SignIn />);
    await fireEvent.press(screen.getAllByText('Terms of Use')[0]);
    expect(mockPush).toHaveBeenCalledWith('/terms');
    await fireEvent.press(screen.getAllByText('Privacy Policy')[0]);
    expect(mockPush).toHaveBeenCalledWith('/privacy');
  });

  it('explains a bounced Google redirect and clears it on the first edit', async () => {
    mockParams = { error: 'google_cancelled' };
    await render(<SignIn />);
    expect(screen.getByText('Google sign-in was cancelled.')).toBeTruthy();
    await typeEmail('a@b.co');
    expect(screen.queryByText('Google sign-in was cancelled.')).toBeNull();
  });
});

// The mode decides which endpoint a submit hits -- crossing them wires "create account" to the
// login route, which fails for exactly the new users it is meant to serve.
describe('password screen', () => {
  it('signs in via /sessions and keeps the address from the first screen', async () => {
    await render(<SignIn />);
    await openPasswordScreen();
    expect(screen.getByText(/Signing in as jami@example\.com/)).toBeTruthy();
    await fillPassword();

    await fireEvent.press(screen.getByText('Sign in'));

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sessions'), expect.anything());
    expect(mockSignIn).toHaveBeenCalledWith('tok-1');
  });

  it('creates an account via /accounts from the password screen', async () => {
    await render(<SignIn />);
    await openPasswordScreen();
    await fireEvent.press(screen.getByText('Create account with a password'));
    await fillPassword();

    await fireEvent.press(screen.getByText('Create account'));

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/accounts'), expect.anything());
  });

  it('opens in create-account mode for ?mode=sign-up', async () => {
    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    expect(screen.getByPlaceholderText('Display name (optional)')).toBeTruthy();
    expect(screen.getByText('Create account')).toBeTruthy();
  });

  it('refuses an empty password', async () => {
    await render(<SignIn />);
    await openPasswordScreen();
    await fireEvent.press(screen.getByText('Sign in'));
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText('Enter your password')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('rejects a short password on create only', async () => {
    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    await typeEmail();
    await fillPassword('short');
    await fireEvent.press(screen.getByText('Create account'));
    expect(screen.getByText('Password must be at least 8 characters')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces the error the API sends back', async () => {
    (fetch as jest.Mock).mockResolvedValue(apiError('Email already registered'));
    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    await typeEmail();
    await fillPassword();
    await fireEvent.press(screen.getByText('Create account'));
    expect(screen.getByText('Email already registered')).toBeTruthy();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  // A cold-starting API can leave a request hanging for seconds; without the busy guard an
  // impatient second tap creates a second account.
  it('ignores extra presses while a request is in flight', async () => {
    let release!: (r: Response) => void;
    (fetch as jest.Mock).mockReturnValue(new Promise<Response>((r) => { release = r; }));
    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    await typeEmail();
    await fillPassword();

    const pending = fireEvent.press(screen.getByText('Create account'));
    await waitFor(() => expect(screen.getByText('Creating account…')).toBeDisabled());
    await fireEvent.press(screen.getByText('Creating account…'));

    await act(async () => { release(ok()); await pending; });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });

  it('hints the field by mode, toggles visibility and submits on Enter', async () => {
    await render(<SignIn />);
    await openPasswordScreen();
    const pw = () => screen.getByPlaceholderText('Password');
    expect(pw().props.autoComplete).toBe('current-password');
    expect(pw().props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByText('Show password'));
    expect(pw().props.secureTextEntry).toBe(false);
    expect(screen.getByText('Hide password')).toBeTruthy();

    await fillPassword();
    await fireEvent(pw(), 'submitEditing');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sessions'), expect.anything());
  });

  it('offers recovery and a magic link, but recovery only to returning users', async () => {
    await render(<SignIn />);
    await openPasswordScreen();
    await fireEvent.press(screen.getByText('Forgot password?'));
    expect(mockPush).toHaveBeenCalledWith('/forgot-password');

    (fetch as jest.Mock).mockResolvedValue(NO_CONTENT());
    await fireEvent.press(screen.getByText('Email me a link instead'));
    expect(await screen.findByText('Check your inbox.')).toBeTruthy();

    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    expect(screen.queryByText('Forgot password?')).toBeNull();
  });
});

// A name at sign-up is optional -- this must not become a new way for creating an account to fail (#81).
describe('display name', () => {
  const NAME_FIELD = 'Display name (optional)';

  it('sends a trimmed name given at sign-up, capped at 40', async () => {
    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    await typeEmail();
    await fillPassword();
    expect(screen.getByPlaceholderText(NAME_FIELD).props.maxLength).toBe(40);
    await fireEvent.changeText(screen.getByPlaceholderText(NAME_FIELD), '  Sam  ');

    await fireEvent.press(screen.getByText('Create account'));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/accounts'),
      expect.objectContaining({ body: JSON.stringify({ email: 'jami@example.com', password: 'hunter22', displayName: 'Sam' }) }),
    );
  });

  it('signs up without one, and offers no name field to returning users', async () => {
    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    await typeEmail();
    await fillPassword();
    await fireEvent.press(screen.getByText('Create account'));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/accounts'),
      expect.objectContaining({ body: JSON.stringify({ email: 'jami@example.com', password: 'hunter22', displayName: null }) }),
    );

    await fireEvent.press(screen.getByText('I already have a password'));
    expect(screen.queryByPlaceholderText(NAME_FIELD)).toBeNull();
  });
});

describe('Google button on web', () => {
  const { Platform } = require('react-native');
  const original = Platform.OS;
  afterEach(() => { Platform.OS = original; });
  // Platform.OS is faked to 'web' but jest-expo's window has no DOM event API.
  beforeEach(() => { Object.assign(window, { addEventListener: jest.fn(), removeEventListener: jest.fn() }); });

  it('renders beside Apple, after the email form', async () => {
    Platform.OS = 'web';
    await render(<SignIn />);
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('"Google"')).toBeGreaterThan(tree.indexOf('"Email"'));
  });
});

describe('Google button on native', () => {
  const open = WebBrowser.openAuthSessionAsync as jest.Mock;

  it('opens an auth session with the native return URL and exchanges the returned token', async () => {
    open.mockResolvedValue({ type: 'success', url: 'mixtapeparty://auth/complete#t=abc123' });
    await render(<SignIn />);
    await fireEvent.press(screen.getByText('Google'));
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const { t, v } = mockPush.mock.calls[0][0].params;
    expect(t).toBe('abc123');
    // The challenge sent to the API is the S256 of the verifier handed to /auth/complete.
    const challenge = require('node:crypto').createHash('sha256').update(v).digest('base64url');
    expect(open.mock.calls[0][0]).toBe(
      `${API_URL}/auth/google/start?return=mixtapeparty%3A%2F%2Fauth%2Fcomplete&code_challenge=${challenge}`,
    );
    expect(open.mock.calls[0][1]).toBe('mixtapeparty://auth/complete');
  });

  it('uses the native Apple sheet on iOS and posts the identity token', async () => {
    (AppleAuthentication.signInAsync as jest.Mock).mockResolvedValue({ identityToken: 'jwt', fullName: { givenName: 'Ada', familyName: 'Lovelace' } });
    await render(<SignIn />);
    await fireEvent.press(screen.getByText('Apple'));
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('tok-1'));
    expect(open).not.toHaveBeenCalled();
    const [url, init] = (fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/auth/apple/native');
    expect(JSON.parse(init.body)).toEqual({ identityToken: 'jwt', fullName: 'Ada Lovelace' });
  });

  it('shows a cancelled note when the Apple sheet is dismissed', async () => {
    (AppleAuthentication.signInAsync as jest.Mock).mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    await render(<SignIn />);
    await fireEvent.press(screen.getByText('Apple'));
    expect(await screen.findByText('Apple sign-in was cancelled.')).toBeTruthy();
  });

  it('shows the error when Google bounces back without a token', async () => {
    open.mockResolvedValue({ type: 'success', url: 'mixtapeparty://auth/complete#error=google_cancelled' });
    await render(<SignIn />);
    await fireEvent.press(screen.getByText('Google'));
    expect(await screen.findByText('Google sign-in was cancelled.')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('stays quiet when the user dismisses the browser', async () => {
    open.mockResolvedValue({ type: 'dismiss' });
    await render(<SignIn />);
    await fireEvent.press(screen.getByText('Google'));
    await waitFor(() => expect(screen.getByText('Google')).toBeTruthy());
    expect(mockPush).not.toHaveBeenCalled();
  });
});

