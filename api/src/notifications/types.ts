export type NotificationType = 'submission_reminder' | 'guessing_reminder' | 'guessing_open' | 'results_ready' | 'season_concluded' | 'comment_reply' | 'comment_reaction';

export interface NotificationPayload {
  title: string;
  body: string;
  /** Optional URL; emailed under the body. Push ignores it. */
  link?: string;
  /** Optional link to the app itself; emailed under `link`. Push ignores it. */
  appLink?: string;
  /** Optional deep-link data; push delivers it to the app's tap handler. Email ignores it. */
  /** `focus` is the comment or reply (or track) the results screen should scroll to. */
  data?: { roundId: string; screen?: 'results' | 'guess'; focus?: string } | { leagueId: string; screen: 'final' };
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
