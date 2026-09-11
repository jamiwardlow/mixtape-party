import type { EmailChannel, NotificationPayload, PushChannel, PushToken } from './types.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Real push sender for Expo-registered devices; no API key needed for Expo's push endpoint.
 *
 * ponytail: web subscriptions are accepted by `POST /notifications/push-tokens` but not yet
 * delivered to — there's no web client in this repo to produce a real PushSubscription against,
 * so sending would be untestable dead code. Add real Web Push (VAPID + payload encryption, via
 * the `web-push` package) once a web/PWA client exists to register one.
 */
export class ExpoWebPushChannel implements PushChannel {
  async send(tokens: PushToken[], payload: NotificationPayload): Promise<void> {
    const expoTokens = tokens.filter((t) => t.platform === 'expo').map((t) => t.token);
    if (expoTokens.length === 0) return;
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(expoTokens.map((to) => ({ to, title: payload.title, body: payload.body }))),
    });
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
      body: JSON.stringify({ from: this.from, to: email, subject: payload.title, text: payload.body }),
    });
    // Log and throw. The auth routes catch it and still answer 204 — a failed send must not be
    // distinguishable from a successful one, or the response reveals whether the address exists.
    if (!res.ok) {
      console.error('resend send failed', res.status, await res.text());
      throw new Error(`resend send failed with ${res.status}`);
    }
  }
}
