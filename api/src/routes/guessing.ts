import { Router } from 'express';
import type { Pool } from 'pg';
import type { ServiceName } from '../adapters/types.js';
import {
  playbackFor,
  exportableServiceNames,
  serviceFor,
  storedTrack,
  thumbnailFor,
  type AdapterRegistry,
  type StoredTrackRow,
} from '../adapters/registry.js';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { asPlayer, gateError, rosterFor, targetGateError } from '../visibility.js';
import { isLeagueMember, loadRound } from '../rounds.js';
import { guessingOpened, isScored } from '../roundTimeline.js';
import { parseComment } from './submissions.js';

export interface GuessingDeps extends AccountsDeps, AdapterRegistry {}

/** The account's favorites, newest first. The submitter is deliberately not selected: favorites never reveal who submitted a track. */
export async function loadFavorites(deps: AdapterRegistry & { pool: Pool }, accountId: string, withPlayback = false) {
  const found = await deps.pool.query(
    `SELECT s.id AS "submissionId", r.id AS "roundId", l.name AS "leagueName", r.theme AS "roundTheme",
            r.round_number AS "roundNumber", s.service, s.title, s.artist, f.created_at AS "favoritedAt",
            s.external_id, s.isrc, s.art_id, s.page_url
     FROM favorites f
     JOIN submissions s ON s.id = f.submission_id
     JOIN rounds r ON r.id = s.round_id
     JOIN leagues l ON l.id = r.league_id
     JOIN league_members lm ON lm.league_id = l.id AND lm.account_id = f.account_id
     WHERE f.account_id = $1
     ORDER BY f.created_at DESC`,
    [accountId],
  );
  // The ids only feed the thumbnail and the playback link; they aren't part of the payload.
  // Playback is wanted only on your own favorites, not the public profile.
  return Promise.all(
    found.rows.map(async ({ external_id, isrc, art_id, page_url, ...row }) => {
      const stored = { ...row, external_id, isrc, art_id, page_url };
      return {
        ...row,
        thumbnailUrl: thumbnailFor(deps, stored),
        ...(withPlayback && { playback: await playbackFor(deps, stored) }),
      };
    }),
  );
}

export function createGuessingRouter(deps: GuessingDeps): Router {
  const router = Router();
  // A service whose preview this server can't resolve may hand the client what it needs to find one itself.
  const previewBody = async (row: StoredTrackRow) => {
    const adapter = serviceFor(deps, row.service);
    const track = storedTrack(row);
    const url = await adapter.getPreviewUrl(track);
    return url ? { url } : { url, ...adapter.previewFallback?.(track) };
  };

  router.get('/rounds/:roundId/guessing', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const round = await loadRound(deps.pool, req.params.roundId);
    if (!round) {
      res.status(404).json({ error: 'round not found' });
      return;
    }
    const guardError = await gateError(deps.pool, accountId, round, 'guessing');
    if (guardError) {
      res.status(guardError.status).json({ error: guardError.error });
      return;
    }

    const submissions = await deps.pool.query<{
      id: string;
      service: ServiceName;
      external_id: string;
      title: string;
      artist: string;
      isrc: string | null;
      art_id: string | null;
      page_url: string | null;
      guessed_account_id: string | null;
      comment: string | null;
      mine: boolean;
      favorited: boolean;
    }>(
      // Your own track comes back too, flagged `mine`, with your note in `comment`. The flag is
      // computed per requester, so nothing here tells anyone else whose track is whose.
      `SELECT s.id, s.service, s.external_id, s.title, s.artist, s.isrc, s.art_id, s.page_url, g.guessed_account_id,
              CASE WHEN s.account_id = $1 THEN s.guessing_note ELSE g.comment END AS comment,
              (s.account_id = $1) AS mine,
              EXISTS (SELECT 1 FROM favorites f WHERE f.submission_id = s.id AND f.account_id = $1) AS favorited
       FROM submissions s
       LEFT JOIN guesses g ON g.submission_id = s.id AND g.guesser_account_id = $1
       WHERE s.round_id = $2
       ORDER BY s.id`,
      [accountId, req.params.roundId],
    );

    // Only your own reactions come back: counts are for the results.
    const mineBySubmission = new Map<string, { emoji: string; count: number; mine: boolean }[]>();
    const reacted = await deps.pool.query<{ submission_id: string; emoji: string }>(
      'SELECT submission_id, emoji FROM comment_reactions WHERE account_id = $1 AND submission_id = ANY($2)',
      [accountId, submissions.rows.map((s) => s.id)],
    );
    for (const r of reacted.rows) {
      mineBySubmission.set(r.submission_id, [...(mineBySubmission.get(r.submission_id) ?? []), { emoji: r.emoji, count: 1, mine: true }]);
    }

    const tracks = await Promise.all(
      submissions.rows.map(async (row) => {
        const playback = await playbackFor(deps, row);
        return {
          submissionId: row.id,
          service: row.service,
          title: row.title,
          artist: row.artist,
          thumbnailUrl: thumbnailFor(deps, row),
          playback,
          guessedAccountId: row.guessed_account_id,
          comment: row.comment,
          mine: row.mine,
          favorited: row.favorited,
          reactions: mineBySubmission.get(row.id) ?? [],
          excludedFromExport: !serviceFor(deps, row.service).exportable,
        };
      }),
    );

    res.json({
      tracks,
      // Sorted by the name the viewer sees, so a blocked player's real name can't place them in the list.
      players: (await rosterFor(deps.pool, round.leagueId, accountId))
        .filter((p) => p.accountId !== accountId)
        .map(asPlayer)
        .sort((a, b) => (a.displayName ?? '\uffff').localeCompare(b.displayName ?? '\uffff')),
    });
  });

  // Resolved at play time because Bandcamp's stream URLs are signed and expire. Carries nothing
  // about the submitter; `url: null` tells the client to fall back to the playback link.
  router.get('/rounds/:roundId/submissions/:submissionId/preview', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const found = await deps.pool.query<{
      service: ServiceName;
      external_id: string;
      title: string;
      artist: string;
      isrc: string | null;
      league_id: string;
      submission_deadline: string;
      guessing_deadline: string;
    }>(
      `SELECT s.service, s.external_id, s.title, s.artist, s.isrc, r.league_id, r.submission_deadline, r.guessing_deadline
       FROM submissions s JOIN rounds r ON r.id = s.round_id
       WHERE s.id = $1 AND s.round_id = $2`,
      [req.params.submissionId, req.params.roundId],
    );
    const row = found.rows[0];
    if (!row) {
      res.status(404).json({ error: 'submission not found' });
      return;
    }
    const guardError = await gateError(
      deps.pool,
      accountId,
      { leagueId: row.league_id, submissionDeadline: row.submission_deadline, guessingDeadline: row.guessing_deadline },
      'guessing',
    );
    if (guardError) {
      res.status(guardError.status).json({ error: guardError.error });
      return;
    }
    res.json(await previewBody(row));
  });

  // Not round-scoped, so the favorites screen can play any favorite. Same gate as favoriting, except your own track is always open to you.
  router.get('/submissions/:id/preview', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    // Your own track is previewable before guessing opens; everyone else's waits for the guard.
    const mine = await deps.pool.query('SELECT 1 FROM submissions WHERE id = $1 AND account_id = $2', [req.params.id, accountId]);
    const error = mine.rowCount ? null : await targetGateError(deps.pool, accountId, 'submission', req.params.id);
    if (error) {
      res.status(error.status).json({ error: error.error });
      return;
    }
    const found = await deps.pool.query<StoredTrackRow>(
      'SELECT service, external_id, title, artist, isrc, page_url FROM submissions WHERE id = $1',
      [req.params.id],
    );
    res.json(await previewBody(found.rows[0]));
  });

  router.get('/favorites', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const favorites = await loadFavorites(deps, accountId, true);
    // ponytail: one link, from whichever playlist service has an export; a list once there's a second one.
    const exported = await deps.pool.query<{ service: ServiceName; playlist_external_id: string }>(
      'SELECT service, playlist_external_id FROM favorite_exports WHERE account_id = $1 AND service = ANY($2)',
      [accountId, exportableServiceNames(deps)],
    );
    const row = exported.rows[0];
    res.json({ favorites, playlistUrl: row ? serviceFor(deps, row.service).playlistUrl?.(row.playlist_external_id) ?? null : null });
  });

  router.post('/rounds/:roundId/submissions/:submissionId/guesses', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const { guessedAccountId } = req.body ?? {};
    if (typeof guessedAccountId !== 'string' || guessedAccountId.trim().length === 0) {
      res.status(400).json({ error: 'guessedAccountId is required' });
      return;
    }

    const parsed = parseComment(req.body?.comment);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const submission = await deps.pool.query<{
      submitter_account_id: string;
      league_id: string;
      submission_deadline: string;
      guessing_deadline: string;
    }>(
      `SELECT sub.account_id AS submitter_account_id, r.league_id, r.submission_deadline, r.guessing_deadline
       FROM submissions sub
       JOIN rounds r ON r.id = sub.round_id
       WHERE sub.id = $1 AND sub.round_id = $2`,
      [req.params.submissionId, req.params.roundId],
    );
    const row = submission.rows[0];
    if (!row) {
      res.status(404).json({ error: 'submission not found' });
      return;
    }

    const guardError = await gateError(
      deps.pool,
      accountId,
      { leagueId: row.league_id, submissionDeadline: row.submission_deadline, guessingDeadline: row.guessing_deadline },
      'guessing',
    );
    if (guardError) {
      res.status(guardError.status).json({ error: guardError.error });
      return;
    }
    if (isScored({ guessingDeadline: row.guessing_deadline }, new Date())) {
      res.status(403).json({ error: 'guessing has closed for this round' });
      return;
    }
    if (row.submitter_account_id === accountId) {
      res.status(403).json({ error: 'you cannot guess on your own submission' });
      return;
    }
    if (!(await isLeagueMember(deps.pool, row.league_id, guessedAccountId))) {
      res.status(400).json({ error: 'guessedAccountId must be a member of this round\'s league' });
      return;
    }

    // Each player can be guessed on one track only; unselect it there (DELETE) before using it here.
    const taken = await deps.pool.query(
      `SELECT 1 FROM guesses g JOIN submissions s ON s.id = g.submission_id
       WHERE s.round_id = $1 AND g.guesser_account_id = $2 AND g.guessed_account_id = $3 AND g.submission_id != $4`,
      [req.params.roundId, accountId, guessedAccountId, req.params.submissionId],
    );
    if (taken.rowCount) {
      res.status(409).json({ error: 'you already guessed that player on another track' });
      return;
    }

    // A repeat POST changes the guess; the comment is only touched when one is sent.
    const upserted = await deps.pool.query<{ id: string; inserted: boolean }>(
      `INSERT INTO guesses (submission_id, guesser_account_id, guessed_account_id, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (submission_id, guesser_account_id) DO UPDATE
         SET guessed_account_id = EXCLUDED.guessed_account_id,
             comment = CASE WHEN $5 THEN EXCLUDED.comment ELSE guesses.comment END
       RETURNING id, (xmax = 0) AS inserted`,
      [req.params.submissionId, accountId, guessedAccountId, parsed.comment, req.body?.comment !== undefined],
    );
    const { id, inserted } = upserted.rows[0];
    res.status(inserted ? 201 : 200).json({ guessId: id });
  });

  // Unselects your guess on a track (frees that player for another track). Drops the guess's comment with it.
  router.delete('/rounds/:roundId/submissions/:submissionId/guesses', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const round = await deps.pool.query<{ guessing_deadline: string }>(
      `SELECT r.guessing_deadline FROM submissions s JOIN rounds r ON r.id = s.round_id WHERE s.id = $1 AND s.round_id = $2`,
      [req.params.submissionId, req.params.roundId],
    );
    if (!round.rows[0]) {
      res.status(404).json({ error: 'submission not found' });
      return;
    }
    if (isScored({ guessingDeadline: round.rows[0].guessing_deadline }, new Date())) {
      res.status(403).json({ error: 'guessing has closed for this round' });
      return;
    }
    await deps.pool.query('DELETE FROM guesses WHERE submission_id = $1 AND guesser_account_id = $2', [
      req.params.submissionId,
      accountId,
    ]);
    res.status(204).end();
  });

  // Edits (or clears) your comment on a guess you've made. Allowed at any time, results included.
  router.put('/rounds/:roundId/submissions/:submissionId/guesses/comment', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const parsed = parseComment(req.body?.comment);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const updated = await deps.pool.query(
      `UPDATE guesses g SET comment = $1 FROM submissions s
       WHERE g.submission_id = s.id AND s.id = $2 AND s.round_id = $3 AND g.guesser_account_id = $4`,
      [parsed.comment, req.params.submissionId, req.params.roundId, accountId],
    );
    if (!updated.rowCount) {
      res.status(404).json({ error: 'you have not guessed on this track' });
      return;
    }
    res.json({ comment: parsed.comment });
  });

  // Your note on your own track; open until the guessing deadline, like guesses.
  router.put('/rounds/:roundId/submissions/mine/note', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const parsed = parseComment(req.body?.note);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const round = await loadRound(deps.pool, req.params.roundId);
    if (!round) {
      res.status(404).json({ error: 'round not found' });
      return;
    }
    if (!guessingOpened(round, new Date())) {
      res.status(403).json({ error: 'guessing has not opened yet for this round' });
      return;
    }
    if (isScored(round, new Date())) {
      res.status(403).json({ error: 'guessing has closed for this round' });
      return;
    }
    const updated = await deps.pool.query('UPDATE submissions SET guessing_note = $1 WHERE round_id = $2 AND account_id = $3', [
      parsed.comment,
      req.params.roundId,
      accountId,
    ]);
    if (!updated.rowCount) {
      res.status(404).json({ error: 'you have not submitted a track to this round' });
      return;
    }
    res.json({ note: parsed.comment });
  });

  return router;
}
