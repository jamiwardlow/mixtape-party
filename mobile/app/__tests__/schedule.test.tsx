import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import LeagueSchedule from '../league/[leagueId]/schedule';
import { formatDeadline } from '../../lib/ui';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => ({ leagueId: 'league-1' }),
}));

jest.mock('../../lib/session', () => ({
  useSession: () => ({ token: 'tok-1' }),
}));

const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

// Round 1 is over, round 2 is mid-guessing (its submission window shut), round 3 is untouched.
const rounds = [
  { id: 'r1', number: 1, theme: 'One-hit wonders', submissionDeadline: at(-14), guessingDeadline: at(-7) },
  { id: 'r2', number: 2, theme: null, submissionDeadline: at(-7), guessingDeadline: at(7) },
  { id: 'r3', number: 3, theme: null, submissionDeadline: at(7), guessingDeadline: at(14) },
];

function stubApi(isHost: boolean) {
  globalThis.fetch = jest.fn(async (_url: string, opts?: { method?: string }) =>
    opts?.method === 'PATCH'
      ? new Response(JSON.stringify({ round: { ...rounds[2], theme: 'Deep cuts' } }), { status: 200 })
      : new Response(JSON.stringify({ isHost, rounds }), { status: 200 }),
  ) as unknown as typeof fetch;
}

// The iOS picker is a native view: it reports a pick as a `change` carrying the chosen instant.
function pick(testID: string, iso: string) {
  return fireEvent(screen.getByTestId(testID), 'change', {
    nativeEvent: { timestamp: new Date(iso).getTime(), utcOffset: 0 },
  });
}

const textOf = (testID: string) => screen.getByTestId(testID).props.children as string;

async function show(isHost: boolean) {
  stubApi(isHost);
  await render(<LeagueSchedule />);
  await screen.findByTestId('round-1-heading');
}

function lastBody() {
  const calls = (fetch as jest.Mock).mock.calls;
  return JSON.parse(calls[calls.length - 1][1].body);
}

beforeEach(() => jest.clearAllMocks());

it('lists every round the API returns, in order, with both deadlines', async () => {
  await show(true);

  expect(screen.getAllByTestId(/^round-\d+-heading$/).map((n) => n.props.children)).toEqual([
    'Round 1',
    'Round 2',
    'Round 3',
  ]);
  expect(textOf('round-2-submission')).toBe(formatDeadline(new Date(rounds[1].submissionDeadline)));
  expect(textOf('round-2-guessing')).toBe(formatDeadline(new Date(rounds[1].guessingDeadline)));
});

// #74 creates rounds 2..N unnamed. Blank is a bug; "null" is worse.
it('prompts the host to name an unthemed round', async () => {
  await show(true);

  expect(screen.getAllByText('Set a theme')).toHaveLength(2);
  expect(screen.getByText('One-hit wonders')).toBeTruthy();
});

it('tells a member an unthemed round is simply not named yet', async () => {
  await show(false);

  expect(screen.getAllByText('Theme not set yet')).toHaveLength(2);
});

// The API 403s a non-host (#75); an edit button they can only be refused is a worse answer.
it('gives a member no edit control at all', async () => {
  await show(false);

  expect(screen.queryByText(/^Edit round/)).toBeNull();
});

// PATCH 409s a round whose guessing deadline has passed.
it('gives nobody an edit control on a round that is over, and says why', async () => {
  await show(true);

  expect(screen.queryByText('Edit round 1')).toBeNull();
  expect(screen.getByTestId('round-1-closed')).toBeTruthy();
  expect(screen.queryByTestId('round-3-closed')).toBeNull();
  expect(screen.getByText('Edit round 2')).toBeTruthy();
  expect(screen.getByText('Edit round 3')).toBeTruthy();
});

// Only what moved: PATCH validates a deadline only when the body names it, so echoing the
// preset schedule's own resting state back is how a no-op edit earns a 400.
it('patches the round the host edited with only the field they changed', async () => {
  await show(true);

  await fireEvent.press(screen.getByText('Edit round 3'));
  await fireEvent.changeText(screen.getByPlaceholderText('Theme'), 'Deep cuts');
  await fireEvent.press(screen.getByText('Save'));

  await waitFor(() => expect((fetch as jest.Mock).mock.calls).toHaveLength(2));
  const [url, init] = (fetch as jest.Mock).mock.calls[1];
  expect(String(url)).toContain('/rounds/r3');
  expect(init.method).toBe('PATCH');
  expect(lastBody()).toEqual({ theme: 'Deep cuts' });
});

// PATCH 409s a submission deadline that has already passed, so the round mid-guessing must not
// offer the field at all -- and the patch must not name it.
it('moves a mid-guessing round without naming its shut submission deadline', async () => {
  await show(true);

  await fireEvent.press(screen.getByText('Edit round 2'));
  expect(screen.queryByTestId('round-2-submission-field')).toBeNull();

  const moved = at(3);
  await pick('round-2-guessing-field', moved);
  await fireEvent.press(screen.getByText('Save'));

  await waitFor(() => expect((fetch as jest.Mock).mock.calls).toHaveLength(2));
  expect(lastBody()).toEqual({ guessingDeadline: moved });
});

it('shows the saved round once the patch lands', async () => {
  await show(true);

  await fireEvent.press(screen.getByText('Edit round 3'));
  await fireEvent.changeText(screen.getByPlaceholderText('Theme'), 'Deep cuts');
  await fireEvent.press(screen.getByText('Save'));

  expect(await screen.findByText('Deep cuts')).toBeTruthy();
});
