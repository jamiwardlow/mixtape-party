import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Settings from '../settings';
import * as appleMusic from '../../lib/appleMusic';

const mockLink = appleMusic.linkAppleMusic as jest.Mock;
const mockRefreshProfile = jest.fn();
let mockProfile: { id: string; email: string; services?: { service: string }[] } | null;

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
