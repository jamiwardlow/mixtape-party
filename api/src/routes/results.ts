import { Router } from 'express';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { isLeagueMember, loadLatestRound, loadLeague, loadRound } from './rounds.js';

export type ResultsDeps = AccountsDeps;

interface Player {
  accountId: string;
  displayName: string | null;
}

export function createResultsRouter(deps: ResultsDeps): Router {
  const router = Router();

  router.get('/rounds/:roundId/results', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const round = await loadRound(deps.pool, req.params.roundId);
    if (!round) {
      res.status(404).json({ error: 'round not found' });
      return;
    }
    if (!(await isLeagueMember(deps.pool, round.leagueId, accountId))) {
      res.status(403).json({ error: 'join the league before viewing this round\'s results' });
      return;
    }
    if (new Date(round.guessingDeadline) > new Date()) {
      res.status(403).json({ error: 'results are not available until the guessing deadline passes' });
      return;
    }

    const membersResult = await deps.pool.query<{ account_id: string; display_name: string | null }>(
      `SELECT a.id AS account_id, a.display_name FROM league_members lm
       JOIN accounts a ON a.id = lm.account_id
       WHERE lm.league_id = $1`,
      [round.leagueId],
    );
    const players = new Map<string, Player>(
      membersResult.rows.map((row) => [row.account_id, { accountId: row.account_id, displayName: row.display_name }]),
    );

    const submissionsResult = await deps.pool.query<{
      id: string;
      service: 'spotify' | 'apple_music' | 'youtube_music' | 'bandcamp';
      title: string;
      artist: string;
      account_id: string;
    }>('SELECT id, service, title, artist, account_id FROM submissions WHERE round_id = $1 ORDER BY id', [
      req.params.roundId,
    ]);

    const guessesResult = await deps.pool.query<{
      submission_id: string;
      guesser_account_id: string;
      correct: boolean;
    }>(
      `SELECT g.submission_id, g.guesser_account_id, (g.guessed_account_id = s.account_id) AS correct
       FROM guesses g
       JOIN submissions s ON s.id = g.submission_id
       WHERE s.round_id = $1`,
      [req.params.roundId],
    );

    const correctGuessersBySubmission = new Map<string, Player[]>();
    const scores = new Map<string, number>(membersResult.rows.map((row) => [row.account_id, 0]));
    for (const guess of guessesResult.rows) {
      if (!guess.correct) continue;
      scores.set(guess.guesser_account_id, (scores.get(guess.guesser_account_id) ?? 0) + 1);
      const guesser = players.get(guess.guesser_account_id);
      if (!guesser) continue;
      const existing = correctGuessersBySubmission.get(guess.submission_id) ?? [];
      existing.push(guesser);
      correctGuessersBySubmission.set(guess.submission_id, existing);
    }

    const tracks = submissionsResult.rows.map((row) => ({
      submissionId: row.id,
      service: row.service,
      title: row.title,
      artist: row.artist,
      submitter: players.get(row.account_id) ?? { accountId: row.account_id, displayName: null },
      correctGuessers: correctGuessersBySubmission.get(row.id) ?? [],
      excludedFromExport: row.service === 'bandcamp',
    }));

    const scoreList = membersResult.rows.map((row) => ({
      accountId: row.account_id,
      displayName: row.display_name,
      score: scores.get(row.account_id) ?? 0,
    }));
    const topScore = Math.max(0, ...scoreList.map((s) => s.score));
    const winners = topScore > 0 ? scoreList.filter((s) => s.score === topScore) : [];

    res.json({ tracks, scores: scoreList, winners });
  });

  router.get('/leagues/:leagueId/standings', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const league = await loadLeague(deps.pool, req.params.leagueId);
    if (!league) {
      res.status(404).json({ error: 'league not found' });
      return;
    }
    if (!(await isLeagueMember(deps.pool, req.params.leagueId, accountId))) {
      res.status(403).json({ error: 'join the league before viewing final standings' });
      return;
    }

    const latest = (await loadLatestRound(deps.pool, req.params.leagueId))!;
    const concluded = latest.roundNumber >= league.seasonLength && new Date(latest.guessingDeadline) <= new Date();
    if (!concluded) {
      res.status(403).json({ error: 'final standings are not available until the season concludes' });
      return;
    }

    const membersResult = await deps.pool.query<{ account_id: string; display_name: string | null }>(
      `SELECT a.id AS account_id, a.display_name FROM league_members lm
       JOIN accounts a ON a.id = lm.account_id
       WHERE lm.league_id = $1`,
      [req.params.leagueId],
    );

    const correctGuessesResult = await deps.pool.query<{ guesser_account_id: string; correct_count: string }>(
      `SELECT g.guesser_account_id, count(*) AS correct_count
       FROM guesses g
       JOIN submissions s ON s.id = g.submission_id
       JOIN rounds r ON r.id = s.round_id
       WHERE r.league_id = $1 AND g.guessed_account_id = s.account_id
       GROUP BY g.guesser_account_id`,
      [req.params.leagueId],
    );

    const scores = new Map<string, number>(membersResult.rows.map((row) => [row.account_id, 0]));
    for (const row of correctGuessesResult.rows) {
      scores.set(row.guesser_account_id, Number(row.correct_count));
    }

    const scoreList = membersResult.rows.map((row) => ({
      accountId: row.account_id,
      displayName: row.display_name,
      score: scores.get(row.account_id) ?? 0,
    }));
    const topScore = Math.max(0, ...scoreList.map((s) => s.score));
    const winners = topScore > 0 ? scoreList.filter((s) => s.score === topScore) : [];

    res.json({ scores: scoreList, winners });
  });

  return router;
}
