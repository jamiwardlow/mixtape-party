import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Settings from '../settings';
import * as appleMusic from '../../lib/appleMusic';

const mockLink = appleMusic.linkAppleMusic as jest.Mock;
const mockRefreshProfile = jest.fn();
let mockProfile: { id: string; email: string; displayName?: string | null; services?: { service: string }[] } | null;

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));

// __esModule matters: without it babel's interop hands the test a *copy* of the module object and
// jest.replaceProperty below would patch something the screen never reads.
jest.mock('../../lib/appleMusic', () => ({
  ...jest.requireActual('../../lib/appleMusic'),
  __esModule: true,
  appleMusicLinkingSupported: true,
  linkAppleMusic: jest.fn(),
}));

jest.mock('../../lib/session', () => ({
  useSession: () => ({ token: 'session-tok', profile: mockProfile, refreshProfile: mockRefreshProfile }),
}));

// jest.replaceProperty below is not undone by clearAllMocks -- without this, every test appended
// after it silently runs with appleMusicLinkingSupported false.
afterEach(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockProfile = { id: 'a1', email: 'jami@example.com', services: [] };
  mockLink.mockResolvedValue(undefined);
  globalThis.fetch = jest.fn(async () => new Response(JSON.stringify(mockProfile), { status: 200 })) as unknown as typeof fetch;
});

it('links Apple Music and reloads the profile so the screen reflects it', async () => {
  await render(<Settings />);

  await fireEvent.press(screen.getByText('Link Apple Music'));

  await waitFor(() => expect(mockLink).toHaveBeenCalledWith('session-tok'));
  expect(mockRefreshProfile).toHaveBeenCalled();
});

// A failed link has to say so: authorize() rejects for a cancelled popup and for an account with
// no subscription, and a silent no-op looks identical to a successful link.
it('shows why a link failed', async () => {
  mockLink.mockRejectedValue(new Error('Apple Music sign-in did not finish.'));

  await render(<Settings />);
  await fireEvent.press(screen.getByText('Link Apple Music'));

  expect(await screen.findByText('Apple Music sign-in did not finish.')).toBeTruthy();
});

it('shows the linked state and keeps re-linking reachable', async () => {
  mockProfile = { id: 'a1', email: 'jami@example.com', services: [{ service: 'apple_music' }] };

  await render(<Settings />);

  expect(screen.getByText(/Apple Music is linked/)).toBeTruthy();
  expect(screen.getByText('Relink Apple Music')).toBeTruthy();
});

it('explains the web-only limitation instead of offering a dead button on native', async () => {
  jest.replaceProperty(appleMusic, 'appleMusicLinkingSupported', false);

  await render(<Settings />);

  expect(screen.queryByText('Link Apple Music')).toBeNull();
  expect(screen.getByText(/web/)).toBeTruthy();
});

// Settings is the only route back for the accounts that already exist with a null name, which is
// nearly all of them -- a broken save here means shipping display names fixes nothing for anyone
// who already signed up.
describe('display name', () => {
  const save = () => fireEvent.press(screen.getByText('Save name'));

  it('seeds the field from the profile', async () => {
    mockProfile = { id: 'a1', email: 'jami@example.com', displayName: 'Sam', services: [] };

    await render(<Settings />);

    expect(screen.getByDisplayValue('Sam')).toBeTruthy();
  });

  it('patches the trimmed name and re-reads the profile so the change shows without a sign-out', async () => {
    await render(<Settings />);
    await fireEvent.changeText(screen.getByPlaceholderText('Display name'), '  Sam  ');

    await save();

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/accounts/me'),
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ displayName: 'Sam' }) }),
      ),
    );
    expect(mockRefreshProfile).toHaveBeenCalled();
  });

  // The API rejects a whitespace-only name with a 400; catching it here says so without a round
  // trip, and without the user reading a raw validation string.
  it('refuses to send an empty name', async () => {
    await render(<Settings />);
    await fireEvent.changeText(screen.getByPlaceholderText('Display name'), '   ');

    await save();

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a name first.')).toBeTruthy();
  });

  it('surfaces the error the API sends back', async () => {
    (fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ error: 'displayName must be 1-40 characters' }), { status: 400 }),
    );
    await render(<Settings />);
    await fireEvent.changeText(screen.getByPlaceholderText('Display name'), 'x'.repeat(41));

    await save();

    expect(await screen.findByText('displayName must be 1-40 characters')).toBeTruthy();
    expect(mockRefreshProfile).not.toHaveBeenCalled();
  });
});
