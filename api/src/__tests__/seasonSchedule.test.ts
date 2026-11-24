import { describe, expect, it } from 'vitest';
import {
  clearedReminders,
  planRoundDelete,
  planRoundEdit,
  planSeason,
  type ScheduledRound,
} from '../seasonSchedule.js';

const DAY = 24 * 60 * 60 * 1000;
const t = (day: number) => new Date(Date.UTC(2026, 0, 1) + day * DAY);

// Four rounds, flush against each other: submissions 3 days, guessing 2, each round opening as
// the previous one's guessing closes.
const season: ScheduledRound[] = [1, 2, 3, 4].map((n) => ({
  id: `r${n}`,
  roundNumber: n,
  submissionOpensAt: t((n - 1) * 5),
  submissionDeadline: t((n - 1) * 5 + 3),
  guessingDeadline: t(n * 5),
}));
// Before anything has happened.
const now = t(-1);

describe('planSeason', () => {
  it('reuses round 1 guessing length for submissions and its lead time for guessing', () => {
    const plan = planSeason({ createdAt: t(0), submissionDeadline: t(4), guessingDeadline: t(6), seasonLength: 3 });
    expect(plan).toEqual([
      { submissionOpensAt: t(0), submissionDeadline: t(4), guessingDeadline: t(6) },
      { submissionOpensAt: t(6), submissionDeadline: t(8), guessingDeadline: t(12) },
      { submissionOpensAt: t(12), submissionDeadline: t(14), guessingDeadline: t(18) },
    ]);
  });

  it('falls back to round 1 guessing length when its submission deadline is already past', () => {
    const plan = planSeason({ createdAt: t(5), submissionDeadline: t(4), guessingDeadline: t(6), seasonLength: 2 });
    expect(plan[1]).toEqual({ submissionOpensAt: t(6), submissionDeadline: t(8), guessingDeadline: t(10) });
  });
});

describe('clearedReminders', () => {
  const r = season[1];
  it.each([
    ['nothing moved', {}, []],
    ['open time', { submissionOpensAt: t(4) }, ['submission_reminder_sent_at']],
    [
      'submission deadline',
      { submissionDeadline: t(9) },
      ['submission_reminder_sent_at', 'submission_last_call_sent_at', 'guessing_reminder_sent_at'],
    ],
    ['guessing deadline', { guessingDeadline: t(11) }, ['guessing_reminder_sent_at', 'guessing_last_call_sent_at']],
  ])('%s', (_, change, flags) => {
    expect(clearedReminders(r, { ...r, ...change })).toEqual(flags);
  });
});

describe('planRoundEdit', () => {
  const edit = (roundId: string, patch: Parameters<typeof planRoundEdit>[2], at = now) =>
    planRoundEdit(season, roundId, patch, at);

  it.each<[string, string, Parameters<typeof planRoundEdit>[2], Date, 'invalid' | 'conflict' | 'missing']>([
    ['unknown round', 'nope', {}, now, 'missing'],
    ['round already scored', 'r1', {}, t(5), 'conflict'],
    ['guessing not after submission', 'r2', { submissionDeadline: t(10) }, now, 'invalid'],
    ['invalid date', 'r2', { guessingDeadline: new Date('nope') }, now, 'invalid'],
    ['submission window already closed', 'r1', { submissionDeadline: t(4) }, t(3), 'conflict'],
    ['submission deadline in the past', 'r2', { submissionDeadline: t(6) }, t(7), 'invalid'],
    ['guessing deadline in the past', 'r1', { guessingDeadline: t(4) }, t(4.5), 'invalid'],
    ['submission deadline before previous round closes', 'r3', { submissionDeadline: t(9) }, now, 'invalid'],
  ])('refuses: %s', (_, roundId, patch, at, refused) => {
    expect(edit(roundId, patch, at)).toMatchObject({ refused });
  });

  it('refuses a slide over a later round that is already scored', () => {
    const legacy = season.map((r) => (r.id === 'r4' ? { ...r, guessingDeadline: t(-2) } : r));
    expect(planRoundEdit(legacy, 'r2', { guessingDeadline: t(11) }, now)).toMatchObject({ refused: 'conflict' });
  });

  it('lets a submission deadline touch the previous round', () => {
    expect(edit('r3', { submissionDeadline: t(10) })).toHaveLength(1);
  });

  it('writes only the patched round when the submission deadline moves', () => {
    expect(edit('r2', { submissionDeadline: t(9) })).toEqual([
      { ...season[1], submissionDeadline: t(9), clear: clearedReminders(season[1], { ...season[1], submissionDeadline: t(9) }) },
    ]);
  });

  it('slides every later round whole when the guessing deadline moves', () => {
    const writes = edit('r2', { guessingDeadline: t(12) });
    expect(Array.isArray(writes) && writes.map((w) => [w.id, w.submissionOpensAt, w.submissionDeadline, w.guessingDeadline])).toEqual([
      ['r2', t(5), t(8), t(12)],
      ['r3', t(12), t(15), t(17)],
      ['r4', t(17), t(20), t(22)],
    ]);
    expect(Array.isArray(writes) && writes[1].clear).toHaveLength(4);
  });

  it('still names a round mid-guessing', () => {
    expect(edit('r1', {}, t(4))).toEqual([{ ...season[0], clear: [] }]);
  });
});

describe('planRoundDelete', () => {
  it('hands the next round the deleted round\'s open time', () => {
    expect(planRoundDelete(season, 'r3', now)).toEqual({
      writes: [{ ...season[3], submissionOpensAt: t(10), clear: ['submission_reminder_sent_at'] }],
    });
  });

  it('writes nothing when the last round goes', () => {
    expect(planRoundDelete(season, 'r4', now)).toEqual({ writes: [] });
  });

  it.each<[string, ScheduledRound[], string, Date, 'conflict' | 'missing']>([
    ['unknown round', season, 'nope', now, 'missing'],
    ['round already scored', season, 'r1', t(5), 'conflict'],
    ['the only round', season.slice(0, 1), 'r1', now, 'conflict'],
  ])('refuses: %s', (_, rounds, roundId, at, refused) => {
    expect(planRoundDelete(rounds, roundId, at)).toMatchObject({ refused });
  });
});
