export type ServiceName = 'apple_music' | 'youtube_music' | 'bandcamp';

export interface Player {
  accountId: string;
  displayName: string | null;
}

/** Nobody has to pick a name (#81), and a blank where a player should be reads as a bug. */
export const nameOf = (player: Player) => player.displayName ?? 'A player';

/** Derived from the two deadlines by the API, never stored — `api/src/routes/rounds.ts`. */
export type RoundPhase = 'submission' | 'guessing' | 'results';

/** What a round in each phase asks of you, and the screen that asks it. Shared by home and the season page. */
export const PHASE_META: Record<RoundPhase, { label: string; segment: 'submit' | 'guess' | 'results' }> = {
  submission: { label: 'Submit your track', segment: 'submit' },
  guessing: { label: 'Guess the submitters', segment: 'guess' },
  results: { label: 'See results', segment: 'results' },
};
