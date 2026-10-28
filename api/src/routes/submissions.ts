import { Router } from 'express';
import { ServiceUnavailableError, type ServiceName } from '../adapters/types.js';
import { thumbnailUrlOf } from '../adapters/thumbnail.js';
import { adapterFor, type AdapterRegistry } from '../adapters/registry.js';
import { requireAuth, type AccountsDeps, type AuthedRequest } from './accounts.js';
import { isLeagueMember, loadRound } from './rounds.js';

export interface SubmissionsDeps extends AccountsDeps, AdapterRegistry {}

function parseService(value: unknown): ServiceName | null {
  if (value === 'youtube_music' || value === 'bandcamp') {
    return value;
  }
  return null;
}

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
    const service = parseService(req.query.service);
    if (!service) {
      res.status(400).json({ error: 'unsupported service' });
      return;
    }
    if (service === 'bandcamp') {
      res.status(400).json({ error: 'bandcamp has no search; submit a track by pasting its URL' });
      return;
    }

    try {
      const results = await adapterFor(deps, service).search(query);
      res.json({ results: results.map((r) => ({ ...r, thumbnailUrl: thumbnailUrlOf(r.service, r.externalId, r.artId) })) });
    } catch (err) {
      if (err instanceof ServiceUnavailableError) {
        res.status(503).json({ error: 'search unavailable' });
        return;
      }
      throw err;
    }
  });

  router.post('/rounds/:roundId/submissions', requireAuth(deps), async (req, res) => {
    const accountId = (req as unknown as AuthedRequest).accountId;
    const body = req.body ?? {};
    const service = parseService(body.service);
    if (!service) {
      res.status(400).json({ error: 'unsupported service' });
      return;
    }

    const { externalId, title, artist, isrc, url } = body;
    const parsed = parseComment(body.comment);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const comment = parsed.comment;
    if (service === 'bandcamp') {
      if (typeof url !== 'string') {
        res.status(400).json({ error: 'url is required' });
        return;
      }
    } else if (
      typeof externalId !== 'string' ||
      typeof title !== 'string' ||
      typeof artist !== 'string' ||
      (isrc !== undefined && isrc !== null && typeof isrc !== 'string')
    ) {
      res.status(400).json({ error: 'externalId, title, and artist are required' });
      return;
    }

    const round = await loadRound(deps.pool, req.params.roundId);
    if (!round) {
      res.status(404).json({ error: 'round not found' });
      return;
    }

    if (!(await isLeagueMember(deps.pool, round.leagueId, accountId))) {
      res.status(403).json({ error: 'join the league before submitting to this round' });
      return;
    }

    if (round.submissionOpensAt && new Date(round.submissionOpensAt) > new Date()) {
      res.status(403).json({ error: 'the submission window for this round has not opened yet' });
      return;
    }

    if (new Date(round.submissionDeadline) <= new Date()) {
      res.status(403).json({ error: 'the submission window for this round has closed' });
      return;
    }

    let resolved: { externalId: string; title: string; artist: string; isrc: string | null; artId: number | null };
    if (service === 'bandcamp') {
      let submitted;
      try {
        submitted = await deps.bandcampAdapter.submit(url);
      } catch (err) {
        if (err instanceof ServiceUnavailableError) {
          res.status(503).json({ error: 'bandcamp unavailable' });
          return;
        }
        throw err;
      }
      if (!submitted) {
        res.status(400).json({ error: 'could not resolve that bandcamp url' });
        return;
      }
      resolved = { externalId: submitted.externalId, title: submitted.title, artist: submitted.artist, isrc: null, artId: submitted.artId ?? null };
    } else {
      try {
        const matched = await adapterFor(deps, service).match({ title, artist, isrc: isrc ?? undefined });
        if (!matched) {
          res.status(400).json({ error: 'track not found in catalog' });
          return;
        }
      } catch (err) {
        if (err instanceof ServiceUnavailableError) {
          res.status(503).json({ error: 'search unavailable' });
          return;
        }
        throw err;
      }
      resolved = { externalId, title, artist, isrc: isrc ?? null, artId: null };
    }

    // Submitting again replaces your track, up to the deadline checked above and no further --
    // there is no second gate and no "reopen". `DO UPDATE` rather than DELETE + INSERT keeps the
    // row id, so guesses.submission_id (ON DELETE CASCADE) never comes into it: unreachable while
    // no guess can exist before the submission deadline, and still correct if that ever changes.
    // created_at is left alone -- the submitter roster is ordered by it and a replacement should
    // not reshuffle it. Both paths answer 201: "your track for this round is now X".
    const submission = await deps.pool.query<{ id: string }>(
      `INSERT INTO submissions (round_id, account_id, service, external_id, title, artist, isrc, comment, art_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (round_id, account_id) DO UPDATE
         SET service = EXCLUDED.service, external_id = EXCLUDED.external_id,
             title = EXCLUDED.title, artist = EXCLUDED.artist, isrc = EXCLUDED.isrc,
             comment = EXCLUDED.comment, art_id = EXCLUDED.art_id
       RETURNING id`,
      [req.params.roundId, accountId, service, resolved.externalId, resolved.title, resolved.artist, resolved.isrc, comment, resolved.artId],
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
    if (new Date(round.submissionDeadline) <= new Date()) {
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
