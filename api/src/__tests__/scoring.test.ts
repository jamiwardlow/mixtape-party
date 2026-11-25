import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from './testDb.js';
import {
  correctGuessSql,
  countCorrectGuesses,
  finishedGuessing,
  guessesOwed,
  guessesRemaining,
  isCorrectGuess,
  owesGuessesSql,
  scoreboard,
} from '../scoring.js';

describe('isCorrectGuess', () => {
  it('is correct when the guess names the submitter', () => {
    expect(isCorrectGuess({ guesserId: 'a', guessedId: 'b', submitterId: 'b' })).toBe(true);
    expect(isCorrectGuess({ guesserId: 'a', guessedId: 'c', submitterId: 'b' })).toBe(false);
  });

  it('never scores a submitter for their own track', () => {
    expect(isCorrectGuess({ guesserId: 'b', guessedId: 'b', submitterId: 'b' })).toBe(false);
  });

  it('has a SQL twin with the same two conditions', () => {
    expect(correctGuessSql('g', 's')).toBe('(g.guessed_account_id = s.account_id AND g.guesser_account_id <> s.account_id)');
  });
});

describe('countCorrectGuesses', () => {
  it('counts correct guesses per guesser and skips wrong ones', () => {
    const counts = countCorrectGuesses([
      { guesserId: 'a', guessedId: 'b', submitterId: 'b' },
      { guesserId: 'a', guessedId: 'c', submitterId: 'c' },
      { guesserId: 'b', guessedId: 'c', submitterId: 'a' },
      { guesserId: 'c', guessedId: 'c', submitterId: 'c' },
    ]);
    expect(counts).toEqual(new Map([['a', 2]]));
  });
});

describe('scoreboard', () => {
  const alice = { accountId: 'a', displayName: 'Alice' };
  const bob = { accountId: 'b', displayName: 'Bob' };
  const cat = { accountId: 'c', displayName: 'Cat' };

  it('ranks by score then name, and every tied top scorer wins', () => {
    const { scores, winners } = scoreboard([cat, bob, alice], new Map([['b', 2], ['c', 2], ['a', 1]]));
    expect(scores.map((s) => [s.accountId, s.score])).toEqual([['b', 2], ['c', 2], ['a', 1]]);
    expect(winners.map((w) => w.accountId)).toEqual(['b', 'c']);
  });

  it('crowns nobody on a scoreless board', () => {
    expect(scoreboard([alice, bob], new Map()).winners).toEqual([]);
  });
});

describe('guessing progress', () => {
  const submitters = new Set(['a', 'b', 'c']);

  it('owes a guess on every track but your own', () => {
    expect(guessesOwed(submitters, 'a')).toBe(2);
    expect(guessesOwed(submitters, 'z')).toBe(3);
  });

  it('counts down the remaining guesses, never below zero', () => {
    expect(guessesRemaining(submitters, 'a', 1)).toBe(1);
    expect(guessesRemaining(submitters, 'a', 5)).toBe(0);
  });

  it('is finished once every owed guess is made', () => {
    expect(finishedGuessing(submitters, 'a', 1)).toBe(false);
    expect(finishedGuessing(submitters, 'a', 2)).toBe(true);
  });

  it('is not finished in a round with nothing to guess', () => {
    expect(finishedGuessing(new Set(['a']), 'a', 0)).toBe(false);
    expect(guessesRemaining(new Set(['a']), 'a', 0)).toBe(0);
  });

});

// The SQL twins against real rows: they must give the same answer as the JS rules above.
describe('SQL twins', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => {
    await db.teardown();
  });

  it('agree with the JS rules on one round', async () => {
    const q = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows;
    const [a, b, c, d] = (await q(
      "INSERT INTO accounts (email) SELECT 'p' || i || '@x.test' FROM generate_series(1, 4) i RETURNING id",
    )).map((r) => r.id as string);
    const [{ id: leagueId }] = await q(
      "INSERT INTO leagues (name, season_length, host_account_id, invite_code) VALUES ('L', 1, $1, 'CODE') RETURNING id",
      [a],
    );
    const [{ id: roundId }] = await q(
      "INSERT INTO rounds (league_id, round_number, submission_deadline, guessing_deadline) VALUES ($1, 1, now(), now()) RETURNING id",
      [leagueId],
    );
    await q('INSERT INTO league_members (league_id, account_id) SELECT $1, unnest($2::uuid[])', [leagueId, [a, b, c, d]]);
    // a, b, c submit; d doesn't.
    const subs = new Map<string, string>();
    for (const who of [a, b, c]) {
      const [{ id }] = await q(
        "INSERT INTO submissions (round_id, account_id, service, external_id, title, artist) VALUES ($1, $2, 'bandcamp', $3, 't', 'r') RETURNING id",
        [roundId, who, who],
      );
      subs.set(who, id);
    }
    const guesses = [
      { guesserId: a, guessedId: b, submitterId: b }, // correct
      { guesserId: a, guessedId: b, submitterId: c }, // wrong
      { guesserId: d, guessedId: c, submitterId: c }, // correct
      { guesserId: c, guessedId: c, submitterId: c }, // own track: never scores
    ];
    for (const g of guesses) {
      await q('INSERT INTO guesses (submission_id, guesser_account_id, guessed_account_id) VALUES ($1, $2, $3)', [
        subs.get(g.submitterId),
        g.guesserId,
        g.guessedId,
      ]);
    }

    const correctRows = await q(
      `SELECT g.guesser_account_id, count(*)::int AS n FROM guesses g JOIN submissions s ON s.id = g.submission_id
       WHERE ${correctGuessSql()} GROUP BY g.guesser_account_id`,
    );
    expect(new Map(correctRows.map((r) => [r.guesser_account_id, r.n]))).toEqual(countCorrectGuesses(guesses));

    const owing = await q(
      `SELECT lm.account_id FROM league_members lm WHERE lm.league_id = $1 AND ${owesGuessesSql('$2', 'lm.account_id')}`,
      [leagueId, roundId],
    );
    const submitters = new Set([a, b, c]);
    const made = (who: string) => guesses.filter((g) => g.guesserId === who).length;
    const owingJs = [a, b, c, d].filter((who) => guessesRemaining(submitters, who, made(who)) > 0);
    expect(owing.map((r) => r.account_id).sort()).toEqual(owingJs.sort());
  });
});
