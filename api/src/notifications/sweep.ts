import type { Pool } from 'pg';
import type { EmailChannel, NotificationPayload, NotificationType, PushChannel, PushToken } from './types.js';

export interface NotificationSweepDeps {
  pool: Pool;
  pushChannel: PushChannel;
  emailChannel: EmailChannel;
}

// ponytail: a single fixed fraction for both reminder types, not configurable per league/round.
// Add a per-league setting if leagues ever want to tune how early they're reminded.
const REMINDER_REMAINING_FRACTION = 0.2;

async function notifyAccounts(
  deps: NotificationSweepDeps,
  accountIds: string[],
  type: NotificationType,
  payload: NotificationPayload,
  refs: { roundId?: string; leagueId?: string },
): Promise<void> {
  if (accountIds.length === 0) return;

  await deps.pool.query(
    `INSERT INTO notifications (account_id, type, round_id, league_id, title, body)
     SELECT unnest($1::uuid[]), $2, $3, $4, $5, $6`,
    [accountIds, type, refs.roundId ?? null, refs.leagueId ?? null, payload.title, payload.body],
  );

  const settingsResult = await deps.pool.query<{ account_id: string; push_enabled: boolean; email_enabled: boolean }>(
    'SELECT account_id, push_enabled, email_enabled FROM notification_settings WHERE account_id = ANY($1)',
    [accountIds],
  );
  const settingsByAccount = new Map(settingsResult.rows.map((row) => [row.account_id, row]));
  const pushEnabledIds = accountIds.filter((id) => settingsByAccount.get(id)?.push_enabled ?? true);
  const emailEnabledIds = accountIds.filter((id) => settingsByAccount.get(id)?.email_enabled ?? true);

  const sends: Promise<unknown>[] = [];

  if (pushEnabledIds.length > 0) {
    sends.push(
      deps.pool
        .query<{ platform: PushToken['platform']; token: string }>(
          'SELECT platform, token FROM push_tokens WHERE account_id = ANY($1)',
          [pushEnabledIds],
        )
        .then((tokensResult) => {
          if (tokensResult.rows.length === 0) return;
          return deps.pushChannel.send(tokensResult.rows, payload);
        }),
    );
  }

  if (emailEnabledIds.length > 0) {
    sends.push(
      deps.pool
        .query<{ email: string }>('SELECT email FROM accounts WHERE id = ANY($1)', [emailEnabledIds])
        .then((accountsResult) =>
          Promise.all(accountsResult.rows.map((row) => deps.emailChannel.send(row.email, payload))),
        ),
    );
  }

  await Promise.all(sends);
}

async function leagueMemberIds(pool: Pool, leagueId: string): Promise<string[]> {
  const result = await pool.query<{ account_id: string }>('SELECT account_id FROM league_members WHERE league_id = $1', [
    leagueId,
  ]);
  return result.rows.map((row) => row.account_id);
}

async function sweepSubmissionReminders(deps: NotificationSweepDeps, now: Date): Promise<void> {
  const dueRounds = await deps.pool.query<{
    id: string;
    league_id: string;
    round_number: number;
    theme: string;
  }>(
    `SELECT id, league_id, round_number, theme FROM rounds
     WHERE submission_reminder_sent_at IS NULL
       AND submission_deadline > $1
       AND submission_deadline - (submission_deadline - created_at) * $2 <= $1`,
    [now.toISOString(), REMINDER_REMAINING_FRACTION],
  );

  for (const round of dueRounds.rows) {
    const missing = await deps.pool.query<{ account_id: string }>(
      `SELECT lm.account_id FROM league_members lm
       WHERE lm.league_id = $1
         AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.round_id = $2 AND s.account_id = lm.account_id)`,
      [round.league_id, round.id],
    );
    await notifyAccounts(
      deps,
      missing.rows.map((r) => r.account_id),
      'submission_reminder',
      {
        title: `Submission deadline approaching: Round ${round.round_number}`,
        body: `Submit your track for "${round.theme}" before the deadline.`,
      },
      { roundId: round.id, leagueId: round.league_id },
    );
    await deps.pool.query('UPDATE rounds SET submission_reminder_sent_at = $1 WHERE id = $2', [
      now.toISOString(),
      round.id,
    ]);
  }
}

async function sweepGuessingReminders(deps: NotificationSweepDeps, now: Date): Promise<void> {
  const dueRounds = await deps.pool.query<{
    id: string;
    league_id: string;
    round_number: number;
    theme: string;
  }>(
    `SELECT id, league_id, round_number, theme FROM rounds
     WHERE guessing_reminder_sent_at IS NULL
       AND guessing_deadline > $1
       AND guessing_deadline - (guessing_deadline - submission_deadline) * $2 <= $1`,
    [now.toISOString(), REMINDER_REMAINING_FRACTION],
  );

  for (const round of dueRounds.rows) {
    const incomplete = await deps.pool.query<{ account_id: string }>(
      `SELECT lm.account_id FROM league_members lm
       WHERE lm.league_id = $1
         AND (
           SELECT count(*) FROM guesses g
           JOIN submissions s ON s.id = g.submission_id
           WHERE s.round_id = $2 AND g.guesser_account_id = lm.account_id
         ) < (
           SELECT count(*) FROM submissions s WHERE s.round_id = $2 AND s.account_id != lm.account_id
         )`,
      [round.league_id, round.id],
    );
    await notifyAccounts(
      deps,
      incomplete.rows.map((r) => r.account_id),
      'guessing_reminder',
      {
        title: `Guessing deadline approaching: Round ${round.round_number}`,
        body: `Finish guessing who submitted each track for "${round.theme}" before the deadline.`,
      },
      { roundId: round.id, leagueId: round.league_id },
    );
    await deps.pool.query('UPDATE rounds SET guessing_reminder_sent_at = $1 WHERE id = $2', [
      now.toISOString(),
      round.id,
    ]);
  }
}

async function sweepResultsReady(deps: NotificationSweepDeps, now: Date): Promise<void> {
  const dueRounds = await deps.pool.query<{ id: string; league_id: string; round_number: number; theme: string }>(
    `SELECT id, league_id, round_number, theme FROM rounds
     WHERE results_notified_at IS NULL AND guessing_deadline <= $1`,
    [now.toISOString()],
  );

  for (const round of dueRounds.rows) {
    const members = await leagueMemberIds(deps.pool, round.league_id);
    await notifyAccounts(
      deps,
      members,
      'results_ready',
      {
        title: `Round ${round.round_number} results are ready`,
        body: `See who guessed right for "${round.theme}".`,
      },
      { roundId: round.id, leagueId: round.league_id },
    );
    await deps.pool.query('UPDATE rounds SET results_notified_at = $1 WHERE id = $2', [now.toISOString(), round.id]);
  }
}

async function sweepSeasonConcluded(deps: NotificationSweepDeps, now: Date): Promise<void> {
  const dueLeagues = await deps.pool.query<{ id: string; name: string }>(
    `SELECT DISTINCT l.id, l.name FROM leagues l
     JOIN rounds r ON r.league_id = l.id AND r.round_number >= l.season_length
     WHERE l.concluded_notified_at IS NULL AND r.guessing_deadline <= $1`,
    [now.toISOString()],
  );

  for (const league of dueLeagues.rows) {
    const members = await leagueMemberIds(deps.pool, league.id);
    await notifyAccounts(
      deps,
      members,
      'season_concluded',
      {
        title: `${league.name}'s season has concluded`,
        body: 'Check the final standings.',
      },
      { leagueId: league.id },
    );
    await deps.pool.query('UPDATE leagues SET concluded_notified_at = $1 WHERE id = $2', [now.toISOString(), league.id]);
  }
}

/** Finds every due reminder/alert across all leagues and dispatches it, exactly once each. Safe to call repeatedly. */
export async function runNotificationSweep(deps: NotificationSweepDeps, now: Date = new Date()): Promise<void> {
  await sweepSubmissionReminders(deps, now);
  await sweepGuessingReminders(deps, now);
  await sweepResultsReady(deps, now);
  await sweepSeasonConcluded(deps, now);
}
