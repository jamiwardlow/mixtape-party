import { Router } from 'express';
import type { Pool } from 'pg';
import { thumbnailUrlOf } from '../adapters/thumbnail.js';
import { playbackAdapterFor, type AdapterRegistry } from '../adapters/registry.js';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { guardError as resultsGuardError, REACTION_TARGETS } from './comments.js';
import { PLAYLIST_URL } from './export.js';
import { isLeagueMember, loadRound } from './rounds.js';
import { parseComment } from './submissions.js';

export interface GuessingDeps extends AccountsDeps, AdapterRegistry {}

async function guessingGuardError(
  pool: Pool,
  leagueId: string,
  accountId: string,
  submissionDeadline: string,
): Promise<{ status: number; error: string } | null> {
  if (!(await isLeagueMember(pool, leagueId, accountId))) {
    return { status: 403, error: 'join the league before guessing on this round' };
  }
  if (new Date(submissionDeadline) > new Date()) {
    return { status: 403, error: 'guessing has not opened yet for this round' };
  }
  return null;
}

interface PreviewRow {
  service: 'youtube_music' | 'bandcamp';
  external_id: string;
  title: string;
  artist: string;
  isrc: string | null;
}

export function createGuessingRouter(deps: GuessingDeps): Router {
  const router = Router();
  const previewUrl = (row: PreviewRow) =>
    playbackAdapterFor(deps, row.service).getPreviewUrl({
      externalId: row.external_id,
      title: row.title,
      artist: row.artist,
      isrc: row.isrc ?? undefined,
      service: row.service,
    });

  router.get('/rounds/:roundId/guessing', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const round = await loadRound(deps.pool, req.params.roundId);
    if (!round) {
      res.status(404).json({ error: 'round not found' });
      return;
    }
    const guardError = await guessingGuardError(deps.pool, round.leagueId, accountId, round.submissionDeadline);
    if (guardError) {
      res.status(guardError.status).json({ error: guardError.error });
      return;
    }

    const playersResult = await deps.pool.query<{ account_id: string; display_name: string | null }>(
      `SELECT a.id AS account_id, a.display_name FROM league_members lm
       JOIN accounts a ON a.id = lm.account_id
       WHERE lm.league_id = $1 AND lm.account_id != $2
       ORDER BY a.display_name`,
      [round.leagueId, accountId],
    );

    const submissions = await deps.pool.query<{
      id: string;
      service: 'youtube_music' | 'bandcamp';
      external_id: string;
      title: string;
      artist: string;
      isrc: string | null;
      art_id: string | null;
      guessed_account_id: string | null;
      comment: string | null;
      mine: boolean;
    }>(
      // Your own track comes back too, flagged `mine`, with your note in `comment`. The flag is
      // computed per requester, so nothing here tells anyone else whose track is whose.
      `SELECT s.id, s.service, s.external_id, s.title, s.artist, s.isrc, s.art_id, g.guessed_account_id,
              CASE WHEN s.account_id = $1 THEN s.guessing_note ELSE g.comment END AS comment,
              (s.account_id = $1) AS mine
       FROM submissions s
       LEFT JOIN guesses g ON g.submission_id = s.id AND g.guesser_account_id = $1
       WHERE s.round_id = $2
       ORDER BY s.id`,
      [accountId, req.params.roundId],
    );

    const tracks = await Promise.all(
      submissions.rows.map(async (row) => {
        const playback = await playbackAdapterFor(deps, row.service).getPlaybackLaunchHandle({
          externalId: row.external_id,
          title: row.title,
          artist: row.artist,
          isrc: row.isrc ?? undefined,
          service: row.service,
        });
        return {
          submissionId: row.id,
          service: row.service,
          title: row.title,
          artist: row.artist,
          thumbnailUrl: thumbnailUrlOf(row.service, row.external_id, row.art_id),
          playback,
          guessedAccountId: row.guessed_account_id,
          comment: row.comment,
          mine: row.mine,
          excludedFromExport: row.service === 'bandcamp',
        };
      }),
    );

    res.json({
      tracks,
      players: playersResult.rows.map((row) => ({ accountId: row.account_id, displayName: row.display_name })),
    });
  });

  // Resolved at play time because Bandcamp's stream URLs are signed and expire. Carries nothing
  // about the submitter; `url: null` tells the client to fall back to the playback link.
  router.get('/rounds/:roundId/submissions/:submissionId/preview', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const found = await deps.pool.query<{
      service: 'youtube_music' | 'bandcamp';
      external_id: string;
      title: string;
      artist: string;
      isrc: string | null;
      league_id: string;
      submission_deadline: string;
    }>(
      `SELECT s.service, s.external_id, s.title, s.artist, s.isrc, r.league_id, r.submission_deadline
       FROM submissions s JOIN rounds r ON r.id = s.round_id
       WHERE s.id = $1 AND s.round_id = $2`,
      [req.params.submissionId, req.params.roundId],
    );
    const row = found.rows[0];
    if (!row) {
      res.status(404).json({ error: 'submission not found' });
      return;
    }
    const guardError = await guessingGuardError(deps.pool, row.league_id, accountId, row.submission_deadline);
    if (guardError) {
      res.status(guardError.status).json({ error: guardError.error });
      return;
    }
    const url = await previewUrl(row);
    res.json({ url });
  });

  // Not round-scoped, so the favorites screen can play any favorite. Same gate as favoriting.
  router.get('/submissions/:id/preview', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const error = await resultsGuardError(deps.pool, REACTION_TARGETS.submission_id, req.params.id, accountId);
    if (error) {
      res.status(error.status).json({ error: error.error });
      return;
    }
    const found = await deps.pool.query<PreviewRow>(
      'SELECT service, external_id, title, artist, isrc FROM submissions WHERE id = $1',
      [req.params.id],
    );
    res.json({ url: await previewUrl(found.rows[0]) });
  });

  // The submitter is deliberately not selected: favorites never reveal who submitted a track.
  router.get('/favorites', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const found = await deps.pool.query(
      `SELECT s.id AS "submissionId", r.id AS "roundId", l.name AS "leagueName", r.theme AS "roundTheme",
              r.round_number AS "roundNumber", s.service, s.title, s.artist, f.created_at AS "favoritedAt"
       FROM favorites f
       JOIN submissions s ON s.id = f.submission_id
       JOIN rounds r ON r.id = s.round_id
       JOIN leagues l ON l.id = r.league_id
       JOIN league_members lm ON lm.league_id = l.id AND lm.account_id = f.account_id
       WHERE f.account_id = $1
       ORDER BY f.created_at DESC`,
      [accountId],
    );
    const exported = await deps.pool.query<{ playlist_external_id: string }>(
      "SELECT playlist_external_id FROM favorite_exports WHERE account_id = $1 AND service = 'youtube_music'",
      [accountId],
    );
    const externalId = exported.rows[0]?.playlist_external_id;
    res.json({ favorites: found.rows, playlistUrl: externalId ? PLAYLIST_URL.youtube_music(externalId) : null });
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

    const guardError = await guessingGuardError(deps.pool, row.league_id, accountId, row.submission_deadline);
    if (guardError) {
      res.status(guardError.status).json({ error: guardError.error });
      return;
    }
    if (new Date(row.guessing_deadline) <= new Date()) {
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
    if (new Date(round.submissionDeadline) > new Date()) {
      res.status(403).json({ error: 'guessing has not opened yet for this round' });
      return;
    }
    if (new Date(round.guessingDeadline) <= new Date()) {
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
