import { Router } from 'express';
import type { Pool } from 'pg';
import { thumbnailUrlOf } from '../adapters/thumbnail.js';
import { blockedIds, isUuid, maskBlocked } from './blocks.js';
import { loadFavorites } from './guessing.js';
import { listLeagues } from './leagues.js';
import { avatarUrlOf, requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import {
  isLeagueMember,
  isSeasonConcluded,
  loadCurrentRound,
  loadLeague,
  loadRound,
  type Player,
} from './rounds.js';

export type ResultsDeps = AccountsDeps;

/**
 * The one scoring rule, shared by a round's results, final standings and the league overview:
 * 1 point per correct guess, submitters never score for their own track, and `winners` is
 * everyone tied at the top -- no tiebreak, and nobody wins a scoreless board. Ranked by score
 * then name so ties come back in a stable order rather than whatever the roster query returned.
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
     WHERE r.league_id = $1 AND g.guessed_account_id = s.account_id
       AND r.guessing_deadline <= now()
     GROUP BY g.guesser_account_id`,
    [leagueId],
  );
  return new Map(result.rows.map((row) => [row.guesser_account_id, Number(row.correct_count)]));
}

type Bestie = Player & { count: number };

/**
 * The top 3 players paired with `accountId` by correct guesses across every league's scored
 * rounds, or just `leagueId`'s when given (same deadline rule as `correctGuessCounts`). `guessedMe` = people who guessed my tracks;
 * `iGuessed` = people whose tracks I guessed.
 */
export async function topBesties(pool: Pool, accountId: string, direction: 'guessedMe' | 'iGuessed', leagueId?: string): Promise<Bestie[]> {
  const [meCol, themCol] = direction === 'guessedMe' ? ['s.account_id', 'g.guesser_account_id'] : ['g.guesser_account_id', 's.account_id'];
  const result = await pool.query<{ account_id: string; display_name: string | null; count: string }>(
    `SELECT a.id AS account_id, a.display_name, count(*) AS count
     FROM guesses g
     JOIN submissions s ON s.id = g.submission_id
     JOIN rounds r ON r.id = s.round_id
     JOIN accounts a ON a.id = ${themCol}
     WHERE ${meCol} = $1 AND ${themCol} <> $1 AND g.guessed_account_id = s.account_id
       AND r.guessing_deadline <= now()${leagueId ? ' AND r.league_id = $2' : ''}
     GROUP BY a.id, a.display_name
     ORDER BY count(*) DESC, a.display_name, a.id
     LIMIT 3`,
    leagueId ? [accountId, leagueId] : [accountId],
  );
  return result.rows.map((row) => ({ accountId: row.account_id, displayName: row.display_name, count: Number(row.count) }));
}

export function createResultsRouter(deps: ResultsDeps): Router {
  const router = Router();

  router.get('/accounts/me/besties', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const [guessedMe, iGuessed] = await Promise.all([
      topBesties(deps.pool, accountId, 'guessedMe'),
      topBesties(deps.pool, accountId, 'iGuessed'),
    ]);
    res.json({ guessedMe, iGuessed });
  });

  // Public fields only, open to any signed-in user (#177). Never email, tokens or notification settings.
  // A player the viewer has blocked is a 404, same as one that doesn't exist.
  router.get('/players/:id', requireAuth(deps), async (req, res) => {
    const viewerId = (req as unknown as AuthedRequest).accountId;
    const id = req.params.id;
    const found = isUuid(id)
      ? (
          await deps.pool.query<{ display_name: string | null; avatar_updated_at: Date | null; pronouns: string | null; about_me: string | null }>(
            'SELECT display_name, avatar_updated_at, pronouns, about_me FROM accounts WHERE id = $1',
            [id],
          )
        ).rows[0]
      : undefined;
    const blocked = await blockedIds(deps.pool, viewerId);
    if (!found || blocked.has(id)) {
      res.status(404).json({ error: 'player not found' });
      return;
    }
    const [leagues, favorites, guessedMe, iGuessed] = await Promise.all([
      listLeagues(deps.pool, id),
      loadFavorites(deps.pool, id),
      topBesties(deps.pool, id, 'guessedMe'),
      topBesties(deps.pool, id, 'iGuessed'),
    ]);
    res.json({
      accountId: id,
      displayName: found.display_name,
      avatarUrl: avatarUrlOf(id, found.avatar_updated_at),
      pronouns: found.pronouns,
      aboutMe: found.about_me,
      leagues: leagues.map(({ name, concluded, seasonLength, joinedAt }) => ({ name, concluded, seasonLength, joinedAt })),
      favorites: favorites.map(({ submissionId, leagueName, roundTheme, service, title, artist }) => ({
        submissionId,
        leagueName,
        roundTheme,
        service,
        title,
        artist,
      })),
      besties: {
        guessedMe: guessedMe.map((b) => maskBlocked(b, blocked)),
        iGuessed: iGuessed.map((b) => maskBlocked(b, blocked)),
      },
    });
  });

  router.get('/leagues/:leagueId/besties', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const { leagueId } = req.params;
    if (!(await loadLeague(deps.pool, leagueId))) {
      res.status(404).json({ error: 'league not found' });
      return;
    }
    if (!(await isLeagueMember(deps.pool, leagueId, accountId))) {
      res.status(403).json({ error: 'join the league before viewing its besties' });
      return;
    }
    const [guessedMe, iGuessed] = await Promise.all([
      topBesties(deps.pool, accountId, 'guessedMe', leagueId),
      topBesties(deps.pool, accountId, 'iGuessed', leagueId),
    ]);
    res.json({ guessedMe, iGuessed });
  });

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

    const membersResult = await deps.pool.query<{ account_id: string; display_name: string | null; avatar_updated_at: Date | null }>(
      `SELECT a.id AS account_id, a.display_name, a.avatar_updated_at FROM league_members lm
       JOIN accounts a ON a.id = lm.account_id
       WHERE lm.league_id = $1`,
      [round.leagueId],
    );
    // Blocked players' comments, replies and reactions are left out and their name and photo are
    // masked; their guesses still score.
    const blocked = await blockedIds(deps.pool, accountId);
    const players = new Map<string, Player>(
      membersResult.rows.map((row) => [
        row.account_id,
        maskBlocked({ accountId: row.account_id, displayName: row.display_name, avatarUrl: avatarUrlOf(row.account_id, row.avatar_updated_at) }, blocked),
      ]),
    );

    const submissionsResult = await deps.pool.query<{
      id: string;
      service: 'youtube_music' | 'bandcamp';
      external_id: string;
      art_id: string | null;
      title: string;
      artist: string;
      comment: string | null;
      guessing_note: string | null;
      account_id: string;
    }>('SELECT id, service, external_id, art_id, title, artist, comment, guessing_note, account_id FROM submissions WHERE round_id = $1 ORDER BY id', [
      req.params.roundId,
    ]);

    const guessesResult = await deps.pool.query<{
      submission_id: string;
      guesser_account_id: string;
      correct: boolean;
      id: string;
      comment: string | null;
    }>(
      `SELECT g.id, g.comment, g.submission_id, g.guesser_account_id, (g.guessed_account_id = s.account_id) AS correct
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

    const guessIds = guessesResult.rows.map((g) => g.id);
    const repliesResult = await deps.pool.query<{ id: string; guess_id: string; parent_reply_id: string | null; account_id: string; body: string; created_at: string }>(
      'SELECT id, guess_id, parent_reply_id, account_id, body, created_at FROM guess_replies WHERE guess_id = ANY($1) ORDER BY created_at, id',
      [guessIds],
    ).then((r) => {
      // Replies come oldest first, so a parent is always seen before its children; a reply under a
      // hidden one would be orphaned, so it goes too.
      const shown = new Set<string>();
      const rows = r.rows.filter((row) => {
        const ok = !blocked.has(row.account_id) && (row.parent_reply_id === null || shown.has(row.parent_reply_id));
        if (ok) shown.add(row.id);
        return ok;
      });
      return { ...r, rows };
    });
    const reactionsResult = await deps.pool.query<{ submission_id: string | null; guess_id: string | null; reply_id: string | null; account_id: string; emoji: string }>(
      'SELECT submission_id, guess_id, reply_id, account_id, emoji FROM comment_reactions WHERE submission_id = ANY($1) OR guess_id = ANY($2) OR reply_id = ANY($3)',
      [submissionsResult.rows.map((s) => s.id), guessIds, repliesResult.rows.map((r) => r.id)],
    );
    const favoritedIds = new Set(
      (
        await deps.pool.query<{ submission_id: string }>(
          'SELECT submission_id FROM favorites WHERE account_id = $1 AND submission_id = ANY($2)',
          [accountId, submissionsResult.rows.map((s) => s.id)],
        )
      ).rows.map((r) => r.submission_id),
    );
    const reactionsFor = (targetId: string) => {
      const counts = new Map<string, { emoji: string; count: number; mine: boolean }>();
      for (const r of reactionsResult.rows) {
        if ((r.submission_id ?? r.guess_id ?? r.reply_id) !== targetId || blocked.has(r.account_id)) continue;
        const entry = counts.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
        entry.count += 1;
        entry.mine ||= r.account_id === accountId;
        counts.set(r.emoji, entry);
      }
      return [...counts.values()];
    };
    const playerOf = (id: string): Player => players.get(id) ?? { accountId: id, displayName: null };
    const commentsBySubmission = new Map<string, unknown[]>();
    for (const g of guessesResult.rows) {
      if (!g.comment || blocked.has(g.guesser_account_id)) continue;
      const list = commentsBySubmission.get(g.submission_id) ?? [];
      list.push({
        guessId: g.id,
        guesser: playerOf(g.guesser_account_id),
        mine: g.guesser_account_id === accountId,
        comment: g.comment,
        reactions: reactionsFor(g.id),
        replies: repliesResult.rows
          .filter((r) => r.guess_id === g.id)
          .map((r) => ({ replyId: r.id, parentReplyId: r.parent_reply_id, mine: r.account_id === accountId, author: playerOf(r.account_id), body: r.body, createdAt: r.created_at, reactions: reactionsFor(r.id) })),
      });
      commentsBySubmission.set(g.submission_id, list);
    }

    const yourGuessBySubmission = new Map(
      guessesResult.rows.filter((g) => g.guesser_account_id === accountId).map((g) => [g.submission_id, { comment: g.comment }]),
    );

    const tracks = submissionsResult.rows.map((row) => ({
      submissionId: row.id,
      service: row.service,
      title: row.title,
      artist: row.artist,
      thumbnailUrl: thumbnailUrlOf(row.service, row.external_id, row.art_id),
      comment: row.comment,
      note: row.guessing_note,
      submitter: players.get(row.account_id) ?? { accountId: row.account_id, displayName: null },
      correctGuessers: correctGuessersBySubmission.get(row.id) ?? [],
      excludedFromExport: row.service === 'bandcamp',
      reactions: reactionsFor(row.id),
      favorited: favoritedIds.has(row.id),
      comments: commentsBySubmission.get(row.id) ?? [],
      yourGuess: yourGuessBySubmission.get(row.id) ?? null,
    }));

    res.json({ tracks, ...scoreboard([...players.values()], scores) });
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

    const current = await loadCurrentRound(deps.pool, req.params.leagueId);
    if (!isSeasonConcluded(league, current, new Date())) {
      res.status(403).json({ error: 'final standings are not available until the season concludes' });
      return;
    }

    const membersResult = await deps.pool.query<{ account_id: string; display_name: string | null; avatar_updated_at: Date | null }>(
      `SELECT a.id AS account_id, a.display_name, a.avatar_updated_at FROM league_members lm
       JOIN accounts a ON a.id = lm.account_id
       WHERE lm.league_id = $1`,
      [req.params.leagueId],
    );

    const members = membersResult.rows.map((row) => ({
      accountId: row.account_id,
      displayName: row.display_name,
      avatarUrl: avatarUrlOf(row.account_id, row.avatar_updated_at),
    }));

    res.json(scoreboard(members, await correctGuessCounts(deps.pool, req.params.leagueId)));
  });

  return router;
}
