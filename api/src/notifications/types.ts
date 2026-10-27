export type NotificationType = 'submission_reminder' | 'guessing_reminder' | 'guessing_open' | 'results_ready' | 'season_concluded' | 'comment_reply';

export interface NotificationPayload {
  title: string;
  body: string;
  /** Optional URL; emailed under the body. Push ignores it. */
  link?: string;
  /** Optional deep-link data; push delivers it to the app's tap handler. Email ignores it. */
  data?: { roundId: string; screen?: 'results' };
}

export interface PushToken {
  platform: 'expo' | 'web';
  token: string;
}

/** Delivers a notification to every device an account has registered (Seam: notification channel). */
export interface PushChannel {
  send(tokens: PushToken[], payload: NotificationPayload): Promise<void>;
}

/** Delivers a notification by email, as the fallback channel alongside push. */
export interface EmailChannel {
  send(email: string, payload: NotificationPayload): Promise<void>;
}
