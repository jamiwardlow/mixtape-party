import type { Pool } from 'pg';
import type { PlaybackLaunchHandle, ServiceName } from './adapters/types.js';
import { avatarUrlOf } from './routes/accounts.js';
import { blockedIds } from './routes/blocks.js';
import { isLeagueMember, type Player } from './routes/rounds.js';
import { guessingOpened, isScored, roundPhase, type RoundSchedule } from './roundTimeline.js';
import { finishedGuessing, guessesRemaining } from './scoring.js';

/**
 * Who can see and act on what in a league -- PRODUCT.md Principle 1 in one place. Routes ask this
 * module rather than re-deriving the rule, so a privacy fix lands once for every screen.
 */

export type GateError = { status: number; error: string };

/**
 * What part of a round is open: `guessing` (the tracks, anonymously, once submissions close) or
 * `results` (who submitted what, comments and replies, once guessing closes).
 */
export type Gate = 'guessing' | 'results';

const CLOSED: Record<Gate, string> = {
  guessing: 'guessing has not opened yet for this round',
  results: 'results are not available until the guessing deadline passes',
};

/** League members only, once the gate's deadline passes. */
export async function gateError(
  pool: Pool,
  viewerId: string,
  round: { leagueId: string } & Pick<RoundSchedule, 'submissionDeadline' | 'guessingDeadline'>,
  gate: Gate,
): Promise<GateError | null> {
  if (!(await isLeagueMember(pool, round.leagueId, viewerId))) return { status: 403, error: 'join the league before viewing this round' };
  const open = gate === 'guessing' ? guessingOpened(round, new Date()) : isScored(round, new Date());
  return open ? null : { status: 403, error: CLOSED[gate] };
}

export type Target = 'submission' | 'comment' | 'reply';

// A track is open to react to, favorite and preview once guessing opens; a comment (a guess with
// text) and a reply only once results do.
const TARGETS: Record<Target, { sql: string; gate: Gate }> = {
  submission: { gate: 'guessing', sql: 'FROM submissions s JOIN rounds r ON r.id = s.round_id WHERE s.id = $1' },
  comment: {
    gate: 'results',
    sql: 'FROM guesses g JOIN submissions s ON s.id = g.submission_id JOIN rounds r ON r.id = s.round_id WHERE g.id = $1 AND g.comment IS NOT NULL',
  },
  reply: {
    gate: 'results',
    sql: `FROM guess_replies p JOIN guesses g ON g.id = p.guess_id JOIN submissions s ON s.id = g.submission_id
          JOIN rounds r ON r.id = s.round_id WHERE p.id = $1`,
  },
};

/** The round gate for one submission, comment or reply, looked up by id; 404 when there is no such thing. */
export async function targetGateError(pool: Pool, viewerId: string, target: Target, id: string): Promise<GateError | null> {
  const { sql, gate } = TARGETS[target];
  const round = (
    await pool.query<{ leagueId: string; submissionDeadline: string; guessingDeadline: string }>(
      `SELECT r.league_id AS "leagueId", r.submission_deadline AS "submissionDeadline", r.guessing_deadline AS "guessingDeadline" ${sql}`,
      [id],
    )
  ).rows[0];
  return round ? gateError(pool, viewerId, round, gate) : { status: 404, error: 'not found' };
}

/** A blocked player shows as "Blocked player" with no photo wherever the blocker sees them. */
export function maskBlocked<T extends { accountId: string; displayName: string | null; avatarUrl?: string | null }>(player: T, blocked: Set<string>): T {
  return blocked.has(player.accountId) ? { ...player, displayName: 'Blocked player', avatarUrl: undefined } : player;
}

/**
 * The league's members as `viewerId` sees them, in join order: avatar URLs resolved and blocked
 * players masked. Deleted accounts stay on it on purpose -- their membership, tracks and guesses
 * outlive them (see DELETE /accounts/me) and their scrubbed name already reads as "A player".
 */
export async function rosterFor(pool: Pool, leagueId: string, viewerId: string): Promise<Array<Player & { joinedAt: string }>> {
  const [members, blocked] = await Promise.all([
    pool.query<{ account_id: string; display_name: string | null; avatar_updated_at: Date | null; joined_at: string }>(
      `SELECT a.id AS account_id, a.display_name, a.avatar_updated_at, lm.joined_at FROM league_members lm
       JOIN accounts a ON a.id = lm.account_id
       WHERE lm.league_id = $1
       ORDER BY lm.joined_at ASC`,
      [leagueId],
    ),
    blockedIds(pool, viewerId),
  ]);
  return members.rows.map((row) => ({
    ...maskBlocked({ accountId: row.account_id, displayName: row.display_name, avatarUrl: avatarUrlOf(row.account_id, row.avatar_updated_at) }, blocked),
    joinedAt: row.joined_at,
  }));
}

/** A roster entry without its join date, for responses that only name the player. */
export function asPlayer({ joinedAt: _, ...player }: Player & { joinedAt: string }): Player {
  return player;
}

/** What actually happened in one round: who submitted, and how many guesses each player made. */
export interface RoundActivity {
  /** Account ids that submitted, in submission order. */
  submitterIds: string[];
  /** Guesses made in this round, keyed by guesser. */
  guessCounts: Map<string, number>;
  /** The viewer's own track, or null. Never anyone else's -- see the note in describeRound. */
  yourSubmission: { service: ServiceName; title: string; artist: string; thumbnailUrl: string | null; comment?: string | null; submissionId: string; playback: PlaybackLaunchHandle } | null;
}

export function emptyRoundActivity(): RoundActivity {
  return { submitterIds: [], guessCounts: new Map(), yourSubmission: null };
}

/**
 * A round as one viewer may see it. The league overview and #84's single-round view both draw
 * from here -- two copies of the anonymity branch is exactly how the leak ships.
 *
 * `submitters` is present while submissions are open -- nobody is guessing yet and nagging the
 * stragglers is the point -- and again at results, where GET /rounds/:roundId/results already
 * names every submitter. It is *omitted by the server* during guessing, because naming who has
 * not submitted narrows the pool: in a small round one missing name
 * is close to decisive about the last track. A field the client is trusted not to render is a
 * field that leaks the first time someone opens devtools.
 *
 * `guessedPlayers` is safe in every phase: it says who has answered, never what they answered.
 */
export function describeRound(
  round: { id: string; number: number; theme: string | null; submissionOpensAt: string | null; submissionDeadline: string; guessingDeadline: string },
  activity: RoundActivity,
  players: Map<string, Player>,
  viewerAccountId: string,
  now: Date,
) {
  const phase = roundPhase(round, now);
  const submitters = new Set(activity.submitterIds);
  const guessesMade = (accountId: string) => activity.guessCounts.get(accountId) ?? 0;

  return {
    ...round,
    phase,
    submittedCount: submitters.size,
    ...(phase === 'guessing'
      ? {}
      : {
          submitters: activity.submitterIds.map(
            (id) => players.get(id) ?? { accountId: id, displayName: null },
          ),
        }),
    guessedPlayers: [...players.values()].filter((p) => finishedGuessing(submitters, p.accountId, guessesMade(p.accountId))),
    you: {
      submitted: submitters.has(viewerAccountId),
      guessesRemaining: guessesRemaining(submitters, viewerAccountId, guessesMade(viewerAccountId)),
      // Unconditional, on purpose: your own track is not a hint about anyone, in any phase, so it
      // sits outside the anonymity branch above. There is exactly one phase branch in here.
      submission: activity.yourSubmission,
    },
  };
}
