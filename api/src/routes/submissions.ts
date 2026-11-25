import { Router } from 'express';
import { ServiceUnavailableError } from '../adapters/types.js';
import { findService, type AdapterRegistry } from '../adapters/registry.js';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { isLeagueMember, loadRound } from '../rounds.js';
import { guessingOpened, submissionOpened } from '../roundTimeline.js';

export interface SubmissionsDeps extends AccountsDeps, AdapterRegistry {}

export function parseComment(value: unknown): { ok: true; comment: string | null } | { ok: false; error: string } {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    return { ok: false, error: 'comment must be a string' };
  }
  const comment = (value ?? '').trim() || null;
  if (comment && comment.length > 500) return { ok: false, error: 'comment must be 500 characters or fewer' };
  return { ok: true, comment };
}

export function createSubmissionsRouter(deps: SubmissionsDeps): Router {
  const router = Router();

  router.get('/search', requireAuth(deps), async (req, res) => {
    const query = req.query.q;
    if (typeof query !== 'string' || query.trim().length === 0) {
      res.status(400).json({ error: 'q is required' });
      return;
    }
    const adapter = findService(deps, req.query.service);
    if (!adapter) {
      res.status(400).json({ error: 'unsupported service' });
      return;
    }
    if (!adapter.search) {
      res.status(400).json({ error: `${adapter.service} has no search; submit a track by pasting its URL` });
      return;
    }

    try {
      const results = await adapter.search(query);
      res.json({
        results: await Promise.all(
          results.map(async (r) => ({
            ...r,
            thumbnailUrl: adapter.thumbnailUrl(r),
            playback: await adapter.getPlaybackLaunchHandle(r),
          })),
        ),
      });
    } catch (err) {
      if (err instanceof ServiceUnavailableError) {
        res.status(503).json({ error: 'search unavailable' });
        return;
      }
      throw err;
    }
  });

  // Preview of a search result before it's submitted. Clients that predate `service` only ever
  // searched YouTube Music, so that's the default.
  router.get('/search/preview', requireAuth(deps), async (req, res) => {
    const { externalId, title, artist, isrc } = req.query;
    if (typeof externalId !== 'string' || typeof title !== 'string' || typeof artist !== 'string') {
      res.status(400).json({ error: 'externalId, title and artist are required' });
      return;
    }
    const adapter = findService(deps, req.query.service ?? 'youtube_music');
    if (!adapter) {
      res.status(400).json({ error: 'unsupported service' });
      return;
    }
    const url = await adapter.getPreviewUrl({
      externalId,
      title,
      artist,
      isrc: typeof isrc === 'string' ? isrc : undefined,
      service: adapter.service,
    });
    res.json({ url });
  });

  router.post('/rounds/:roundId/submissions', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const body = req.body ?? {};
    const adapter = findService(deps, body.service);
    if (!adapter) {
      res.status(400).json({ error: 'unsupported service' });
      return;
    }
    const parsed = parseComment(body.comment);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const comment = parsed.comment;

    const round = await loadRound(deps.pool, req.params.roundId);
    if (!round) {
      res.status(404).json({ error: 'round not found' });
      return;
    }

    if (!(await isLeagueMember(deps.pool, round.leagueId, accountId))) {
      res.status(403).json({ error: 'join the league before submitting to this round' });
      return;
    }

    if (!submissionOpened(round, new Date())) {
      res.status(403).json({ error: 'the submission window for this round has not opened yet' });
      return;
    }

    if (guessingOpened(round, new Date())) {
      res.status(403).json({ error: 'the submission window for this round has closed' });
      return;
    }

    const resolution = await adapter.resolveSubmission(body);
    if (!('track' in resolution)) {
      res.status(resolution.status).json({ error: resolution.error });
      return;
    }
    const { track } = resolution;

    // Submitting again replaces your track, up to the deadline checked above and no further --
    // there is no second gate and no "reopen". `DO UPDATE` rather than DELETE + INSERT keeps the
    // row id, so guesses.submission_id (ON DELETE CASCADE) never comes into it: unreachable while
    // no guess can exist before the submission deadline, and still correct if that ever changes.
    // created_at is left alone -- the submitter roster is ordered by it and a replacement should
    // not reshuffle it. Both paths answer 201: "your track for this round is now X".
    const submission = await deps.pool.query<{ id: string }>(
      `INSERT INTO submissions (round_id, account_id, service, external_id, title, artist, isrc, comment, art_id, page_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (round_id, account_id) DO UPDATE
         SET service = EXCLUDED.service, external_id = EXCLUDED.external_id,
             title = EXCLUDED.title, artist = EXCLUDED.artist, isrc = EXCLUDED.isrc,
             comment = EXCLUDED.comment, art_id = EXCLUDED.art_id, page_url = EXCLUDED.page_url
       RETURNING id`,
      [
        req.params.roundId,
        accountId,
        adapter.service,
        track.externalId,
        track.title,
        track.artist,
        track.isrc ?? null,
        comment,
        track.artId ?? null,
        track.pageUrl ?? null,
      ],
    );
    res.status(201).json({ submissionId: submission.rows[0].id });
  });

  // Edits just the comment on your existing track, up to the same deadline as replacing the track.
  router.patch('/rounds/:roundId/submissions/mine', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const parsed = parseComment(req.body?.comment);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const round = await loadRound(deps.pool, req.params.roundId);
    if (!round) {
      res.status(404).json({ error: 'round not found' });
      return;
    }
    if (guessingOpened(round, new Date())) {
      res.status(403).json({ error: 'the submission window for this round has closed' });
      return;
    }
    const updated = await deps.pool.query('UPDATE submissions SET comment = $1 WHERE round_id = $2 AND account_id = $3', [
      parsed.comment,
      req.params.roundId,
      accountId,
    ]);
    if (updated.rowCount === 0) {
      res.status(404).json({ error: 'you have not submitted a track to this round' });
      return;
    }
    res.status(204).end();
  });

  return router;
}
