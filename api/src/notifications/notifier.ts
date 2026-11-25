/** Fans one notification out to accounts: the in-app record, then push and email per their settings. Used by the sweep and comments. */
import type { Pool } from 'pg';
import type { EmailChannel, NotificationPayload, NotificationType, PushChannel, PushToken } from './types.js';

export interface NotifierDeps {
  pool: Pool;
  pushChannel: PushChannel;
  emailChannel: EmailChannel;
}

/** Records a notification for each account, then delivers it by push and email per their settings. */
export async function notifyAccounts(
  deps: NotifierDeps,
  accountIds: string[],
  type: NotificationType,
  payload: NotificationPayload,
  refs: { roundId?: string; leagueId?: string },
  { email = true }: { email?: boolean } = {},
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
  const emailEnabledIds = email ? accountIds.filter((id) => settingsByAccount.get(id)?.email_enabled ?? true) : [];

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
