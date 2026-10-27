import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { startTestDb, type TestDb } from './testDb.js';
import {
  buildApp as buildTestApp,
  closeGuessingWindow as closeGuessingWindowFor,
  closeSubmissionWindow as closeSubmissionWindowFor,
  createLeagueWithPlayers,
  round1,
  signUp,
} from './testHelpers.js';
import { FAKE_BANDCAMP_URL } from '../adapters/fakeAdapter.js';
import { ServiceUnavailableError } from '../adapters/types.js';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, 60_000);

afterEach(async () => {
  await testDb.reset();
});

afterAll(async () => {
  await testDb.teardown();
});

function buildApp(options?: { youtubeMusicCookie?: string }) {
  return buildTestApp(testDb.pool, options);
}

async function closeSubmissionWindow(roundId: string) {
  await closeSubmissionWindowFor(testDb.pool, roundId);
}

async function closeGuessingWindow(roundId: string) {
  await closeGuessingWindowFor(testDb.pool, roundId);
}

function exportRound(app: Express, roundId: string, token: string) {
  return request(app).post(`/rounds/${roundId}/export`).set('Authorization', `Bearer ${token}`);
}

describe('POST /rounds/:roundId/export', () => {
  it('404s for an unknown round', async () => {
    const { app } = buildApp();
    const { members } = await createLeagueWithPlayers(app, 4);

    const res = await exportRound(app, '00000000-0000-0000-0000-000000000000', members[0].token);
    expect(res.status).toBe(404);
  });

  it('rejects a requester who has not joined the league', async () => {
    const { app } = buildApp();
    const { roundId } = await createLeagueWithPlayers(app, 4);
    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);
    const outsider = await signUp(app, 'export-outsider@example.com');

    const res = await exportRound(app, roundId, outsider.token);
    expect(res.status).toBe(403);
  });

  it('rejects export before the submission deadline passes', async () => {
    const { app } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, 4);

    const res = await exportRound(app, roundId, members[0].token);
    expect(res.status).toBe(403);
  });

  it('serves the export while guessing is still open', async () => {
    const { app } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, 4);
    await closeSubmissionWindow(roundId);

    const res = await exportRound(app, roundId, members[0].token);
    expect(res.status).toBe(200);
    expect(res.body.services[0].status).toBe('ok');
  });

  it('builds a youtube_music playlist on the shared server-held account, matching every non-bandcamp submission', async () => {
    const { app, youtubeMusicAdapter } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, 4);
    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);

    const res = await exportRound(app, roundId, members[0].token);

    expect(res.status).toBe(200);
    expect(res.body.services).toHaveLength(1);
    const youtubeMusicExport = res.body.services[0];
    expect(youtubeMusicExport.service).toBe('youtube_music');
    expect(youtubeMusicExport.status).toBe('ok');
    expect(youtubeMusicExport.matchedCount).toBe(4);
    expect(youtubeMusicExport.skipped).toEqual([]);
    expect(youtubeMusicAdapter.playlists.get(youtubeMusicExport.playlistExternalId)).toHaveLength(4);
  });

  it('returns a playlist link built from the playlist id', async () => {
    const { app } = buildApp({ youtubeMusicCookie: 'fake-cookie' });
    const { roundId, members } = await createLeagueWithPlayers(app, 4);
    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);

    const res = await exportRound(app, roundId, members[0].token);

    expect(res.status).toBe(200);
    const youtubeMusicExport = res.body.services.find((s: { service: string }) => s.service === 'youtube_music');
    expect(youtubeMusicExport.playlistUrl).toBe(
      `https://music.youtube.com/playlist?list=${youtubeMusicExport.playlistExternalId}`,
    );
  });

  it('shares one youtube_music playlist across every player, since they all export through the same server-held account', async () => {
    const { app, youtubeMusicAdapter } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, 4);
    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);

    const first = await exportRound(app, roundId, members[0].token);
    const second = await exportRound(app, roundId, members[1].token);

    const youtubeMusicLink = (res: { body: { services: Array<{ service: string; playlistUrl: string }> } }) =>
      res.body.services.find((s) => s.service === 'youtube_music')!.playlistUrl;
    expect(youtubeMusicLink(first)).toBeTruthy();
    expect(youtubeMusicLink(second)).toBe(youtubeMusicLink(first));
    expect(youtubeMusicAdapter.playlists.size).toBe(1);
  });

  it('excludes youtube_music from export when no server-held cookie is configured', async () => {
    const { app } = buildApp({ youtubeMusicCookie: '' });
    const { roundId, members } = await createLeagueWithPlayers(app, 4);
    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);

    const res = await exportRound(app, roundId, members[0].token);

    expect(res.status).toBe(200);
    expect(res.body.services).toEqual([]);
  });

  it('never includes a bandcamp submission in an exported playlist', async () => {
    const { app, youtubeMusicAdapter } = buildApp();
    const host = await signUp(app, `host-${Date.now()}@example.com`);
    const created = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Bandcamp League', seasonLength: 8, ...round1 });
    const roundId = created.body.round.id as string;
    const inviteCode = created.body.inviteCode as string;

    const bandcampPlayer = await signUp(app, `bandcamp-player-${Date.now()}@example.com`);
    await request(app).post(`/leagues/invite/${inviteCode}/join`).set('Authorization', `Bearer ${bandcampPlayer.token}`);

    await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ externalId: 'track-host', title: 'A Fine Song', artist: 'Artist', service: 'youtube_music' });
    await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${bandcampPlayer.token}`)
      .send({ service: 'bandcamp', url: FAKE_BANDCAMP_URL });

    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);

    const res = await exportRound(app, roundId, host.token);
    expect(res.status).toBe(200);
    const youtubeMusicExport = res.body.services.find((s: { service: string }) => s.service === 'youtube_music');
    expect(youtubeMusicExport.matchedCount).toBe(1);
    expect(youtubeMusicExport.skipped).toEqual([]); // bandcamp submission is excluded entirely, not skipped-with-fallback
    const appendedTitles: string[] = youtubeMusicAdapter.playlists
      .get(youtubeMusicExport.playlistExternalId)!
      .map((t: { title: string }) => t.title);
    expect(appendedTitles).toEqual(['A Fine Song']);
  });

  // youtube_music runs on one server-held account, so its outage is app-wide -- still a failure, but
  // not one the requester can act on.
  it('reports an unreachable service as failed', async () => {
    const { app, youtubeMusicAdapter } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, 4);
    youtubeMusicAdapter.createPlaylist = async () => {
      throw new ServiceUnavailableError('youtube_music', 'youtube music is unreachable');
    };
    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);

    const res = await exportRound(app, roundId, members[0].token);

    expect(res.status).toBe(200);
    const youtubeMusicExport = res.body.services.find((s: { service: string }) => s.service === 'youtube_music');
    expect(youtubeMusicExport.status).toBe('failed');
    expect(youtubeMusicExport.playlistUrl).toBeNull();
  });

  it('runs the export once per round, reusing the same playlist on a repeat request', async () => {
    const { app, youtubeMusicAdapter } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, 4);
    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);

    const first = await exportRound(app, roundId, members[0].token);
    const second = await exportRound(app, roundId, members[0].token);

    const firstExport = first.body.services.find((s: { service: string }) => s.service === 'youtube_music');
    const secondExport = second.body.services.find((s: { service: string }) => s.service === 'youtube_music');
    expect(secondExport.playlistExternalId).toBe(firstExport.playlistExternalId);
    expect(youtubeMusicAdapter.playlists.size).toBe(1);
  });
});
