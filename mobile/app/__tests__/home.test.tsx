import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import Home from '../home';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

let mockProfile: { email: string; displayName?: string | null } = { email: 'ada@example.com' };
const mockRefresh = jest.fn();
jest.mock('../../lib/storage', () => ({
  deviceStorage: { get: jest.fn(async () => null), set: jest.fn(async () => {}) },
}));

jest.mock('../../lib/session', () => ({
  useSession: () => ({
    profile: mockProfile,
    refreshProfile: mockRefresh,
    token: 'tok-1',
    signOut: jest.fn(),
    pendingInviteCode: null,
    setPendingInviteCode: jest.fn(),
  }),
}));

const leagues = [
  {
    id: 'league-1',
    name: 'Office League',
    round: { id: 'r2', number: 2, theme: 'Songs about rain', phase: 'guessing' },
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockProfile = { email: 'ada@example.com' };
  globalThis.fetch = jest.fn(
    async () => new Response(JSON.stringify({ leagues }), { status: 200 }),
  ) as unknown as typeof fetch;
});

// The shelf delegates to the hub now: one tap, into the season page that owns the phase CTA.
it('opens the season page for a league, not the phase screen', async () => {
  await render(<Home />);

  fireEvent.press(await screen.findByText(/Office League/));

  expect(router.push).toHaveBeenCalledWith({ pathname: '/league/[leagueId]', params: { leagueId: 'league-1' } });
});

// Where the tap goes changed; what the card says did not — the shelf still reads at a glance.
it('still says which phase each league is in', async () => {
  await render(<Home />);

  expect(await screen.findByText(/Guess the submitters/)).toBeTruthy();
});

// Two buttons per card to two league screens is the shelf becoming the hub it delegates to.
it('no longer offers a second route into the same league', async () => {
  await render(<Home />);
  await screen.findByText(/Office League/);

  expect(screen.queryByText('Season schedule')).toBeNull();
});

it('opens the season wrap-up for a concluded league', async () => {
  globalThis.fetch = jest.fn(
    async () => new Response(JSON.stringify({ leagues: [{ ...leagues[0], concluded: true }] }), { status: 200 }),
  ) as unknown as typeof fetch;
  await render(<Home />);

  fireEvent.press(await screen.findByText(/Office League/));

  expect(router.push).toHaveBeenCalledWith({ pathname: '/league/[leagueId]/final', params: { leagueId: 'league-1' } });
});

describe('name prompt', () => {
  it('asks a nameless account for a name and saves it', async () => {
    mockProfile = { email: 'ada@example.com', displayName: null };
    await render(<Home />);
    await fireEvent.changeText(await screen.findByPlaceholderText('Display name'), '  Ada ');

    await fireEvent.press(screen.getByText('Save name'));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/accounts/me'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ displayName: 'Ada' }) }),
    );
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('can be skipped, and never shows to a named account', async () => {
    mockProfile = { email: 'ada@example.com', displayName: null };
    await render(<Home />);
    await fireEvent.press(await screen.findByText('Skip'));
    expect(screen.queryByPlaceholderText('Display name')).toBeNull();
  });

  it('stays out of the way once a name is set', async () => {
    mockProfile = { email: 'ada@example.com', displayName: 'Ada' };
    await render(<Home />);
    expect(screen.queryByPlaceholderText('Display name')).toBeNull();
  });
});
