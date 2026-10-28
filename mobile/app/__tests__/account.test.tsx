import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import Account from '../account';

const mockRefreshProfile = jest.fn();
let mockProfile: { id: string; email: string; displayName?: string | null } | null;

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));

jest.mock('../../lib/session', () => ({
  useSession: () => ({ token: 'session-tok', profile: mockProfile, refreshProfile: mockRefreshProfile }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockProfile = { id: 'a1', email: 'jami@example.com' };
  globalThis.fetch = jest.fn(async (url: string) =>
    new Response(
      JSON.stringify(url.includes('/notifications/settings') ? { pushEnabled: true, emailEnabled: true } : mockProfile),
      { status: 200 },
    ),
  ) as unknown as typeof fetch;
});

// My Account is the only route back for the accounts that already exist with a null name, which is
// nearly all of them -- a broken save here means shipping display names fixes nothing for anyone
// who already signed up.
describe('display name', () => {
  const save = () => fireEvent.press(screen.getByText('Save name'));

  it('seeds the field from the profile', async () => {
    mockProfile = { id: 'a1', email: 'jami@example.com', displayName: 'Sam' };

    await render(<Account />);

    expect(screen.getByDisplayValue('Sam')).toBeTruthy();
  });

  it('patches the trimmed name and re-reads the profile so the change shows without a sign-out', async () => {
    await render(<Account />);
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
    await render(<Account />);
    await fireEvent.changeText(screen.getByPlaceholderText('Display name'), '   ');

    await save();

    expect(fetch).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'PATCH' }));
    expect(screen.getByText('Enter a name first.')).toBeTruthy();
  });

  it('surfaces the error the API sends back', async () => {
    (fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ error: 'displayName must be 1-40 characters' }), { status: 400 }),
    );
    await render(<Account />);
    await fireEvent.changeText(screen.getByPlaceholderText('Display name'), 'x'.repeat(41));

    await save();

    expect(await screen.findByText('displayName must be 1-40 characters')).toBeTruthy();
    expect(mockRefreshProfile).not.toHaveBeenCalled();
  });
});

it('opens the favorites screen', async () => {
  await render(<Account />);

  await fireEvent.press(screen.getByText('Favorites'));

  expect(router.push).toHaveBeenCalledWith('/favorites');
});

describe('notification toggles', () => {
  const settings = (pushEnabled: boolean, emailEnabled: boolean) =>
    (fetch as jest.Mock).mockImplementation(async (url: string) =>
      new Response(JSON.stringify(url.includes('/notifications/settings') ? { pushEnabled, emailEnabled } : mockProfile), {
        status: 200,
      }),
    );
  const puts = () => (fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === 'PUT');

  it('renders the loaded values', async () => {
    settings(false, true);

    await render(<Account />);

    await waitFor(() => expect(screen.getByLabelText('Push notifications').props.value).toBe(false));
    expect(screen.getByLabelText('Email notifications').props.value).toBe(true);
  });

  it('says so when the settings fail to load', async () => {
    (fetch as jest.Mock).mockResolvedValue(new Response('{}', { status: 500 }));

    await render(<Account />);

    expect(await screen.findByText("Couldn't load your notification settings.")).toBeTruthy();
  });

  it('sends only the toggled field', async () => {
    await render(<Account />);

    await fireEvent(await screen.findByLabelText('Email notifications'), 'valueChange', false);

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0][0]).toContain('/notifications/settings');
    expect(puts()[0][1].body).toBe(JSON.stringify({ emailEnabled: false }));
    expect(screen.getByLabelText('Email notifications').props.value).toBe(false);
  });

  it('rolls back and shows an error when the save fails', async () => {
    (fetch as jest.Mock).mockImplementation(async (url: string, init?: { method?: string }) =>
      init?.method === 'PUT'
        ? new Response('{}', { status: 500 })
        : new Response(JSON.stringify(url.includes('/notifications/settings') ? { pushEnabled: true, emailEnabled: true } : mockProfile)),
    );
    await render(<Account />);

    await fireEvent(await screen.findByLabelText('Push notifications'), 'valueChange', false);

    expect(await screen.findByText("Couldn't save that setting. Try again.")).toBeTruthy();
    expect(screen.getByLabelText('Push notifications').props.value).toBe(true);
  });
});
