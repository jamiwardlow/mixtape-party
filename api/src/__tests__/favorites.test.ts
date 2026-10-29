import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startTestDb, type TestDb } from './testDb.js';
import { buildApp, closeGuessingWindow, closeSubmissionWindow, createLeagueWithPlayers, signUp } from './testHelpers.js';

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

const auth = (m: { token: string }) => ({ Authorization: `Bearer ${m.token}` });

async function setup() {
  const { app, youtubeMusicAdapter } = buildApp(testDb.pool);
  const league = await createLeagueWithPlayers(app, 3);
  await closeSubmissionWindow(testDb.pool, league.roundId);
  const [a, b] = league.members;
  const track = league.submissions[1];
  const favorite = (m: { token: string }, id = track.submissionId) =>
    request(app).post(`/submissions/${id}/favorite`).set(auth(m));
  const favoritedFor = async (m: { token: string }) =>
    (await request(app).get(`/rounds/${league.roundId}/results`).set(auth(m))).body.tracks.find(
      (t: { submissionId: string }) => t.submissionId === track.submissionId,
    ).favorited;
  return { app, youtubeMusicAdapter, ...league, a, b, track, favorite, favoritedFor };
}

describe('favorites (#105)', () => {
  it('toggles on and off once results are open, visible only to the favoriter', async () => {
    const { roundId, a, b, favorite, favoritedFor } = await setup();
    await closeGuessingWindow(testDb.pool, roundId);
    expect((await favorite(a)).body).toEqual({ favorited: true });
    expect(await favoritedFor(a)).toBe(true);
    expect(await favoritedFor(b)).toBe(false);
    expect((await favorite(a)).body).toEqual({ favorited: false });
    expect(await favoritedFor(a)).toBe(false);
  });

  it('works while guessing is open and carries into the guessing list and results', async () => {
    const { app, roundId, a, track, favorite, favoritedFor } = await setup();
    expect((await favorite(a)).body).toEqual({ favorited: true });
    const guessing = await request(app).get(`/rounds/${roundId}/guessing`).set(auth(a));
    expect(guessing.body.tracks.find((t: { submissionId: string }) => t.submissionId === track.submissionId).favorited).toBe(true);
    await closeGuessingWindow(testDb.pool, roundId);
    expect(await favoritedFor(a)).toBe(true);
  });

  it('rejects before guessing opens, non-members, and unknown submissions', async () => {
    const { app, roundId, a, favorite } = await setup();
    await testDb.pool.query("UPDATE rounds SET submission_deadline = now() + interval '1 day' WHERE id = $1", [roundId]);
    expect((await favorite(a)).status).toBe(403);
    await closeGuessingWindow(testDb.pool, roundId);
    const outsider = await signUp(app, `outsider-${Date.now()}@example.com`);
    expect((await favorite(outsider)).status).toBe(403);
    expect((await favorite(a, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });
});

describe('listing favorites and previews (#107)', () => {
  it('lists newest-favorited first, without the submitter, only for the caller', async () => {
    const { app, roundId, a, b, submissions, favorite } = await setup();
    await closeGuessingWindow(testDb.pool, roundId);
    await favorite(a, submissions[1].submissionId);
    await favorite(a, submissions[2].submissionId);
    await favorite(b, submissions[0].submissionId);
    const res = await request(app).get('/favorites').set(auth(a));
    expect(res.status).toBe(200);
    expect(res.body.favorites.map((f: { submissionId: string }) => f.submissionId)).toEqual([
      submissions[2].submissionId,
      submissions[1].submissionId,
    ]);
    expect(res.body.favorites[0]).toEqual({
      submissionId: submissions[2].submissionId,
      roundId,
      leagueName: 'Office League',
      roundTheme: 'One-hit wonders',
      roundNumber: 1,
      service: 'youtube_music',
      title: expect.any(String),
      artist: 'Artist',
      favoritedAt: expect.any(String),
    });
  });

  it('drops favorites from a league the caller has left', async () => {
    const { app, roundId, a, favorite } = await setup();
    await closeGuessingWindow(testDb.pool, roundId);
    await favorite(a);
    await testDb.pool.query('DELETE FROM league_members WHERE account_id = $1', [a.accountId]);
    const res = await request(app).get('/favorites').set(auth(a));
    expect(res.body.favorites).toEqual([]);
  });

  it('serves a preview to a member once guessing is open; 403 before and for outsiders; 404 unknown', async () => {
    const { app, roundId, a, track } = await setup();
    const preview = (m: { token: string }, id = track.submissionId) =>
      request(app).get(`/submissions/${id}/preview`).set(auth(m));
    await testDb.pool.query("UPDATE rounds SET submission_deadline = now() + interval '1 day' WHERE id = $1", [roundId]);
    expect((await preview(a)).status).toBe(403);
    await closeGuessingWindow(testDb.pool, roundId);
    await testDb.pool.query("UPDATE rounds SET submission_deadline = now() - interval '1 day' WHERE id = $1", [roundId]);
    const ok = await preview(a);
    expect(ok.body).toEqual({ url: expect.stringMatching(/^https:\/\/fake\.test\/preview\//) });
    const outsider = await signUp(app, `outsider-${Date.now()}@example.com`);
    expect((await preview(outsider)).status).toBe(403);
    expect((await preview(a, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });
});

describe('POST /favorites/export (#109)', () => {
  const exportFavorites = (app: Parameters<typeof request>[0], m: { token: string }) =>
    request(app).post('/favorites/export').set(auth(m));

  it('creates the playlist on the first call and appends only new favorites after', async () => {
    const { app, youtubeMusicAdapter, roundId, a, submissions, favorite } = await setup();
    await closeGuessingWindow(testDb.pool, roundId);
    await favorite(a, submissions[0].submissionId);
    const first = (await exportFavorites(app, a)).body.services[0];
    const titles = () => [...youtubeMusicAdapter.playlists.values()].map((p) => p.map((t) => t.title));
    expect(titles()).toHaveLength(1);
    const firstTitles = titles()[0];
    expect(firstTitles).toHaveLength(1);
    expect(first).toMatchObject({ service: 'youtube_music', status: 'ok', matchedCount: 1, skipped: [] });
    expect(first.playlistUrl).toMatch(/^https:\/\/music\.youtube\.com\/playlist\?list=/);

    await favorite(a, submissions[1].submissionId);
    const second = (await exportFavorites(app, a)).body.services[0];
    expect(second.playlistUrl).toBe(first.playlistUrl);
    expect(second.matchedCount).toBe(2);
    expect(titles()).toHaveLength(1);
    expect(titles()[0]).toHaveLength(2);
    expect(titles()[0][0]).toBe(firstTitles[0]);
    const rows = await testDb.pool.query('SELECT exported_submission_ids FROM favorite_exports');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].exported_submission_ids).toHaveLength(2);

    expect((await request(app).get('/favorites').set(auth(a))).body.playlistUrl).toBe(first.playlistUrl);
  });

  it('appends nothing when there is nothing new', async () => {
    const { app, youtubeMusicAdapter, roundId, a, submissions, favorite } = await setup();
    await closeGuessingWindow(testDb.pool, roundId);
    await favorite(a, submissions[0].submissionId);
    await exportFavorites(app, a);
    const again = (await exportFavorites(app, a)).body.services[0];
    expect(again).toMatchObject({ status: 'ok', matchedCount: 1 });
    expect([...youtubeMusicAdapter.playlists.values()].map((p) => p.length)).toEqual([1]);
  });

  it('skips bandcamp favorites, and reports no_matches without a playlist', async () => {
    const { app, youtubeMusicAdapter, roundId, a, submissions, favorite } = await setup();
    await closeGuessingWindow(testDb.pool, roundId);
    await testDb.pool.query("UPDATE submissions SET service = 'bandcamp' WHERE id = $1", [submissions[0].submissionId]);
    await favorite(a, submissions[0].submissionId);
    const res = (await exportFavorites(app, a)).body.services[0];
    expect(res).toMatchObject({ status: 'no_matches', playlistUrl: null, matchedCount: 0, skipped: [] });
    expect(youtubeMusicAdapter.playlists.size).toBe(0);
    expect((await request(app).get('/favorites').set(auth(a))).body.playlistUrl).toBeNull();

    await favorite(a, submissions[1].submissionId);
    const mixed = (await exportFavorites(app, a)).body.services[0];
    expect(mixed).toMatchObject({ status: 'ok', matchedCount: 1 });
    expect([...youtubeMusicAdapter.playlists.values()].map((p) => p.length)).toEqual([1]);
  });

  it('leaves the service out when no cookie is configured', async () => {
    const { app } = buildApp(testDb.pool, { youtubeMusicCookie: '' });
    const a = await signUp(app, `nocookie-${Date.now()}@example.com`);
    expect((await exportFavorites(app, a)).body).toEqual({ services: [] });
  });

  it('reports an adapter failure as failed rather than a 500', async () => {
    const { app, youtubeMusicAdapter } = buildApp(testDb.pool);
    const league = await createLeagueWithPlayers(app, 3);
    await closeSubmissionWindow(testDb.pool, league.roundId);
    await closeGuessingWindow(testDb.pool, league.roundId);
    const a = league.members[0];
    await request(app).post(`/submissions/${league.submissions[1].submissionId}/favorite`).set(auth(a));
    youtubeMusicAdapter.createPlaylist = async () => {
      throw new Error('boom');
    };
    const res = await exportFavorites(app, a);
    expect(res.status).toBe(200);
    expect(res.body.services[0]).toMatchObject({ status: 'failed', playlistUrl: null });
  });

  it('requires auth', async () => {
    const { app } = buildApp(testDb.pool);
    expect((await request(app).post('/favorites/export')).status).toBe(401);
  });
});
