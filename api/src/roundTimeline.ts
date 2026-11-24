/**
 * The round timeline: not yet open -> submission -> guessing -> results. Derived from the round's
 * three timestamps, never stored. Every gate, the sweep and the overviews ask this module, and the
 * SQL predicates below are the same rules for set-based queries -- edit both halves together.
 *
 * `now` is always an input; routes pass `new Date()`, tests and the sweep pass their own clock.
 */

type Instant = string | Date;

export interface RoundSchedule {
  /** Null on legacy rows: open from creation. */
  submissionOpensAt?: Instant | null;
  submissionDeadline: Instant;
  guessingDeadline: Instant;
}

export type RoundPhase = 'upcoming' | 'submission' | 'guessing' | 'results';

const reached = (at: Instant | null | undefined, now: Date) => at == null || new Date(at) <= now;

export const submissionOpened = (r: Pick<RoundSchedule, 'submissionOpensAt'>, now: Date) => reached(r.submissionOpensAt, now);
/** Submissions closed: tracks are revealed to guess on, export, react to. True through results. */
export const guessingOpened = (r: Pick<RoundSchedule, 'submissionDeadline'>, now: Date) => reached(r.submissionDeadline, now);
/** Guessing closed: submitters revealed, guesses count toward standings. */
export const isScored = (r: Pick<RoundSchedule, 'guessingDeadline'>, now: Date) => reached(r.guessingDeadline, now);

export function roundPhase(r: RoundSchedule, now: Date): RoundPhase {
  if (isScored(r, now)) return 'results';
  if (guessingOpened(r, now)) return 'guessing';
  return submissionOpened(r, now) ? 'submission' : 'upcoming';
}

/**
 * The season is over once the current round is the season's last and it is scored. One
 * definition, because final standings and the overview's `concluded` must agree.
 */
export function isSeasonConcluded(
  seasonLength: number,
  current: { roundNumber: number; guessingDeadline: Instant } | null,
  now: Date,
): boolean {
  return !!current && current.roundNumber >= seasonLength && isScored(current, now);
}

/**
 * The rules above as SQL, over `rounds` columns qualified by `alias`, against the clock expression
 * `now` (`now()` or a bound parameter like `$1`).
 */
export function roundSql(alias = '', now = 'now()') {
  const c = alias ? `${alias}.` : '';
  return {
    submissionOpened: `(${c}submission_opens_at IS NULL OR ${c}submission_opens_at <= ${now})`,
    guessingOpened: `${c}submission_deadline <= ${now}`,
    scored: `${c}guessing_deadline <= ${now}`,
    unscored: `${c}guessing_deadline > ${now}`,
  };
}

/** isSeasonConcluded for a `leagues` row aliased `league`. Same answer on a monotonic schedule. */
export const seasonConcludedSql = (league: string, now = 'now()') =>
  `EXISTS (SELECT 1 FROM rounds last_round WHERE last_round.league_id = ${league}.id
     AND last_round.round_number >= ${league}.season_length AND ${roundSql('last_round', now).scored})`;

/**
 * How to pick a league's current round now that every round of the season exists from creation
 * (#74): the earliest unscored round, or the last round once the season is over. Plain
 * `round_number DESC` would name the final round of the season on day one.
 */
export const CURRENT_ROUND_CLAUSE = `ORDER BY
     (${roundSql().unscored}) DESC,
     CASE WHEN ${roundSql().unscored} THEN round_number ELSE -round_number END ASC
   LIMIT 1`;
