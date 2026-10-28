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

async function setup() {
  const { app } = buildApp(testDb.pool);
  const league = await createLeagueWithPlayers(app, 3);
  await closeSubmissionWindow(testDb.pool, league.roundId);
  const [a, b] = league.members;
  const track = league.submissions[1];
  const auth = (m: { token: string }) => ({ Authorization: `Bearer ${m.token}` });
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
