import { guessesLine, nextStep, roundStatus, seasonEntry, submissionMark, submitterNames, type Player, type RoundPhase } from '../rounds';

describe('nextStep', () => {
  it.each([
    ['upcoming', false, null],
    ['submission', false, { label: 'Submit your track', href: { pathname: '/round/[roundId]/submit', params: { roundId: 'r' } } }],
    ['submission', true, { label: 'Edit your track', href: { pathname: '/round/[roundId]/submit', params: { roundId: 'r', edit: '1' } } }],
    ['guessing', true, { label: 'Guess the submitters', href: { pathname: '/round/[roundId]/guess', params: { roundId: 'r' } } }],
    ['results', true, { label: 'See results', href: { pathname: '/round/[roundId]/results', params: { roundId: 'r' } } }],
  ] as const)('%s, submitted=%s', (phase, submitted, expected) => {
    expect(nextStep({ id: 'r', phase }, submitted)).toEqual(expected);
  });
});

it.each([
  ['upcoming', 'Submissions open later'],
  ['submission', 'Submissions are open'],
  ['guessing', 'Guessing is open'],
  ['results', 'This round is over'],
] as const)('roundStatus(%s)', (phase, line) => {
  expect(roundStatus(phase)).toBe(line);
});

it.each([
  ['submission', 2, null],
  ['results', 2, null],
  ['guessing', 0, 'You have made all your guesses'],
  ['guessing', 1, '1 guess to go'],
  ['guessing', 2, '2 guesses to go'],
] as [RoundPhase, number, string | null][])('guessesLine(%s, %d)', (phase, guessesRemaining, line) => {
  expect(guessesLine({ phase, you: { guessesRemaining } })).toBe(line);
});

// Absence of `submitters` is the signal, never the phase.
it.each([
  [undefined, null],
  [[{ accountId: 'a', displayName: 'Ada' }], 'Submitted'],
  [[{ accountId: 'b', displayName: 'Bo' }], 'No track yet'],
] as [Player[] | undefined, string | null][])('submissionMark(%j)', (submitters, mark) => {
  expect(submissionMark({ submitters }, 'a')).toBe(mark);
});

it.each([
  [undefined, null],
  [[], null],
  [[{ accountId: 'a', displayName: 'Ada' }, { accountId: 'b', displayName: null }], 'Ada, A player'],
] as [Player[] | undefined, string | null][])('submitterNames(%j)', (submitters, names) => {
  expect(submitterNames({ submitters })).toBe(names);
});

// The server's phase, not this device's clock, decides whether a round has results to read.
it.each([
  [true, 'submission', 3, 'see above'],
  [true, 'results', 3, 'results'],
  [false, 'results', 0, 'no tracks'],
  [false, 'results', 2, 'results'],
  [false, 'upcoming', 0, 'details'],
  [false, 'guessing', 2, 'details'],
] as [boolean, RoundPhase, number, string][])('seasonEntry(isCurrent=%s, %s, %d)', (isCurrent, phase, submittedCount, entry) => {
  expect(seasonEntry({ isCurrent, phase, submittedCount })).toBe(entry);
});
