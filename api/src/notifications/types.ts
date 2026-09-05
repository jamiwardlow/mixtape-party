export type NotificationType = 'submission_reminder' | 'guessing_reminder' | 'results_ready' | 'season_concluded';

export interface NotificationPayload {
  title: string;
  body: string;
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
