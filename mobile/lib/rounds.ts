export type ServiceName = 'apple_music' | 'youtube_music' | 'bandcamp';

export interface Player {
  accountId: string;
  displayName: string | null;
}
