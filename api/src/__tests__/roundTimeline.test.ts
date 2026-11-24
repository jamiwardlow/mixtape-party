import { describe, expect, it } from 'vitest';
import {
  guessingOpened,
  isScored,
  isSeasonConcluded,
  roundPhase,
  roundSql,
  seasonConcludedSql,
} from '../roundTimeline.js';

const round = {
  submissionOpensAt: '2026-01-02T00:00:00Z',
  submissionDeadline: '2026-01-05T00:00:00Z',
  guessingDeadline: '2026-01-08T00:00:00Z',
};
const at = (iso: string) => new Date(iso);

describe('roundPhase', () => {
  it.each([
    ['2026-01-01T00:00:00Z', 'upcoming'],
    ['2026-01-02T00:00:00Z', 'submission'],
    ['2026-01-04T23:59:59Z', 'submission'],
    ['2026-01-05T00:00:00Z', 'guessing'],
    ['2026-01-07T23:59:59Z', 'guessing'],
    ['2026-01-08T00:00:00Z', 'results'],
  ])('at %s is %s', (now, phase) => {
    expect(roundPhase(round, at(now))).toBe(phase);
  });

  it('treats a missing open time as already open', () => {
    expect(roundPhase({ ...round, submissionOpensAt: null }, at('2000-01-01T00:00:00Z'))).toBe('submission');
  });
});

describe('gates', () => {
  it('guessing opens at the submission deadline and stays opened', () => {
    expect(guessingOpened(round, at('2026-01-04T23:59:59Z'))).toBe(false);
    expect(guessingOpened(round, at('2026-01-05T00:00:00Z'))).toBe(true);
    expect(guessingOpened(round, at('2026-01-09T00:00:00Z'))).toBe(true);
  });

  it('is scored from the guessing deadline on', () => {
    expect(isScored(round, at('2026-01-07T23:59:59Z'))).toBe(false);
    expect(isScored(round, at('2026-01-08T00:00:00Z'))).toBe(true);
  });
});

describe('isSeasonConcluded', () => {
  const current = { roundNumber: 3, guessingDeadline: round.guessingDeadline };
  it('needs the last round, scored', () => {
    expect(isSeasonConcluded(3, current, at('2026-01-08T00:00:00Z'))).toBe(true);
    expect(isSeasonConcluded(3, current, at('2026-01-07T00:00:00Z'))).toBe(false);
    expect(isSeasonConcluded(4, current, at('2026-01-08T00:00:00Z'))).toBe(false);
    expect(isSeasonConcluded(3, null, at('2026-01-08T00:00:00Z'))).toBe(false);
  });
});

describe('SQL predicates', () => {
  it('qualifies columns and takes the clock expression', () => {
    expect(roundSql('r', '$1').scored).toBe('r.guessing_deadline <= $1');
    expect(roundSql().guessingOpened).toBe('submission_deadline <= now()');
    expect(seasonConcludedSql('l', '$1')).toContain('last_round.guessing_deadline <= $1');
  });
});
