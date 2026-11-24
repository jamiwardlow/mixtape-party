/**
 * The season schedule: generating a season from round 1's dates, and the rules for moving and
 * deleting a round. The planners are pure -- old schedule + change + now -> writes or a refusal --
 * and the functions at the bottom load a league's rounds under a lock and apply a plan in one
 * transaction, so a half-applied slide never leaves the schedule out of order (which
 * CURRENT_ROUND_CLAUSE cannot survive).
 *
 * It also owns which reminder state a window carries, shared with the sweep: the sweep sends each
 * reminder once (`... IS NULL`), so a window that moves has to clear what was sent against it.
 */
import type { Pool, PoolClient } from 'pg';
import { guessingOpened, isScored } from './roundTimeline.js';

export interface RoundWindows {
  /** Null on legacy rows: open from creation. */
  submissionOpensAt: Date | null;
  submissionDeadline: Date;
  guessingDeadline: Date;
}

export interface ScheduledRound extends RoundWindows {
  id: string;
  roundNumber: number;
}

/** The sweep's one-shot flags for each window. A last call also marks its window's reminder sent. */
export const WINDOW_REMINDERS = {
  submission: {
    start: 'submissionOpensAt',
    end: 'submissionDeadline',
    reminder: 'submission_reminder_sent_at',
    lastCall: 'submission_last_call_sent_at',
  },
  guessing: {
    start: 'submissionDeadline',
    end: 'guessingDeadline',
    reminder: 'guessing_reminder_sent_at',
    lastCall: 'guessing_last_call_sent_at',
  },
} as const;

export type Window = (typeof WINDOW_REMINDERS)[keyof typeof WINDOW_REMINDERS];
export type ReminderFlag = Window['reminder'] | Window['lastCall'];
const FLAGS: ReminderFlag[] = Object.values(WINDOW_REMINDERS).flatMap((w) => [w.reminder, w.lastCall]);

const sameInstant = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * The flags a move from `old` to `next` clears: a reminder is timed off both ends of its window,
 * a last call off the end only. A window that did not move keeps its flags, so nobody is
 * re-notified for nothing.
 */
export function clearedReminders(old: RoundWindows, next: RoundWindows): ReminderFlag[] {
  return Object.values(WINDOW_REMINDERS).flatMap((w: Window) => {
    const endMoved = !sameInstant(old[w.end], next[w.end]);
    const startMoved = !sameInstant(old[w.start], next[w.start]);
    return [...(endMoved || startMoved ? [w.reminder] : []), ...(endMoved ? [w.lastCall] : [])];
  });
}

export type Refusal = { refused: 'invalid' | 'conflict' | 'missing'; error: string };
export type RoundWrite = ScheduledRound & { clear: ReminderFlag[] };

const moveTo = (round: ScheduledRound, windows: RoundWindows): RoundWrite => ({
  ...round,
  ...windows,
  clear: clearedReminders(round, windows),
});

/** The one definition of a well-formed round window, for league creation and the round PATCH. */
export function checkDeadlineOrder(submissionAt: Date, guessingAt: Date): string | null {
  if (Number.isNaN(submissionAt.getTime()) || Number.isNaN(guessingAt.getTime())) {
    return 'submissionDeadline and guessingDeadline must be valid dates';
  }
  if (guessingAt <= submissionAt) {
    return 'guessingDeadline must be after submissionDeadline';
  }
  return null;
}

/**
 * The whole season from round 1's two deadlines, with no round's phases overlapping. Round 1 is
 * as entered and opens at creation. With W = G1 - S1 (round 1's guessing length, reused as every
 * later submission period) and I = S1 - creation (reused as every later guessing period), round
 * N >= 2 opens at G(N-1), closes submissions at G(N-1) + W and guessing at that + I. A deadline
 * already past leaves no I to copy, so it falls back to W.
 */
export function planSeason(input: {
  createdAt: Date;
  submissionDeadline: Date;
  guessingDeadline: Date;
  seasonLength: number;
}): RoundWindows[] {
  const { createdAt, submissionDeadline, guessingDeadline, seasonLength } = input;
  const submitMs = guessingDeadline.getTime() - submissionDeadline.getTime();
  const guessMs = Math.max(submissionDeadline.getTime() - createdAt.getTime(), submitMs);
  const season: RoundWindows[] = [{ submissionOpensAt: createdAt, submissionDeadline, guessingDeadline }];
  for (let n = 2; n <= seasonLength; n++) {
    const opens = season[n - 2].guessingDeadline;
    const closes = new Date(opens.getTime() + submitMs);
    season.push({ submissionOpensAt: opens, submissionDeadline: closes, guessingDeadline: new Date(closes.getTime() + guessMs) });
  }
  return season;
}

/**
 * A host moving one round's deadlines. The schedule only flexes forward of now: a scored round's
 * results and playlist are out, and a closed submission window has guessing underway on the tracks
 * that made it in. The submission deadline is the split inside the round, bounded below by the
 * previous round's guessing deadline (touching it is the preset's resting state). The guessing
 * deadline is the boundary with the next round, so moving it slides every later round whole by
 * the same delta (#79) -- the host is moving the season, not squeezing a round they said nothing
 * about. Returns every round it writes, the patched one first.
 */
export function planRoundEdit(
  season: ScheduledRound[],
  roundId: string,
  patch: { submissionDeadline?: Date; guessingDeadline?: Date },
  now: Date,
): RoundWrite[] | Refusal {
  const round = season.find((r) => r.id === roundId);
  if (!round) return { refused: 'missing', error: 'round not found' };
  if (isScored(round, now)) return { refused: 'conflict', error: 'this round is over and can no longer be changed' };

  // An absent deadline stands in as the stored one, so a one-sided patch is still checked
  // against the side it is not touching.
  const submissionDeadline = patch.submissionDeadline ?? round.submissionDeadline;
  const guessingDeadline = patch.guessingDeadline ?? round.guessingDeadline;
  const orderError = checkDeadlineOrder(submissionDeadline, guessingDeadline);
  if (orderError) return { refused: 'invalid', error: orderError };

  if (patch.submissionDeadline && guessingOpened(round, now)) {
    return { refused: 'conflict', error: "this round's submission window has closed and can no longer be moved" };
  }
  // In the past, a deadline retro-closes a phase people were still playing -- and a past
  // guessing deadline concludes the round on the spot, firing its export (#7) early.
  if ((patch.submissionDeadline && submissionDeadline <= now) || (patch.guessingDeadline && guessingDeadline <= now)) {
    return { refused: 'invalid', error: 'a new deadline must be in the future' };
  }
  const previous = season.find((r) => r.roundNumber === round.roundNumber - 1);
  if (patch.submissionDeadline && previous && submissionDeadline < previous.guessingDeadline) {
    return { refused: 'invalid', error: `submissionDeadline must not precede round ${previous.roundNumber}'s guessing deadline` };
  }

  const shiftMs = guessingDeadline.getTime() - round.guessingDeadline.getTime();
  const later = shiftMs === 0 ? [] : season.filter((r) => r.roundNumber > round.roundNumber);
  // Monotonicity already implies every later round is unscored, but a legacy or hand-edited
  // league need not be monotonic, so assert it rather than assume it.
  if (later.some((r) => isScored(r, now))) {
    return { refused: 'conflict', error: 'a later round of this season is already over and cannot be moved' };
  }
  const shift = (d: Date) => new Date(d.getTime() + shiftMs);
  return [
    moveTo(round, { submissionOpensAt: round.submissionOpensAt, submissionDeadline, guessingDeadline }),
    ...later.map((r) =>
      moveTo(r, {
        submissionOpensAt: r.submissionOpensAt && shift(r.submissionOpensAt),
        submissionDeadline: shift(r.submissionDeadline),
        guessingDeadline: shift(r.guessingDeadline),
      }),
    ),
  ];
}

/**
 * A host dropping a round. Same freeze as editing. Later rounds keep their deadlines (ponytail:
 * no slide back in time -- the host can pull the next round forward by editing it), but the next
 * one inherits the deleted round's open time, or it would sit closed while the round before is
 * long over. Renumbering is mechanical and left to deleteRound.
 */
export function planRoundDelete(season: ScheduledRound[], roundId: string, now: Date): { writes: RoundWrite[] } | Refusal {
  const round = season.find((r) => r.id === roundId);
  if (!round) return { refused: 'missing', error: 'round not found' };
  if (isScored(round, now)) return { refused: 'conflict', error: 'this round is over and can no longer be deleted' };
  if (season.length <= 1) return { refused: 'conflict', error: 'a season needs at least one round; delete the league instead' };
  const next = season.find((r) => r.roundNumber === round.roundNumber + 1);
  return { writes: next ? [moveTo(next, { ...next, submissionOpensAt: round.submissionOpensAt })] : [] };
}

export interface RoundRow {
  id: string;
  round_number: number;
  theme: string | null;
  submission_opens_at: string | null;
  submission_deadline: string;
  guessing_deadline: string;
}

const ROUND_COLUMNS = 'id, round_number, theme, submission_opens_at, submission_deadline, guessing_deadline';

/** Inserts a planned season. themes[i] names round i + 1; null leaves it for the host to name later. */
export async function insertSeason(
  client: PoolClient,
  leagueId: string,
  windows: RoundWindows[],
  themes: (string | null)[],
): Promise<RoundRow[]> {
  const rows = windows.map((w, i) => ({
    round_number: i + 1,
    theme: themes[i],
    submission_opens_at: w.submissionOpensAt,
    submission_deadline: w.submissionDeadline,
    guessing_deadline: w.guessingDeadline,
  }));
  const result = await client.query<RoundRow>(
    `INSERT INTO rounds (league_id, round_number, theme, submission_opens_at, submission_deadline, guessing_deadline)
     SELECT $1, v.round_number, v.theme, v.submission_opens_at, v.submission_deadline, v.guessing_deadline
     FROM jsonb_to_recordset($2::jsonb) AS v(round_number int, theme text, submission_opens_at timestamptz,
                                             submission_deadline timestamptz, guessing_deadline timestamptz)
     RETURNING ${ROUND_COLUMNS}`,
    [leagueId, JSON.stringify(rows)],
  );
  return result.rows;
}

/** The league's rounds, locked for the rest of the transaction so two edits cannot interleave. */
async function lockSeason(client: PoolClient, leagueId: string): Promise<ScheduledRound[]> {
  const result = await client.query<{
    id: string;
    round_number: number;
    submission_opens_at: Date | null;
    submission_deadline: Date;
    guessing_deadline: Date;
  }>(
    `SELECT id, round_number, submission_opens_at, submission_deadline, guessing_deadline
     FROM rounds WHERE league_id = $1 ORDER BY round_number FOR UPDATE`,
    [leagueId],
  );
  return result.rows.map((r) => ({
    id: r.id,
    roundNumber: r.round_number,
    submissionOpensAt: r.submission_opens_at,
    submissionDeadline: r.submission_deadline,
    guessingDeadline: r.guessing_deadline,
  }));
}

/** Applies a plan's writes in one statement. `theme` renames the round it is keyed by. */
async function writeRounds(client: PoolClient, writes: RoundWrite[], theme?: { roundId: string; theme: string }) {
  if (writes.length === 0) return [];
  const rows = writes.map((w) => ({
    id: w.id,
    theme: w.id === theme?.roundId ? theme.theme : null,
    submission_opens_at: w.submissionOpensAt,
    submission_deadline: w.submissionDeadline,
    guessing_deadline: w.guessingDeadline,
    ...Object.fromEntries(FLAGS.map((f) => [f, w.clear.includes(f)])),
  }));
  const result = await client.query<RoundRow>(
    `UPDATE rounds r
     SET theme = COALESCE(v.theme, r.theme),
         submission_opens_at = v.submission_opens_at,
         submission_deadline = v.submission_deadline,
         guessing_deadline = v.guessing_deadline,
         ${FLAGS.map((f) => `${f} = CASE WHEN v.${f} THEN NULL ELSE r.${f} END`).join(',\n         ')}
     FROM jsonb_to_recordset($1::jsonb) AS v(id uuid, theme text, submission_opens_at timestamptz,
       submission_deadline timestamptz, guessing_deadline timestamptz, ${FLAGS.map((f) => `${f} boolean`).join(', ')})
     WHERE r.id = v.id
     RETURNING ${ROUND_COLUMNS.split(', ').map((c) => `r.${c}`).join(', ')}`,
    [JSON.stringify(rows)],
  );
  return result.rows.sort((a, b) => a.round_number - b.round_number);
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T | Refusal>): Promise<T | Refusal> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query(result && typeof result === 'object' && 'refused' in result ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Plans and applies an edit. Answers with every round it wrote, in round order. */
export function editRound(
  pool: Pool,
  leagueId: string,
  roundId: string,
  patch: { theme?: string; submissionDeadline?: Date; guessingDeadline?: Date },
  now: Date,
): Promise<RoundRow[] | Refusal> {
  return inTransaction(pool, async (client) => {
    const plan = planRoundEdit(await lockSeason(client, leagueId), roundId, patch, now);
    if ('refused' in plan) return plan;
    return writeRounds(client, plan, patch.theme === undefined ? undefined : { roundId, theme: patch.theme });
  });
}

/** Plans and applies a delete: drops the round, closes the gap in numbering, shortens the season. */
export function deleteRound(pool: Pool, leagueId: string, roundId: string, now: Date): Promise<null | Refusal> {
  return inTransaction(pool, async (client) => {
    const season = await lockSeason(client, leagueId);
    const plan = planRoundDelete(season, roundId, now);
    if ('refused' in plan) return plan;
    const { roundNumber } = season.find((r) => r.id === roundId)!;
    // Submissions, guesses and exports cascade off the round.
    await client.query('DELETE FROM rounds WHERE id = $1', [roundId]);
    await writeRounds(client, plan.writes);
    // UNIQUE (league_id, round_number) is checked per row, so a straight decrement can collide
    // mid-statement; park the renumbered rounds on negatives first.
    await client.query('UPDATE rounds SET round_number = -round_number WHERE league_id = $1 AND round_number > $2', [leagueId, roundNumber]);
    await client.query('UPDATE rounds SET round_number = -round_number - 1 WHERE league_id = $1 AND round_number < 0', [leagueId]);
    await client.query('UPDATE leagues SET season_length = season_length - 1 WHERE id = $1', [leagueId]);
    return null;
  });
}
