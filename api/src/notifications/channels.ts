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
 * ponytail: no email provider is configured anywhere in this repo (no SMTP/API-key env vars),
 * so this is a no-op rather than untestable, never-exercised integration code. Wire in a real
 * sender (e.g. nodemailer against SMTP_* env vars) once one exists.
 */
export class NoopEmailChannel implements EmailChannel {
  async send(): Promise<void> {}
}
