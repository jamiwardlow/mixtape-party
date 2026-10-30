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
async function fillCredentials(email = 'jami@example.com', password = 'hunter22') {
  await fireEvent.changeText(screen.getByPlaceholderText('Email'), email);
  await fireEvent.changeText(screen.getByPlaceholderText('Password'), password);
}

const switchToSignUp = () => fireEvent.press(screen.getByText('Create account'));
const switchToSignIn = () => fireEvent.press(screen.getByText('Sign in'));

// The mode branch decides which endpoint a submit hits -- crossing them wires "create account"
// to the login route, which fails for exactly the new users it is meant to serve.
describe('submit', () => {
  it('posts to /sessions by default and /accounts after switching', async () => {
    await render(<SignIn />);
    await fillCredentials();

    await fireEvent.press(screen.getByText('Continue'));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sessions'), expect.anything());

    await switchToSignUp();
    await fireEvent.press(screen.getByText('Continue'));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/accounts'), expect.anything());
  });

  it('signs in with the returned token', async () => {
    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    await fillCredentials();

    await fireEvent.press(screen.getByText('Continue'));

    expect(mockSignIn).toHaveBeenCalledWith('tok-1');
  });

  it('refuses to post empty credentials', async () => {
    await render(<SignIn />);

    await fireEvent.press(screen.getByText('Continue'));

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText('Enter your email and password')).toBeTruthy();
  });

  it('surfaces the error the API sends back', async () => {
    (fetch as jest.Mock).mockResolvedValue(apiError('Email already registered'));
    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    await fillCredentials();

    await fireEvent.press(screen.getByText('Continue'));

    expect(screen.getByText('Email already registered')).toBeTruthy();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  // A cold-starting API can leave a request hanging for seconds; without the busy guard an
  // impatient second tap creates a second account.
  it('disables submit and ignores extra presses while a request is in flight', async () => {
    let release!: (r: Response) => void;
    (fetch as jest.Mock).mockReturnValue(new Promise<Response>((r) => { release = r; }));
    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    await fillCredentials();

    // Deliberately not awaited: the handler is parked on a fetch that has not settled, so the
    // act() scope this opens only closes once release() is called below.
    const pending = fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(screen.getByText('Creating account…')).toBeDisabled());
    await fireEvent.press(screen.getByText('Creating account…'));

    await act(async () => { release(ok()); await pending; });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });

  it('reports a network failure instead of rejecting', async () => {
    (fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    await fillCredentials();

    await fireEvent.press(screen.getByText('Continue'));

    expect(screen.getByText("Couldn't reach the server. Try again.")).toBeTruthy();
  });
});

// A name at sign-up is the cheapest moment to get one, but it is optional -- this must not become
// a new way for creating an account to fail (#81).
describe('display name', () => {
  const NAME_FIELD = 'Display name (optional)';

  it('sends a name given at sign-up', async () => {
    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    await fillCredentials();
    await fireEvent.changeText(screen.getByPlaceholderText(NAME_FIELD), '  Sam  ');

    await fireEvent.press(screen.getByText('Continue'));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/accounts'),
      expect.objectContaining({ body: JSON.stringify({ email: 'jami@example.com', password: 'hunter22', displayName: 'Sam' }) }),
    );
  });

  it('signs up without one', async () => {
    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    await fillCredentials();

    await fireEvent.press(screen.getByText('Continue'));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/accounts'),
      expect.objectContaining({ body: JSON.stringify({ email: 'jami@example.com', password: 'hunter22', displayName: null }) }),
    );
    expect(mockSignIn).toHaveBeenCalledWith('tok-1');
  });

  // /sessions has no use for it, and signing in is not a rename.
  it('offers no name field to returning users', async () => {
    await render(<SignIn />);
    await switchToSignIn();

    expect(screen.queryByPlaceholderText(NAME_FIELD)).toBeNull();
  });
});

describe('stale state', () => {
  // The note interpolates the live field, so leaving it up after an edit names an address the
  // link was never sent to.
  it('drops the sent-link note when the address changes', async () => {
    (fetch as jest.Mock).mockResolvedValue(new Response(null, { status: 204 }));
    await render(<SignIn />);
    await fireEvent.changeText(screen.getByPlaceholderText('Email'), 'jami@example.com');

    await fireEvent.press(screen.getByText('Email me a sign-in link'));
    await waitFor(() => expect(screen.getByText(/Check jami@example\.com/)).toBeTruthy());

    await fireEvent.changeText(screen.getByPlaceholderText('Email'), 'someone@else.com');

    expect(screen.queryByText(/^Check /)).toBeNull();
    expect(screen.getByText('Email me a sign-in link')).toBeTruthy();
  });

  it('clears the error when switching mode', async () => {
    (fetch as jest.Mock).mockResolvedValue(apiError('Email already registered'));
    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    await fillCredentials();
    await fireEvent.press(screen.getByText('Continue'));

    await switchToSignIn();

    expect(screen.queryByText('Email already registered')).toBeNull();
  });
});

describe('magic link', () => {
  it('warns that an unknown address becomes a new account', async () => {
    await render(<SignIn />);
    expect(screen.getByText(/We'll create one/)).toBeTruthy();
  });

  it('can resend, or go back to correct the address', async () => {
    (fetch as jest.Mock).mockResolvedValue(new Response(null, { status: 204 }));
    await render(<SignIn />);
    await fireEvent.changeText(screen.getByPlaceholderText('Email'), 'jami@example.com');
    await fireEvent.press(screen.getByText('Email me a sign-in link'));
    await waitFor(() => screen.getByText('Resend link'));

    await fireEvent.press(screen.getByText('Resend link'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    await fireEvent.press(screen.getByText('Use a different email'));
    expect(screen.getByText('Email me a sign-in link')).toBeTruthy();
  });
});

describe('initial mode', () => {
  it('defaults to sign-in', async () => {
    await render(<SignIn />);
    expect(screen.getByText('Forgot password?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeSelected();
  });

  it('opens on Create account for ?mode=sign-up', async () => {
    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    expect(screen.getByRole('button', { name: 'Create account' })).toBeSelected();
  });
});

describe('terms acknowledgement', () => {
  it('shows linked terms and privacy on sign-up only', async () => {
    await render(<SignIn />);
    expect(screen.queryByText(/By creating an account/)).toBeNull();
    await switchToSignUp();
    expect(screen.getByText(/By creating an account/)).toBeTruthy();
    await fireEvent.press(screen.getAllByText('Terms of Use')[0]);
    expect(mockPush).toHaveBeenCalledWith('/terms');
    await fireEvent.press(screen.getAllByText('Privacy Policy')[0]);
    expect(mockPush).toHaveBeenCalledWith('/privacy');
  });
});

describe('link layout', () => {
  // Nothing to recover in sign-up mode -- the account does not exist yet.
  it('offers password recovery only to returning users', async () => {
    mockParams = { mode: 'sign-up' };
    await render(<SignIn />);
    expect(screen.queryByText('Forgot password?')).toBeNull();

    await switchToSignIn();

    await fireEvent.press(screen.getByText('Forgot password?'));
    expect(mockPush).toHaveBeenCalledWith('/forgot-password');
  });

  it('explains a bounced Google redirect', async () => {
    mockParams = { error: 'google_cancelled' };
    await render(<SignIn />);
    expect(screen.getByText('Google sign-in was cancelled.')).toBeTruthy();
  });

  it('clears the Google error on the first edit', async () => {
    mockParams = { error: 'google_failed' };
    await render(<SignIn />);
    await fireEvent.changeText(screen.getByPlaceholderText('Email'), 'a@b.co');
    expect(screen.queryByText('Google sign-in failed. Try again.')).toBeNull();
  });
});

describe('Google button on web', () => {
  const { Platform } = require('react-native');
  const original = Platform.OS;
  afterEach(() => { Platform.OS = original; });
  // Platform.OS is faked to 'web' but jest-expo's window has no DOM event API.
  beforeEach(() => { Object.assign(window, { addEventListener: jest.fn(), removeEventListener: jest.fn() }); });

  it('comes before the email form', async () => {
    Platform.OS = 'web';
    await render(<SignIn />);
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('Continue with Google')).toBeGreaterThan(-1);
    expect(tree.indexOf('Continue with Google')).toBeLessThan(tree.indexOf('"Email"'));
  });
});

describe('Google button on native', () => {
  const open = WebBrowser.openAuthSessionAsync as jest.Mock;

  it('opens an auth session with the native return URL and exchanges the returned token', async () => {
    open.mockResolvedValue({ type: 'success', url: 'mixtapeparty://auth/complete#t=abc123' });
    await render(<SignIn />);
    await fireEvent.press(screen.getByText('Continue with Google'));
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
    await fireEvent.press(screen.getByText('Continue with Apple'));
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('tok-1'));
    expect(open).not.toHaveBeenCalled();
    const [url, init] = (fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/auth/apple/native');
    expect(JSON.parse(init.body)).toEqual({ identityToken: 'jwt', fullName: 'Ada Lovelace' });
  });

  it('shows a cancelled note when the Apple sheet is dismissed', async () => {
    (AppleAuthentication.signInAsync as jest.Mock).mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    await render(<SignIn />);
    await fireEvent.press(screen.getByText('Continue with Apple'));
    expect(await screen.findByText('Apple sign-in was cancelled.')).toBeTruthy();
  });

  it('shows the error when Google bounces back without a token', async () => {
    open.mockResolvedValue({ type: 'success', url: 'mixtapeparty://auth/complete#error=google_cancelled' });
    await render(<SignIn />);
    await fireEvent.press(screen.getByText('Continue with Google'));
    expect(await screen.findByText('Google sign-in was cancelled.')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('stays quiet when the user dismisses the browser', async () => {
    open.mockResolvedValue({ type: 'dismiss' });
    await render(<SignIn />);
    await fireEvent.press(screen.getByText('Continue with Google'));
    await waitFor(() => expect(screen.getByText('Continue with Google')).toBeTruthy());
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('autofill and keyboard', () => {
  it('hints the password field by mode and toggles visibility', async () => {
    await render(<SignIn />);
    const pw = () => screen.getByPlaceholderText('Password');
    expect(pw().props.autoComplete).toBe('current-password');
    expect(pw().props.secureTextEntry).toBe(true);

    await switchToSignUp();
    expect(pw().props.autoComplete).toBe('new-password');

    await fireEvent.press(screen.getByText('Show password'));
    expect(pw().props.secureTextEntry).toBe(false);
    expect(screen.getByText('Hide password')).toBeTruthy();
  });

  it('submits from the password field on Enter in sign-in mode', async () => {
    await render(<SignIn />);
    await fillCredentials();
    await fireEvent(screen.getByPlaceholderText('Password'), 'submitEditing');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sessions'), expect.anything());
  });
});

describe('validation and a11y', () => {
  it('rejects a malformed email without calling the server', async () => {
    await render(<SignIn />);
    await fillCredentials('not-an-email');
    await fireEvent.press(screen.getByText('Continue'));
    expect(screen.getByText('Enter a valid email address')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a short password on sign-up only', async () => {
    await render(<SignIn />);
    await switchToSignUp();
    await fillCredentials('jami@example.com', 'short');
    await fireEvent.press(screen.getByText('Continue'));
    expect(screen.getByText('Password must be at least 8 characters')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('labels fields and announces errors', async () => {
    await render(<SignIn />);
    expect(screen.getByLabelText('Email')).toBeTruthy();
    await fireEvent.press(screen.getByText('Continue'));
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('shows progress on the sign-in link while it sends', async () => {
    let release!: (r: Response) => void;
    (fetch as jest.Mock).mockReturnValue(new Promise<Response>((r) => { release = r; }));
    await render(<SignIn />);
    await fireEvent.changeText(screen.getByPlaceholderText('Email'), 'jami@example.com');
    const pending = fireEvent.press(screen.getByText('Email me a sign-in link'));
    await waitFor(() => expect(screen.getByText('Sending link…')).toBeTruthy());
    expect(screen.getByText('Continue')).toBeTruthy(); // not mislabelled as signing in
    await act(async () => { release(new Response(null, { status: 204 })); await pending; });
    expect(screen.getByText('Resend link')).toBeTruthy();
  });
});
