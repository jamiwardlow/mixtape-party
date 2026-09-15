import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import RoundOverview from '../round/[roundId]/index';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ roundId: 'r2' }),
}));

jest.mock('../../lib/session', () => ({
  useSession: () => ({ token: 'tok-1' }),
}));

const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const ada = { accountId: 'a', displayName: 'Ada' };
const bo = { accountId: 'b', displayName: 'Bo' };
const cy = { accountId: 'c', displayName: 'Cy' };
const di = { accountId: 'd', displayName: 'Di' };
const roster = [ada, bo, cy, di];

/** Mid-submission: three of four are in, and the server names them. */
const submissionRound = {
  id: 'r2',
  number: 2,
  theme: 'Songs about rain',
  submissionDeadline: at(1),
  guessingDeadline: at(7),
  phase: 'submission',
  submittedCount: 3,
  submitters: [ada, bo, cy],
  guessedPlayers: [],
  you: { submitted: true, guessesRemaining: 2 },
};

/** The same round once guessing opens. `submitters` is *absent*, not empty — that is the signal. */
const guessingRound = (() => {
  const { submitters: _omitted, ...rest } = submissionRound;
  return {
    ...rest,
    submissionDeadline: at(-1),
    phase: 'guessing',
    guessedPlayers: [ada],
    you: { submitted: true, guessesRemaining: 2 },
  };
})();

const resultsRound = {
  ...submissionRound,
  submissionDeadline: at(-14),
  guessingDeadline: at(-7),
  phase: 'results',
  submittedCount: 4,
  submitters: roster,
  guessedPlayers: roster,
  you: { submitted: true, guessesRemaining: 0 },
};

const body = (round: unknown) => ({ leagueId: 'league-1', leagueName: 'Office League', round });

async function show(round: unknown) {
  globalThis.fetch = jest.fn(
    async () => new Response(JSON.stringify(body(round)), { status: 200 }),
  ) as unknown as typeof fetch;
  await render(<RoundOverview />);
  await screen.findByTestId('round-heading');
}

beforeEach(() => jest.clearAllMocks());

it('loads the round once and heads the page with the round and its deadlines', async () => {
  await show(submissionRound);

  expect(String((fetch as jest.Mock).mock.calls[0][0])).toContain('/rounds/r2/overview');
  expect((fetch as jest.Mock).mock.calls).toHaveLength(1);
  expect(screen.getByTestId('round-heading').props.children).toBe('Round 2');
  expect(screen.getByText('Songs about rain')).toBeTruthy();
  expect(screen.getByTestId('round-submission')).toBeTruthy();
  expect(screen.getByTestId('round-guessing')).toBeTruthy();
});

// The whole point of this URL: one address that keeps working as the deadlines pass, each phase
// offering the screen that phase calls for rather than 403ing or showing the wrong thing.
it.each([
  ['submission', submissionRound, 'Submit your track', 'submit'],
  ['guessing', guessingRound, 'Guess the submitters', 'guess'],
  ['results', resultsRound, 'See results', 'results'],
] as const)('gives the %s phase its own CTA into that phase’s screen', async (_phase, round, label, segment) => {
  await show(round);

  fireEvent.press(screen.getByText(label));

  expect(router.push).toHaveBeenCalledWith({
    pathname: `/round/[roundId]/${segment}`,
    params: { roundId: 'r2' },
  });
});

// Deliberately a link, not a third results view — results.tsx already owns the reveal.
it('does not redirect into the phase screen', async () => {
  await show(resultsRound);

  expect(router.push).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
});

it('names who has submitted while the submission window is open', async () => {
  await show(submissionRound);

  expect(screen.getByTestId('submitters').props.children).toBe('Ada, Bo, Cy');
  expect(screen.getByTestId('submitted-count').props.children).toBe('3 tracks in');
});

// The regression that matters: the server omits `submitters` during guessing because naming who
// has *not* submitted narrows the pool. Absence is the signal — never the phase.
it('names nobody as a submitter once guessing opens, but still counts them', async () => {
  // Nobody has guessed yet either, so *any* name on the screen would have to be a submitter's.
  await show({ ...guessingRound, guessedPlayers: [] });

  expect(screen.queryByTestId('submitters')).toBeNull();
  for (const player of roster) {
    expect(screen.queryByText(player.displayName)).toBeNull();
  }
  expect(screen.getByTestId('submitted-count').props.children).toBe('3 tracks in');
});

// Who has answered, never what they answered — safe in every phase.
it('shows guess progress by name during guessing', async () => {
  await show(guessingRound);

  expect(screen.getByTestId('guessed-players').props.children).toBe('Ada');
});

it('names the submitters again once the round is over', async () => {
  await show(resultsRound);

  expect(screen.getByTestId('submitters').props.children).toBe('Ada, Bo, Cy, Di');
});

it('says where you stand, submitted or not', async () => {
  await show(guessingRound);
  expect(screen.getByTestId('your-submission').props.children).toBe('Your track is in');
  expect(screen.getByTestId('your-guesses').props.children).toBe('2 guesses to go');

  await show({ ...guessingRound, you: { submitted: false, guessesRemaining: 0 } });
  expect(screen.getByTestId('your-submission').props.children).toBe('You have not submitted a track');
  expect(screen.getByTestId('your-guesses').props.children).toBe('You have made all your guesses');
});

// A guess count before guessing opens counts tracks nobody may guess yet; after it, it is stale.
it('counts your guesses only while guessing is open', async () => {
  await show(submissionRound);

  expect(screen.queryByTestId('your-guesses')).toBeNull();
});

// #74 creates rounds 2..N unnamed. Blank is a bug; "null" is worse.
it('prompts for an unset theme rather than heading a round with nothing', async () => {
  await show({ ...submissionRound, theme: null });

  expect(screen.getByText('Theme not set yet')).toBeTruthy();
});

it('offers the way back up to the season hub', async () => {
  await show(submissionRound);

  fireEvent.press(screen.getByText('Back to Office League'));

  expect(router.push).toHaveBeenCalledWith({
    pathname: '/league/[leagueId]',
    params: { leagueId: 'league-1' },
  });
});

it('explains itself when the round cannot be loaded', async () => {
  globalThis.fetch = jest.fn(
    async () => new Response(JSON.stringify({ error: 'join the league before viewing this round' }), { status: 403 }),
  ) as unknown as typeof fetch;
  await render(<RoundOverview />);

  await waitFor(() => expect(screen.getByText('join the league before viewing this round')).toBeTruthy());
});
