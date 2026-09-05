import type { EmailChannel, NotificationPayload, PushChannel, PushToken } from './types.js';

/** In-memory stand-in for {@link PushChannel}, used to assert on what would have been sent without a real device. */
export class FakePushChannel implements PushChannel {
  readonly sent: Array<{ tokens: PushToken[]; payload: NotificationPayload }> = [];

  async send(tokens: PushToken[], payload: NotificationPayload): Promise<void> {
    this.sent.push({ tokens, payload });
  }
}

/** In-memory stand-in for {@link EmailChannel}, used to assert on what would have been sent without a real provider. */
export class FakeEmailChannel implements EmailChannel {
  readonly sent: Array<{ email: string; payload: NotificationPayload }> = [];

  async send(email: string, payload: NotificationPayload): Promise<void> {
    this.sent.push({ email, payload });
  }
}
