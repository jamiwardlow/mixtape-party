import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Settings from '../settings';

const mockRefreshProfile = jest.fn();
let mockProfile: { id: string; email: string; displayName?: string | null } | null;

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));

jest.mock('../../lib/session', () => ({
  useSession: () => ({ token: 'session-tok', profile: mockProfile, refreshProfile: mockRefreshProfile }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockProfile = { id: 'a1', email: 'jami@example.com' };
  globalThis.fetch = jest.fn(async () => new Response(JSON.stringify(mockProfile), { status: 200 })) as unknown as typeof fetch;
});

// Settings is the only route back for the accounts that already exist with a null name, which is
// nearly all of them -- a broken save here means shipping display names fixes nothing for anyone
// who already signed up.
describe('display name', () => {
  const save = () => fireEvent.press(screen.getByText('Save name'));

  it('seeds the field from the profile', async () => {
    mockProfile = { id: 'a1', email: 'jami@example.com', displayName: 'Sam' };

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
