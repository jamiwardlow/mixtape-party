import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SignIn from '../sign-in';

const mockSignIn = jest.fn();
const mockPush = jest.fn();
let mockParams: { error?: string } = {};

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
async function fillCredentials(email = 'jami@example.com', password = 'hunter2') {
  await fireEvent.changeText(screen.getByPlaceholderText('Email'), email);
  await fireEvent.changeText(screen.getByPlaceholderText('Password'), password);
}

const switchToSignIn = () => fireEvent.press(screen.getByText('Already have an account? Sign in'));

// The mode branch decides which endpoint a submit hits -- crossing them wires "create account"
// to the login route, which fails for exactly the new users it is meant to serve.
describe('submit', () => {
  it('posts to /accounts in sign-up mode and /sessions after switching', async () => {
    await render(<SignIn />);
    await fillCredentials();

    await fireEvent.press(screen.getByText('Create account'));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/accounts'), expect.anything());

    await switchToSignIn();
    await fireEvent.press(screen.getByText('Sign in'));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sessions'), expect.anything());
  });

  it('signs in with the returned token', async () => {
    await render(<SignIn />);
    await fillCredentials();

    await fireEvent.press(screen.getByText('Create account'));

    expect(mockSignIn).toHaveBeenCalledWith('tok-1');
  });

  it('refuses to post empty credentials', async () => {
    await render(<SignIn />);

    await fireEvent.press(screen.getByText('Create account'));

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText('Enter your email and password')).toBeTruthy();
  });

  it('surfaces the error the API sends back', async () => {
    (fetch as jest.Mock).mockResolvedValue(apiError('Email already registered'));
    await render(<SignIn />);
    await fillCredentials();

    await fireEvent.press(screen.getByText('Create account'));

    expect(screen.getByText('Email already registered')).toBeTruthy();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  // Render's free plan can leave a request hanging for seconds; without the busy guard an
  // impatient second tap creates a second account.
  it('disables submit and ignores extra presses while a request is in flight', async () => {
    let release!: (r: Response) => void;
    (fetch as jest.Mock).mockReturnValue(new Promise<Response>((r) => { release = r; }));
    await render(<SignIn />);
    await fillCredentials();

    // Deliberately not awaited: the handler is parked on a fetch that has not settled, so the
    // act() scope this opens only closes once release() is called below.
    const pending = fireEvent.press(screen.getByText('Create account'));
    await waitFor(() => expect(screen.getByText('Create account')).toBeDisabled());
    await fireEvent.press(screen.getByText('Create account'));

    await act(async () => { release(ok()); await pending; });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });

  it('reports a network failure instead of rejecting', async () => {
    (fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    await render(<SignIn />);
    await fillCredentials();

    await fireEvent.press(screen.getByText('Create account'));

    expect(screen.getByText("Couldn't reach the server. Try again.")).toBeTruthy();
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
    await render(<SignIn />);
    await fillCredentials();
    await fireEvent.press(screen.getByText('Create account'));

    await switchToSignIn();

    expect(screen.queryByText('Email already registered')).toBeNull();
  });
});

describe('link layout', () => {
  // Nothing to recover in sign-up mode -- the account does not exist yet.
  it('offers password recovery only to returning users', async () => {
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
});
