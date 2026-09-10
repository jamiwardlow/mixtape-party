import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { startTestDb, type TestDb } from './testDb.js';
import {
  buildApp as buildTestApp,
  closeGuessingWindow as closeGuessingWindowFor,
  closeSubmissionWindow as closeSubmissionWindowFor,
  createLeagueWithPlayers,
  linkFakeAppleMusic,
  round1,
  signUp,
} from './testHelpers.js';
import { FAKE_BANDCAMP_URL } from '../adapters/fakeAdapter.js';

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
    const { app, appleMusicAdapter } = buildApp();
    const { members } = await createLeagueWithPlayers(app, appleMusicAdapter, 4);

    const res = await exportRound(app, '00000000-0000-0000-0000-000000000000', members[0].token);
    expect(res.status).toBe(404);
  });

  it('rejects a requester who has not joined the league', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { roundId } = await createLeagueWithPlayers(app, appleMusicAdapter, 4);
    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);
    const outsider = await signUp(app, 'export-outsider@example.com');

    const res = await exportRound(app, roundId, outsider.token);
    expect(res.status).toBe(403);
  });

  it('rejects export before the guessing deadline passes', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, appleMusicAdapter, 4);
    await closeSubmissionWindow(roundId);

    const res = await exportRound(app, roundId, members[0].token);
    expect(res.status).toBe(403);
  });

  it('builds a playlist on apple_music (per-user linked) and youtube_music (shared server-held account), matching every non-bandcamp submission', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, appleMusicAdapter, 4);
    await linkFakeAppleMusic(app, appleMusicAdapter, members[0].token);
    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);

    const res = await exportRound(app, roundId, members[0].token);

    expect(res.status).toBe(200);
    const byService: Map<string, { matchedCount: number; skipped: unknown[]; playlistExternalId: string }> = new Map(
      res.body.services.map((s: { service: string }) => [s.service, s]),
    );
    expect(byService.has('apple_music')).toBe(true);
    expect(byService.has('youtube_music')).toBe(true);

    const appleMusicExport = byService.get('apple_music')!;
    expect(appleMusicExport.matchedCount).toBe(4);
    expect(appleMusicExport.skipped).toEqual([]);
    expect(appleMusicExport.playlistExternalId).toBeTruthy();
    expect(appleMusicAdapter.playlists.get(appleMusicExport.playlistExternalId)).toHaveLength(4);
  });

  it('excludes youtube_music from export when no server-held cookie is configured', async () => {
    const { app, appleMusicAdapter } = buildApp({ youtubeMusicCookie: '' });
    const { roundId, members } = await createLeagueWithPlayers(app, appleMusicAdapter, 4);
    await linkFakeAppleMusic(app, appleMusicAdapter, members[0].token);
    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);

    const res = await exportRound(app, roundId, members[0].token);

    expect(res.status).toBe(200);
    const services = res.body.services.map((s: { service: string }) => s.service);
    expect(services).toContain('apple_music');
    expect(services).not.toContain('youtube_music');
  });

  it('never includes a bandcamp submission in an exported playlist', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const host = await signUp(app, `host-${Date.now()}@example.com`);
    const created = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Bandcamp League', seasonLength: 8, ...round1 });
    const roundId = created.body.round.id as string;
    const inviteCode = created.body.inviteCode as string;
    await linkFakeAppleMusic(app, appleMusicAdapter, host.token);

    const bandcampPlayer = await signUp(app, `bandcamp-player-${Date.now()}@example.com`);
    await linkFakeAppleMusic(app, appleMusicAdapter, bandcampPlayer.token);
    await request(app).post(`/leagues/invite/${inviteCode}/join`).set('Authorization', `Bearer ${bandcampPlayer.token}`);

    await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ externalId: 'track-host', title: 'A Fine Song', artist: 'Artist', service: 'apple_music' });
    await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${bandcampPlayer.token}`)
      .send({ service: 'bandcamp', url: FAKE_BANDCAMP_URL });

    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);

    const res = await exportRound(app, roundId, host.token);
    expect(res.status).toBe(200);
    const appleMusicExport = res.body.services.find((s: { service: string }) => s.service === 'apple_music');
    expect(appleMusicExport.matchedCount).toBe(1);
    expect(appleMusicExport.skipped).toEqual([]); // bandcamp submission is excluded entirely, not skipped-with-fallback
    const appendedTitles: string[] = appleMusicAdapter.playlists
      .get(appleMusicExport.playlistExternalId)!
      .map((t: { title: string }) => t.title);
    expect(appendedTitles).toEqual(['A Fine Song']);
  });

  it('skips a track that fails to match on a service with an open-in-app fallback, without blocking the rest', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const host = await signUp(app, `host-${Date.now()}@example.com`);
    const created = await request(app)
      .post('/leagues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'No Match League', seasonLength: 8, ...round1 });
    const roundId = created.body.round.id as string;
    const inviteCode = created.body.inviteCode as string;
    await linkFakeAppleMusic(app, appleMusicAdapter, host.token);
    // Submitted (and matched) on YouTube Music, but forced to miss when the export tries to match it into Apple Music's catalog.
    appleMusicAdapter.forcedNoMatchTitles.add('Unmatchable Song');

    const other = await signUp(app, `player-${Date.now()}@example.com`);
    await linkFakeAppleMusic(app, appleMusicAdapter, other.token);
    await request(app).post(`/leagues/invite/${inviteCode}/join`).set('Authorization', `Bearer ${other.token}`);

    await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ service: 'youtube_music', externalId: 'track-host', title: 'Unmatchable Song', artist: 'Artist' });
    await request(app)
      .post(`/rounds/${roundId}/submissions`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ externalId: 'track-other', title: 'A Fine Song', artist: 'Artist', service: 'apple_music' });

    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);

    const res = await exportRound(app, roundId, host.token);
    expect(res.status).toBe(200);
    const appleMusicExport = res.body.services.find((s: { service: string }) => s.service === 'apple_music');
    expect(appleMusicExport.matchedCount).toBe(1);
    expect(appleMusicExport.skipped).toHaveLength(1);
    expect(appleMusicExport.skipped[0].title).toBe('Unmatchable Song');
    expect(appleMusicExport.skipped[0].playback.deepLink).toBeTruthy();
  });

  it('runs the export once per round, reusing the same playlist on a repeat request', async () => {
    const { app, appleMusicAdapter } = buildApp();
    const { roundId, members } = await createLeagueWithPlayers(app, appleMusicAdapter, 4);
    await linkFakeAppleMusic(app, appleMusicAdapter, members[0].token);
    await closeSubmissionWindow(roundId);
    await closeGuessingWindow(roundId);

    const first = await exportRound(app, roundId, members[0].token);
    const second = await exportRound(app, roundId, members[0].token);

    const firstAppleMusic = first.body.services.find((s: { service: string }) => s.service === 'apple_music');
    const secondAppleMusic = second.body.services.find((s: { service: string }) => s.service === 'apple_music');
    expect(secondAppleMusic.playlistExternalId).toBe(firstAppleMusic.playlistExternalId);
    expect(appleMusicAdapter.playlists.size).toBe(1);
  });
});
