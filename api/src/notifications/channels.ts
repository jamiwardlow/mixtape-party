import type { Pool } from 'pg';
import { renderEmail } from './emailHtml.js';
import type { EmailChannel, NotificationPayload, PushChannel, PushToken } from './types.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
/** Expo has receipts ready ~15 min after send and drops them after 24h. */
const RECEIPT_MIN_AGE = '5 minutes';
const RECEIPT_MAX_AGE = '24 hours';
const RECEIPT_BATCH = 1000; // Expo's per-request cap

type ExpoStatus = { status: 'ok'; id?: string } | { status: 'error'; details?: { error?: string } };

const isDead = (s: ExpoStatus) => s.status === 'error' && s.details?.error === 'DeviceNotRegistered';

/**
 * Real push sender for Expo-registered devices; no API key needed for Expo's push endpoint.
 *
 * Tickets are stored in `push_receipts`; `checkReceipts` (run by the sweep) later deletes tokens
 * Expo reports as `DeviceNotRegistered`, so uninstalled apps don't pile up in `push_tokens`.
 *
 * ponytail: web subscriptions are accepted by `POST /notifications/push-tokens` but not yet
 * delivered to — there's no web client in this repo to produce a real PushSubscription against,
 * so sending would be untestable dead code. Add real Web Push (VAPID + payload encryption, via
 * the `web-push` package) once a web/PWA client exists to register one.
 */
export class ExpoWebPushChannel implements PushChannel {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async send(tokens: PushToken[], payload: NotificationPayload): Promise<void> {
    const expoTokens = tokens.filter((t) => t.platform === 'expo').map((t) => t.token);
    if (expoTokens.length === 0) return;
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(expoTokens.map((to) => ({ to, title: payload.title, body: payload.body, data: payload.data }))),
    });
    if (!res.ok) return;
    // Tickets come back in request order. An immediate DeviceNotRegistered needs no receipt.
    const tickets: ExpoStatus[] = ((await res.json()) as { data?: ExpoStatus[] }).data ?? [];
    const pending: { id: string; token: string }[] = [];
    const dead: string[] = [];
    tickets.forEach((ticket, i) => {
      if (ticket.status === 'ok' && ticket.id) pending.push({ id: ticket.id, token: expoTokens[i] });
      else if (isDead(ticket)) dead.push(expoTokens[i]);
    });
    await this.deleteTokens(dead);
    if (pending.length > 0) {
      await this.pool.query(
        'INSERT INTO push_receipts (ticket_id, token) SELECT * FROM unnest($1::text[], $2::text[]) ON CONFLICT DO NOTHING',
        [pending.map((p) => p.id), pending.map((p) => p.token)],
      );
    }
  }

  async checkReceipts(): Promise<void> {
    await this.pool.query(`DELETE FROM push_receipts WHERE created_at < now() - interval '${RECEIPT_MAX_AGE}'`);
    const { rows } = await this.pool.query<{ ticket_id: string; token: string }>(
      `SELECT ticket_id, token FROM push_receipts WHERE created_at < now() - interval '${RECEIPT_MIN_AGE}' ORDER BY created_at LIMIT ${RECEIPT_BATCH}`,
    );
    if (rows.length === 0) return;
    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: rows.map((r) => r.ticket_id) }),
    });
    if (!res.ok) throw new Error(`expo getReceipts failed with ${res.status}`);
    const receipts = ((await res.json()) as { data?: Record<string, ExpoStatus> }).data ?? {};
    // Ids missing from the response aren't ready yet; they stay until the next sweep (or expire).
    const ready = rows.filter((r) => receipts[r.ticket_id]);
    await this.deleteTokens(
      ready.filter((r) => isDead(receipts[r.ticket_id])).map((r) => r.token),
    );
    await this.pool.query('DELETE FROM push_receipts WHERE ticket_id = ANY($1)', [ready.map((r) => r.ticket_id)]);
  }

  private async deleteTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.pool.query("DELETE FROM push_tokens WHERE platform = 'expo' AND token = ANY($1)", [tokens]);
  }
}

/**
 * Swallows outbound mail. `server.ts` picks this when RESEND_API_KEY is unset, so local dev and
 * CI need no Resend account — a password-reset link is then only visible in the API's own logs.
 */
export class NoopEmailChannel implements EmailChannel {
  async send(): Promise<void> {}
}

const RESEND_URL = 'https://api.resend.com/emails';

/**
 * Real email sender, one POST to Resend's REST API — no SDK for a single request.
 *
 * This one channel carries both transactional auth mail (password resets, magic links) and the
 * preference-gated reminder mail from `sweep.ts`. Auth mail must never be gated on
 * `notification_settings.email_enabled`: anyone who later adds unsubscribe logic *inside* this
 * class rather than at the sweep call site locks users out of their own accounts.
 */
export class ResendEmailChannel implements EmailChannel {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(email: string, payload: NotificationPayload): Promise<void> {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: email, subject: payload.title, ...renderEmail(payload) }),
    });
    // Log and throw. The auth routes catch it and still answer 204 — a failed send must not be
    // distinguishable from a successful one, or the response reveals whether the address exists.
    if (!res.ok) {
      console.error('resend send failed', res.status, await res.text());
      throw new Error(`resend send failed with ${res.status}`);
    }
  }
}
