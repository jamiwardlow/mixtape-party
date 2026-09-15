import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import Home from '../home';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

jest.mock('../../lib/session', () => ({
  useSession: () => ({
    profile: { email: 'ada@example.com' },
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
    round: { id: 'r2', number: 2, theme: 'Songs about rain', phase: 'guessing', guessingOpen: true },
  },
];

beforeEach(() => {
  jest.clearAllMocks();
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

// The clock alone does not make a round guessable: until every track is in, the shelf says what
// the round is actually waiting for.
it('reads a still-collecting round as submissions in progress', async () => {
  globalThis.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({ leagues: [{ ...leagues[0], round: { ...leagues[0].round, guessingOpen: false } }] }),
        { status: 200 },
      ),
  ) as unknown as typeof fetch;

  await render(<Home />);

  expect(await screen.findByText(/Submissions in progress/)).toBeTruthy();
  expect(screen.queryByText(/Guess the submitters/)).toBeNull();
});

// Two buttons per card to two league screens is the shelf becoming the hub it delegates to.
it('no longer offers a second route into the same league', async () => {
  await render(<Home />);
  await screen.findByText(/Office League/);

  expect(screen.queryByText('Season schedule')).toBeNull();
});
