import type { Pool } from 'pg';
import { exportableServiceNames, serviceFor } from '../adapters/registry.js';
import type { ServiceName } from '../adapters/types.js';
import { buildRoundExports, type PlaylistExportDeps } from '../playlistExport.js';
import { roundSql, seasonConcludedSql } from '../roundTimeline.js';
import { owesGuessesSql } from '../scoring.js';
import { WINDOW_REMINDERS, type Window } from '../seasonSchedule.js';
import { notifyAccounts, type NotifierDeps } from './notifier.js';
import type { NotificationPayload, NotificationType } from './types.js';

export interface NotificationSweepDeps extends NotifierDeps {
  /** Adapters for building playlists (#99). Unset skips that step. */
  playlists?: Omit<PlaylistExportDeps, 'pool'>;
  /** Origin of the web client; emailed links to the app start here. Unset omits them. */
  appBaseUrl?: string;
}

// ponytail: a single fixed fraction for both reminder types, not configurable per league/round.
// Add a per-league setting if leagues ever want to tune how early they're reminded.
const REMINDER_REMAINING_FRACTION = 0.2;
// ponytail: one fixed lead time for both last calls (#208). Make it per-league if leagues ask.
const LAST_CALL_HOURS = 3;

// Rounds 2..N of a season are scheduled before anyone names them (#74), so every notification
// body that interpolates a theme needs a fallback -- nobody should be told to submit a track for
// "null".
const ROUND_COLUMNS = `id, league_id, round_number, COALESCE(theme, 'Round ' || round_number) AS theme`;

/** The round timeline against the sweep's clock, bound as $1 in every due query below. */
const AT_SWEEP = roundSql('', '$1');

const { submission: SUBMISSION, guessing: GUESSING } = WINDOW_REMINDERS;

const NOT_DELETED = `NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = lm.account_id AND a.deleted_at IS NOT NULL)`;

interface DueRound {
  id: string;
  league_id: string;
  round_number: number;
  theme: string;
}

/**
 * One notification type the sweep sends, exactly once per row: when it is due, to whom, saying what,
 * and how it is marked sent. Methods (not arrow properties) so a kind over any row type fits the list.
 */
interface NotificationKind<Row extends { id: string }> {
  type: NotificationType;
  /** Selects the due rows. $1 is the sweep's clock. */
  dueSql: string;
  recipients(pool: Pool, row: Row): Promise<string[]>;
  message(row: Row, deps: NotificationSweepDeps): NotificationPayload | Promise<NotificationPayload>;
  refs(row: Row): { roundId?: string; leagueId?: string };
  /** Marks the row sent. $1 is the sweep's clock, $2 the row's id. */
  markSentSql: string;
}

async function accountIds(pool: Pool, sql: string, params: unknown[]): Promise<string[]> {
  return (await pool.query<{ account_id: string }>(sql, params)).rows.map((r) => r.account_id);
}

function leagueMemberIds(pool: Pool, leagueId: string): Promise<string[]> {
  return accountIds(pool, `SELECT account_id FROM league_members lm WHERE league_id = $1 AND ${NOT_DELETED}`, [leagueId]);
}

/** Members who have not submitted to the round yet. */
function nonSubmitterIds(pool: Pool, round: DueRound): Promise<string[]> {
  return accountIds(
    pool,
    `SELECT lm.account_id FROM league_members lm
     WHERE lm.league_id = $1 AND ${NOT_DELETED}
       AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.round_id = $2 AND s.account_id = lm.account_id)`,
    [round.league_id, round.id],
  );
}

/** Members who have not guessed every other member's submission yet. */
function unfinishedGuesserIds(pool: Pool, round: DueRound): Promise<string[]> {
  return accountIds(
    pool,
    `SELECT lm.account_id FROM league_members lm
     WHERE lm.league_id = $1 AND ${NOT_DELETED} AND ${owesGuessesSql('$2', 'lm.account_id')}`,
    [round.league_id, round.id],
  );
}

function appLink(deps: NotificationSweepDeps, path: string): string | undefined {
  return deps.appBaseUrl ? `${deps.appBaseUrl}${path}` : undefined;
}

const roundRefs = (round: DueRound) => ({ roundId: round.id, leagueId: round.league_id });

function submitMessage(title: string, round: DueRound, deps: NotificationSweepDeps): NotificationPayload {
  return {
    title,
    body: `Submit your track for "${round.theme}" before the deadline.`,
    appLink: appLink(deps, `/round/${round.id}/submit`),
    data: { roundId: round.id, screen: 'submit' },
  };
}

function guessMessage(title: string, round: DueRound, deps: NotificationSweepDeps): NotificationPayload {
  return {
    title,
    body: `Finish guessing who submitted each track for "${round.theme}" before the deadline.`,
    appLink: appLink(deps, `/round/${round.id}/guess`),
    data: { roundId: round.id, screen: 'guess' },
  };
}

/** A last call also marks its window's reminder sent, so the reminder never lands after it. */
const lastCallSentSql = (w: Window) => `UPDATE rounds SET ${w.lastCall} = $1, ${w.reminder} = COALESCE(${w.reminder}, $1) WHERE id = $2`;
const reminderSentSql = (w: Window) => `UPDATE rounds SET ${w.reminder} = $1 WHERE id = $2`;

// Last calls (#208) fire 3h before each deadline, and come first in the list: one that fires also
// marks its 20% reminder sent, so on a window under 15h -- or a late sweep that finds both due --
// only the last call is sent.
const submissionLastCall: NotificationKind<DueRound> = {
  type: 'submission_last_call',
  dueSql: `SELECT ${ROUND_COLUMNS} FROM rounds
    WHERE ${SUBMISSION.lastCall} IS NULL
      AND NOT ${AT_SWEEP.guessingOpened}
      AND submission_deadline - make_interval(hours => ${LAST_CALL_HOURS}) <= $1
      AND ${AT_SWEEP.submissionOpened}`,
  recipients: nonSubmitterIds,
  message: (round, deps) =>
    submitMessage(`Last call: Round ${round.round_number} submissions close in ${LAST_CALL_HOURS} hours`, round, deps),
  refs: roundRefs,
  markSentSql: lastCallSentSql(SUBMISSION),
};

const guessingLastCall: NotificationKind<DueRound> = {
  type: 'guessing_last_call',
  dueSql: `SELECT ${ROUND_COLUMNS} FROM rounds
    WHERE ${GUESSING.lastCall} IS NULL
      AND ${AT_SWEEP.unscored}
      AND guessing_deadline - make_interval(hours => ${LAST_CALL_HOURS}) <= $1
      AND ${AT_SWEEP.guessingOpened}`,
  recipients: unfinishedGuesserIds,
  message: (round, deps) =>
    guessMessage(`Last call: Round ${round.round_number} guessing closes in ${LAST_CALL_HOURS} hours`, round, deps),
  refs: roundRefs,
  markSentSql: lastCallSentSql(GUESSING),
};

const submissionReminder: NotificationKind<DueRound> = {
  type: 'submission_reminder',
  // Keyed off submission_opens_at, not created_at: every round of a season is inserted at
  // league creation, so created_at would make round 8's "window" span the whole season and its
  // reminder due on the first sweep. created_at is the fallback for rounds predating the
  // column, where the two were the same instant.
  dueSql: `SELECT ${ROUND_COLUMNS} FROM rounds
    WHERE ${SUBMISSION.reminder} IS NULL
      AND NOT ${AT_SWEEP.guessingOpened}
      AND submission_deadline - (submission_deadline - COALESCE(submission_opens_at, created_at)) * ${REMINDER_REMAINING_FRACTION} <= $1`,
  recipients: nonSubmitterIds,
  message: (round, deps) => submitMessage(`Submission deadline approaching: Round ${round.round_number}`, round, deps),
  refs: roundRefs,
  markSentSql: reminderSentSql(SUBMISSION),
};

const guessingReminder: NotificationKind<DueRound> = {
  type: 'guessing_reminder',
  dueSql: `SELECT ${ROUND_COLUMNS} FROM rounds
    WHERE ${GUESSING.reminder} IS NULL
      AND ${AT_SWEEP.unscored}
      AND guessing_deadline - (guessing_deadline - submission_deadline) * ${REMINDER_REMAINING_FRACTION} <= $1`,
  recipients: unfinishedGuesserIds,
  message: (round, deps) => guessMessage(`Guessing deadline approaching: Round ${round.round_number}`, round, deps),
  refs: roundRefs,
  markSentSql: reminderSentSql(GUESSING),
};

const resultsReady: NotificationKind<DueRound> = {
  type: 'results_ready',
  // A round with no submissions has no results to announce -- which is the normal state of a
  // round the season scheduled but never reached.
  dueSql: `SELECT ${ROUND_COLUMNS} FROM rounds
    WHERE results_notified_at IS NULL AND ${AT_SWEEP.scored}
      -- The season's final round is announced by season_concluded, whose wrap-up covers it.
      AND round_number < (SELECT season_length FROM leagues WHERE id = rounds.league_id)
      AND EXISTS (SELECT 1 FROM submissions s WHERE s.round_id = rounds.id)`,
  recipients: (pool, round) => leagueMemberIds(pool, round.league_id),
  message: (round, deps) => ({
    title: `Round ${round.round_number} results are ready`,
    body: `Submitters have been revealed for “${round.theme}”!\n\nSee who guessed correctly:`,
    appLink: appLink(deps, `/round/${round.id}/results`),
    data: { roundId: round.id, screen: 'results' },
  }),
  refs: roundRefs,
  markSentSql: 'UPDATE rounds SET results_notified_at = $1 WHERE id = $2',
};

const seasonConcluded: NotificationKind<{ id: string; name: string }> = {
  type: 'season_concluded',
  // round_number DESC territory, not the current-round ordering: a season concludes when its
  // genuinely final round is revealed.
  dueSql: `SELECT l.id, l.name FROM leagues l
    WHERE l.concluded_notified_at IS NULL AND ${seasonConcludedSql('l', '$1')}`,
  recipients: (pool, league) => leagueMemberIds(pool, league.id),
  message: (league, deps) => ({
    title: `${league.name}'s season has concluded. GGs!`,
    body: 'Check the final standings.',
    appLink: appLink(deps, `/league/${league.id}/final`),
    data: { leagueId: league.id, screen: 'final' },
  }),
  refs: (league) => ({ leagueId: league.id }),
  markSentSql: 'UPDATE leagues SET concluded_notified_at = $1 WHERE id = $2',
};

/** Tells every member guessing is open, with the playlist link when sweepPlaylists built one. */
const guessingOpen: NotificationKind<DueRound> = {
  type: 'guessing_open',
  dueSql: `SELECT ${ROUND_COLUMNS} FROM rounds
    WHERE guessing_notified_at IS NULL AND ${AT_SWEEP.guessingOpened}
      AND EXISTS (SELECT 1 FROM submissions s WHERE s.round_id = rounds.id)`,
  recipients: (pool, round) => leagueMemberIds(pool, round.league_id),
  async message(round, deps) {
    const exported = await deps.pool.query<{ service: ServiceName; playlist_external_id: string }>(
      'SELECT service, playlist_external_id FROM round_exports WHERE round_id = $1 AND playlist_external_id IS NOT NULL LIMIT 1',
      [round.id],
    );
    const playlist = exported.rows[0];
    return {
      title: `Round ${round.round_number}: guessing is open`,
      body: `Submissions are in for "${round.theme}". Guess who submitted each track!`,
      link: playlist && deps.playlists ? serviceFor(deps.playlists, playlist.service).playlistUrl?.(playlist.playlist_external_id) : undefined,
      appLink: appLink(deps, `/round/${round.id}/guess`),
      data: { roundId: round.id },
    };
  },
  refs: roundRefs,
  markSentSql: 'UPDATE rounds SET guessing_notified_at = $1 WHERE id = $2',
};

/** Every kind the sweep sends, in sending order. */
const NOTIFICATION_KINDS: NotificationKind<{ id: string }>[] = [
  submissionLastCall,
  guessingLastCall,
  submissionReminder,
  guessingReminder,
  resultsReady,
  seasonConcluded,
  guessingOpen,
];

async function sweepKind(deps: NotificationSweepDeps, kind: NotificationKind<{ id: string }>, now: Date): Promise<void> {
  const due = await deps.pool.query<{ id: string }>(kind.dueSql, [now.toISOString()]);
  for (const row of due.rows) {
    await notifyAccounts(deps, await kind.recipients(deps.pool, row), kind.type, await kind.message(row, deps), kind.refs(row));
    await deps.pool.query(kind.markSentSql, [now.toISOString(), row.id]);
  }
}

/**
 * Builds each round's playlist as soon as submissions close, so players can open it while guessing.
 * A round with no export row yet is due, so a build that threw (no row written) retries next sweep.
 * Owned by the league host: round_exports needs an account, and the playlist is the round's anyway.
 */
async function sweepPlaylists(deps: NotificationSweepDeps, now: Date): Promise<void> {
  if (!deps.playlists) return;
  const due = await deps.pool.query<{ id: string; host_account_id: string }>(
    `SELECT r.id, l.host_account_id FROM rounds r
     JOIN leagues l ON l.id = r.league_id
     WHERE ${roundSql('r', '$1').guessingOpened}
       AND EXISTS (SELECT 1 FROM submissions s WHERE s.round_id = r.id AND s.service = ANY($2))
       AND NOT EXISTS (SELECT 1 FROM round_exports e WHERE e.round_id = r.id)`,
    [now.toISOString(), exportableServiceNames(deps.playlists)],
  );
  for (const { id, host_account_id } of due.rows) {
    await buildRoundExports({ pool: deps.pool, ...deps.playlists }, id, host_account_id);
  }
}

/** Finds every due reminder/alert across all leagues and dispatches it, exactly once each. Safe to call repeatedly. */
export async function runNotificationSweep(deps: NotificationSweepDeps, now: Date = new Date()): Promise<void> {
  for (const kind of NOTIFICATION_KINDS) {
    // Built just before guessing_open, so it can link the one just built.
    if (kind === guessingOpen) await sweepPlaylists(deps, now);
    await sweepKind(deps, kind, now);
  }
  // Housekeeping; a push-service outage must not fail the sweep.
  await deps.pushChannel.checkReceipts?.().catch((err) => console.error('push receipt check failed', err));
}
