import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import LeagueOverview from '../league/[leagueId]/index';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ leagueId: 'league-1' }),
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

/** Round 1 is over and scored; it is the "past round" every fixture below shares. */
const round1 = {
  id: 'r1',
  number: 1,
  theme: 'One-hit wonders',
  submissionDeadline: at(-14),
  guessingDeadline: at(-7),
  phase: 'results',
  submittedCount: 4,
  guessingOpen: false,
  submitters: roster,
  guessedPlayers: [ada, bo],
  you: { submitted: true, guessesRemaining: 0 },
  isCurrent: false,
};

/** Round 3 has never been touched: no theme (#74), nothing submitted, deadlines still ahead. */
const round3 = {
  id: 'r3',
  number: 3,
  theme: null,
  submissionDeadline: at(14),
  guessingDeadline: at(21),
  phase: 'submission',
  submittedCount: 0,
  guessingOpen: false,
  submitters: [],
  guessedPlayers: [],
  you: { submitted: false, guessesRemaining: 0 },
  isCurrent: false,
};

function body(overrides: Record<string, unknown> = {}) {
  return {
    league: {
      id: 'league-1',
      name: 'Office League',
      seasonLength: 3,
      inviteCode: 'abc12',
      isHost: false,
      concluded: false,
    },
    host: ada,
    members: roster.map((p) => ({ ...p, joinedAt: at(-30) })),
    standings: [
      { ...ada, score: 2 },
      { ...bo, score: 1 },
      { ...cy, score: 0 },
      { ...di, score: 0 },
    ],
    scoredRoundCount: 1,
    winners: [],
    rounds: [round1, round3],
    ...overrides,
  };
}

/** The current round mid-submission: three of four are in, and the server names them. */
const submissionRound = {
  id: 'r2',
  number: 2,
  theme: 'Songs about rain',
  submissionDeadline: at(1),
  guessingDeadline: at(7),
  phase: 'submission',
  submittedCount: 3,
  guessingOpen: false,
  submitters: [ada, bo, cy],
  guessedPlayers: [],
  you: { submitted: true, guessesRemaining: 0 },
  isCurrent: true,
};

/**
 * The same round once guessing opens: every track is in. `submitters` is *absent*, not empty —
 * that is the signal.
 */
const guessingRound = (() => {
  const { submitters: _omitted, ...rest } = submissionRound;
  return {
    ...rest,
    submissionDeadline: at(-1),
    phase: 'guessing',
    submittedCount: 4,
    guessingOpen: true,
    guessedPlayers: [ada],
  };
})();

/** Past the deadline with a track still missing: the clock says guessing, the playlist disagrees. */
const stillCollectingRound = { ...guessingRound, submittedCount: 3, guessingOpen: false };

const inRound = (round: unknown, overrides: Record<string, unknown> = {}) =>
  body({ rounds: [round1, round, round3], ...overrides });

function stubApi(overview: unknown) {
  globalThis.fetch = jest.fn(
    async () => new Response(JSON.stringify(overview), { status: 200 }),
  ) as unknown as typeof fetch;
}

async function show(overview: unknown) {
  stubApi(overview);
  await render(<LeagueOverview />);
  await screen.findByText('Office League');
}

/** The season once it is over: the last round stays marked current, and Ada has won it. */
const concludedSeason = () =>
  body({
    league: { ...body().league, concluded: true },
    rounds: [round1, { ...round1, id: 'r3', number: 3, isCurrent: true }],
    scoredRoundCount: 3,
    winners: [{ ...ada, score: 2 }],
  });

/** What the roster says *about a named player* — the leak, if there is one, is in here. */
const rosterRowFor = (player: { accountId: string; displayName: string }) => {
  const row = within(screen.getByTestId(`roster-${player.accountId}`));
  expect(row.getByText(player.displayName)).toBeTruthy();
  return row;
};

beforeEach(() => jest.clearAllMocks());

it('loads the league overview once and heads the page with the season’s progress', async () => {
  await show(inRound(submissionRound));

  expect(String((fetch as jest.Mock).mock.calls[0][0])).toContain('/leagues/league-1/overview');
  expect((fetch as jest.Mock).mock.calls).toHaveLength(1);
  expect(screen.getByTestId('season-progress').props.children).toBe('Round 2 of 3');
});

// Nobody is guessing yet, so nagging the stragglers is the whole point of the roster.
it('names who has submitted while the submission window is open', async () => {
  await show(inRound(submissionRound));

  expect(rosterRowFor(ada).getByText('Submitted')).toBeTruthy();
  expect(rosterRowFor(di).queryByText('Submitted')).toBeNull();
  expect(rosterRowFor(di).getByText('No track yet')).toBeTruthy();
  expect(screen.getByTestId('submitted-count').props.children).toBe('3 of 4 submitted');
});

// The regression that matters: the server omits `submitters` during guessing because naming who
// has *not* submitted narrows the pool. Absence is the signal — never the phase.
it('names nobody as a submitter once guessing opens, but still counts them', async () => {
  // The still-collecting round, so there is a straggler to leak: a full playlist has nothing to hide.
  await show(inRound(stillCollectingRound));

  // Named player by named player: nobody is marked either way. Ada and Bo are in, Di is not, and
  // the screen must not be able to say which is which.
  for (const player of roster) {
    expect(rosterRowFor(player).queryByText('Submitted')).toBeNull();
    expect(rosterRowFor(player).queryByText('No track yet')).toBeNull();
  }
  expect(screen.getByTestId('submitted-count').props.children).toBe('3 of 4 submitted');
});

// Guess progress says who has answered, never what they answered — safe in every phase.
it('shows guess progress by name during guessing', async () => {
  await show(inRound(guessingRound));

  expect(rosterRowFor(ada).getByText('Guessed')).toBeTruthy();
  expect(rosterRowFor(bo).queryByText('Guessed')).toBeNull();
});

it('names the submitters again once the round is over', async () => {
  await show(concludedSeason());

  expect(rosterRowFor(ada).getByText('Submitted')).toBeTruthy();
  expect(rosterRowFor(di).getByText('Submitted')).toBeTruthy();
});

it('says what the running standings count, so mid-season is not read as final', async () => {
  await show(inRound(submissionRound));

  expect(screen.getByTestId('standings-caption').props.children).toBe('After 1 of 3 rounds');
  expect(screen.getByTestId('standings-a').props.children).toBe(2);
});

// A table of zeroes reads as a result. Nothing has been scored, so say that instead.
it('shows an empty state rather than a table of zeroes before anything is scored', async () => {
  await show(inRound(submissionRound, { scoredRoundCount: 0, standings: body().standings }));

  expect(screen.queryByTestId('standings-a')).toBeNull();
  expect(screen.getByText('No rounds have been scored yet.')).toBeTruthy();
});

it('names the winners once the season is over', async () => {
  await show(concludedSeason());

  expect(screen.getByTestId('season-progress').props.children).toBe('Season complete');
  expect(screen.getByTestId('winners').props.children).toBe('Ada');
  expect(screen.getByTestId('standings-caption').props.children).toBe('Final standings');
});

// Guessing cannot run below MIN_PLAYERS at all, and the host currently discovers that only when
// the phase silently does nothing. Say it where the invite already is.
it('tells a short-handed league how many more players it needs', async () => {
  await show(inRound(submissionRound, { members: roster.slice(0, 2).map((p) => ({ ...p, joinedAt: at(-30) })) }));

  expect(screen.getByTestId('min-players-note').props.children).toBe(
    '2 more players needed before guessing can start',
  );
});

it('says nothing about the minimum once the league is big enough', async () => {
  await show(inRound(submissionRound));

  expect(screen.queryByTestId('min-players-note')).toBeNull();
});

it('gives the host the schedule editor and everyone else nothing to be refused by', async () => {
  await show(inRound(submissionRound, { league: { ...body().league, isHost: true } }));
  expect(screen.getByText('Edit the season schedule')).toBeTruthy();

  await show(inRound(submissionRound));
  expect(screen.queryByText('Edit the season schedule')).toBeNull();
});

it('routes the current round’s CTA into the screen its phase calls for', async () => {
  await show(inRound(guessingRound));

  fireEvent.press(screen.getByText('Guess the submitters'));

  expect(router.push).toHaveBeenCalledWith({
    pathname: '/round/[roundId]/guess',
    params: { roundId: 'r2' },
  });
});

// A round nobody can guess on yet must not offer the way in — the guess screen would 403 (too
// few players) or hand over a playlist that is still missing a track.
it('replaces the guess CTA with a status while the round is still collecting tracks', async () => {
  await show(inRound(stillCollectingRound));

  expect(screen.getByTestId('current-round-cta-note').props.children).toBe('Submissions in progress');
  expect(screen.queryByText('Guess the submitters')).toBeNull();
});

it('links a finished round to its results and gives a future round no CTA', async () => {
  await show(inRound(submissionRound));

  fireEvent.press(screen.getByText('Round 1 results'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/round/[roundId]/results',
    params: { roundId: 'r1' },
  });
  expect(screen.queryByText('Round 3 results')).toBeNull();
});

// #74 creates rounds 2..N unnamed. Blank is a bug; "null" is worse.
it('prompts for an unset theme rather than heading a round with nothing', async () => {
  await show(inRound(submissionRound, { league: { ...body().league, isHost: true } }));
  expect(screen.getByText('Set a theme')).toBeTruthy();

  await show(inRound(submissionRound));
  expect(screen.getByText('Theme not set yet')).toBeTruthy();
});

it('surfaces the invite code so anyone can top the league up', async () => {
  await show(inRound(submissionRound));

  expect(screen.getByText('Invite code: abc12')).toBeTruthy();
});

it('explains itself when the league cannot be loaded', async () => {
  globalThis.fetch = jest.fn(
    async () => new Response(JSON.stringify({ error: 'join the league before viewing it' }), { status: 403 }),
  ) as unknown as typeof fetch;
  await render(<LeagueOverview />);

  await waitFor(() => expect(screen.getByText('join the league before viewing it')).toBeTruthy());
});
