/**
 * Scoring and guessing progress. One definition of a correct guess and of "guesses owed", in JS
 * for in-memory rows and in SQL for set-based queries. The two halves of each rule sit next to
 * each other: change them together.
 *
 * Scoring rule: 1 point per correct guess. A guess is correct when it names the track's submitter,
 * and submitters never score for their own track.
 */
import type { Pool } from 'pg';
import { roundSql } from './roundTimeline.js';
import type { Player } from './routes/rounds.js';

export interface GuessFacts {
  guesserId: string;
  guessedId: string | null;
  submitterId: string;
}

export const isCorrectGuess = (g: GuessFacts) => g.guessedId === g.submitterId && g.guesserId !== g.submitterId;

/** isCorrectGuess over a `guesses` row aliased `g` joined to its `submissions` row aliased `s`. */
export const correctGuessSql = (g = 'g', s = 's') =>
  `(${g}.guessed_account_id = ${s}.account_id AND ${g}.guesser_account_id <> ${s}.account_id)`;

/** Correct guesses per guesser. Guessers with none are absent. */
export function countCorrectGuesses(guesses: GuessFacts[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const g of guesses) if (isCorrectGuess(g)) counts.set(g.guesserId, (counts.get(g.guesserId) ?? 0) + 1);
  return counts;
}

/**
 * Shared by a round's results, final standings and the league overview. `winners` is everyone
 * tied at the top: no tiebreak, and nobody wins a scoreless board. Ranked by score then name so
 * ties come back in a stable order rather than whatever the roster query returned.
 */
export function scoreboard(
  members: Player[],
  correctGuesses: Map<string, number>,
): { scores: Array<Player & { score: number }>; winners: Array<Player & { score: number }> } {
  const scores = members
    .map((member) => ({ ...member, score: correctGuesses.get(member.accountId) ?? 0 }))
    .sort((a, b) => b.score - a.score || (a.displayName ?? '').localeCompare(b.displayName ?? ''));
  const topScore = Math.max(0, ...scores.map((s) => s.score));
  return { scores, winners: topScore > 0 ? scores.filter((s) => s.score === topScore) : [] };
}

/**
 * Correct guesses per player across a league's *scored* rounds. A round still being guessed is
 * excluded: a running correct-guess count mid-round narrows what is left to guess, which is the
 * same leak the submitter list is withheld for.
 */
export async function correctGuessCounts(pool: Pool, leagueId: string): Promise<Map<string, number>> {
  const result = await pool.query<{ guesser_account_id: string; correct_count: string }>(
    `SELECT g.guesser_account_id, count(*) AS correct_count
     FROM guesses g
     JOIN submissions s ON s.id = g.submission_id
     JOIN rounds r ON r.id = s.round_id
     WHERE r.league_id = $1 AND ${correctGuessSql()}
       AND ${roundSql('r').scored}
     GROUP BY g.guesser_account_id`,
    [leagueId],
  );
  return new Map(result.rows.map((row) => [row.guesser_account_id, Number(row.correct_count)]));
}

type Bestie = Player & { count: number };

/**
 * The top 3 players paired with `accountId` by correct guesses across every league's scored
 * rounds, or just `leagueId`'s when given (same deadline rule as `correctGuessCounts`).
 * `guessedMe` = people who guessed my tracks; `iGuessed` = people whose tracks I guessed.
 */
export async function topBesties(pool: Pool, accountId: string, direction: 'guessedMe' | 'iGuessed', leagueId?: string): Promise<Bestie[]> {
  const [meCol, themCol] = direction === 'guessedMe' ? ['s.account_id', 'g.guesser_account_id'] : ['g.guesser_account_id', 's.account_id'];
  const result = await pool.query<{ account_id: string; display_name: string | null; count: string }>(
    `SELECT a.id AS account_id, a.display_name, count(*) AS count
     FROM guesses g
     JOIN submissions s ON s.id = g.submission_id
     JOIN rounds r ON r.id = s.round_id
     JOIN accounts a ON a.id = ${themCol}
     WHERE ${meCol} = $1 AND ${correctGuessSql()}
       AND ${roundSql('r').scored}${leagueId ? ' AND r.league_id = $2' : ''}
     GROUP BY a.id, a.display_name
     ORDER BY count(*) DESC, a.display_name, a.id
     LIMIT 3`,
    leagueId ? [accountId, leagueId] : [accountId],
  );
  return result.rows.map((row) => ({ accountId: row.account_id, displayName: row.display_name, count: Number(row.count) }));
}

/** A guess on every track in the round but your own; a non-submitter owes one on all of them. */
export const guessesOwed = (submitterIds: ReadonlySet<string>, accountId: string) =>
  submitterIds.size - (submitterIds.has(accountId) ? 1 : 0);

export const guessesRemaining = (submitterIds: ReadonlySet<string>, accountId: string, guessesMade: number) =>
  Math.max(0, guessesOwed(submitterIds, accountId) - guessesMade);

/** Every owed guess made. A round with nothing to guess finishes nobody. */
export const finishedGuessing = (submitterIds: ReadonlySet<string>, accountId: string, guessesMade: number) =>
  guessesOwed(submitterIds, accountId) > 0 && guessesRemaining(submitterIds, accountId, guessesMade) === 0;

/**
 * `guessesRemaining > 0` as a SQL boolean over a round id and an account id expression (a bound
 * parameter or a column like `lm.account_id`): "still owes guesses".
 */
export const owesGuessesSql = (roundId: string, accountId: string) =>
  `((SELECT count(*) FROM guesses made_g JOIN submissions made_s ON made_s.id = made_g.submission_id
     WHERE made_s.round_id = ${roundId} AND made_g.guesser_account_id = ${accountId})
    < (SELECT count(*) FROM submissions owed_s WHERE owed_s.round_id = ${roundId} AND owed_s.account_id <> ${accountId}))`;
