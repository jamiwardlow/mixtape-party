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
  const { app } = buildApp(testDb.pool);
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
  return { app, ...league, a, b, track, favorite, favoritedFor };
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

  it('rejects before results open, non-members, and unknown submissions', async () => {
    const { app, roundId, a, favorite } = await setup();
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

  it('serves a preview to a member once results are open; 403 before and for outsiders; 404 unknown', async () => {
    const { app, roundId, a, track } = await setup();
    const preview = (m: { token: string }, id = track.submissionId) =>
      request(app).get(`/submissions/${id}/preview`).set(auth(m));
    expect((await preview(a)).status).toBe(403);
    await closeGuessingWindow(testDb.pool, roundId);
    const ok = await preview(a);
    expect(ok.body).toEqual({ url: expect.stringMatching(/^https:\/\/fake\.test\/preview\//) });
    const outsider = await signUp(app, `outsider-${Date.now()}@example.com`);
    expect((await preview(outsider)).status).toBe(403);
    expect((await preview(a, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });
});
