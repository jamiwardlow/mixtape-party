export type ServiceName = 'youtube_music' | 'bandcamp';

export interface Player {
  accountId: string;
  displayName: string | null;
  avatarUrl?: string | null;
}

/** Nobody has to pick a name (#81), and a blank where a player should be reads as a bug. */
export const nameOf = (player: Player) => player.displayName || 'A player';

/** Derived from the round's schedule by the API, never stored — `api/src/roundTimeline.ts`. */
export type RoundPhase = 'upcoming' | 'submission' | 'guessing' | 'results';

/** What a round in each phase asks of you, and the screen that asks it. */
const PHASE_META: Record<RoundPhase, { label: string; segment: 'submit' | 'guess' | 'results' }> = {
  upcoming: { label: 'Not open yet', segment: 'submit' },
  submission: { label: 'Submit your track', segment: 'submit' },
  guessing: { label: 'Guess the submitters', segment: 'guess' },
  results: { label: 'See results', segment: 'results' },
};

/** PHASE_META's label, except that once your track is in, the submission phase offers to edit it. */
export const phaseLabel = (phase: RoundPhase, submitted: boolean) =>
  phase === 'submission' && submitted ? 'Edit your track' : PHASE_META[phase].label;

/** The round's CTA: what to do now and where to go. Null while upcoming, since nothing is open yet. */
export function nextStep(round: { id: string; phase: RoundPhase }, submitted: boolean) {
  if (round.phase === 'upcoming') return null;
  const edit = round.phase === 'submission' && submitted;
  return {
    label: phaseLabel(round.phase, submitted),
    href: {
      pathname: `/round/[roundId]/${PHASE_META[round.phase].segment}` as const,
      params: edit ? { roundId: round.id, edit: '1' } : { roundId: round.id },
    },
  };
}

const PHASE_STATUS: Record<RoundPhase, string> = {
  upcoming: 'Submissions open later',
  submission: 'Submissions are open',
  guessing: 'Guessing is open',
  results: 'This round is over',
};
/** What the round is doing right now, in words. nextStep says what to do about it. */
export const roundStatus = (phase: RoundPhase) => PHASE_STATUS[phase];

/**
 * Only while guesses are being made: before then it counts tracks nobody can guess yet, and
 * afterwards it is a leftover from a window that has shut.
 */
export function guessesLine(round: { phase: RoundPhase; you: { guessesRemaining: number } }) {
  if (round.phase !== 'guessing') return null;
  const n = round.you.guessesRemaining;
  return n === 0 ? 'You have made all your guesses' : `${n} guess${n === 1 ? '' : 'es'} to go`;
}

/**
 * A player's submission state, or null when it may not be shown. The server omits `submitters`
 * during guessing (naming the stragglers narrows the pool), so its absence is the only thing this
 * branches on — never the phase, which comes from clocks that can disagree.
 */
export function submissionMark(round: Pick<RoundSummary, 'submitters'>, accountId: string | undefined) {
  if (!round.submitters) return null;
  return hasSubmitted(round, accountId) ? 'Submitted' : 'No track yet';
}

/** False whenever the server withholds `submitters` — fine for nextStep, whose guessing CTA ignores it. */
export const hasSubmitted = (round: Pick<RoundSummary, 'submitters'>, accountId: string | undefined) =>
  !!round.submitters?.some((s) => s.accountId === accountId);

/** Who has submitted, named — or null while the server withholds them (or nobody has yet). */
export const submitterNames = (round: Pick<RoundSummary, 'submitters'>) =>
  round.submitters?.length ? round.submitters.map(nameOf).join(', ') : null;

/**
 * What the season list shows for a round. The current round has its own card above, so the list
 * only keeps its place; a finished round links to its results unless nobody submitted. The
 * server's phase, not this device's clock, decides "finished".
 */
export function seasonEntry(round: Pick<RoundSummary, 'phase' | 'submittedCount'> & { isCurrent: boolean }) {
  if (round.phase !== 'results') return round.isCurrent ? 'see above' : 'details';
  return round.submittedCount === 0 ? 'no tracks' : 'results';
}

/** A round as both overviews describe it. */
export interface RoundSummary {
  id: string;
  number: number;
  /** Null until someone names it — #74 schedules the season before its themes exist. */
  theme: string | null;
  submissionDeadline: string;
  guessingDeadline: string;
  phase: RoundPhase;
  submittedCount: number;
  /** Omitted while guessing is open — see submissionMark. */
  submitters?: Player[];
  /** Who has answered, never what they answered — safe to name in every phase. */
  guessedPlayers: Player[];
}

/** Your own track. Yours only: the server never sends anyone else's. */
export interface MySubmission {
  submissionId: string;
  playback: Playback;
  service: ServiceName;
  title: string;
  artist: string;
  thumbnailUrl: string | null;
  comment: string | null;
}

/** `GET /rounds/:roundId/overview`. */
export interface RoundOverview {
  leagueId: string;
  leagueName: string;
  round: RoundSummary & {
    you: { submitted: boolean; guessesRemaining: number; submission: MySubmission | null };
  };
}

export interface Score extends Player {
  score: number;
}

/** The part of `GET /leagues/:id/overview` that says how a season is going or ended. */
export interface SeasonResult {
  league: { id: string; name: string; concluded: boolean };
  standings: Score[];
  winners: Score[];
}

/** The link out to a track on its service, as the API returns it. */
export interface Playback {
  deepLink: string;
  webUrl?: string;
}
export const playbackHref = (playback: Playback) => playback.webUrl ?? playback.deepLink;
