import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startTestDb, type TestDb } from './testDb.js';
import {
  buildApp,
  closeGuessingWindow,
  closeSubmissionWindow,
  createLeagueWithPlayers,

  signUp,
} from './testHelpers.js';

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
  const { app } = buildTestApp();
  const league = await createLeagueWithPlayers(app, 4);
  await closeSubmissionWindow(testDb.pool, league.roundId);
  const [a, b, c] = league.members;
  const track = league.submissions.find((s) => s.accountId === b.accountId)!;
  const auth = (m: { token: string }) => ({ Authorization: `Bearer ${m.token}` });
  const results = async (m: { token: string }) =>
    (await request(app).get(`/rounds/${league.roundId}/results`).set(auth(m))).body.tracks.find(
      (t: { submissionId: string }) => t.submissionId === track.submissionId,
    );
  const putComment = (m: { token: string }, comment: unknown) =>
    request(app)
      .put(`/rounds/${league.roundId}/submissions/${track.submissionId}/guesses/comment`)
      .set(auth(m))
      .send({ comment });
  return { app, ...league, a, b, c, track, auth, results, putComment };
}

function buildTestApp() {
  return buildApp(testDb.pool);
}

describe('guess comments, replies and reactions (#101)', () => {
  it('saves a comment with the guess, editable any time, and shows it to everyone attributed once results open', async () => {
    const { app, roundId, a, b, c, track, auth, results, putComment } = await setup();
    const res = await request(app)
      .post(`/rounds/${roundId}/submissions/${track.submissionId}/guesses`)
      .set(auth(a))
      .send({ guessedAccountId: b.accountId, comment: 'sounds like you' });
    expect(res.status).toBe(201);

    expect((await request(app).get(`/rounds/${roundId}/guessing`).set(auth(a))).body.tracks[0].comment).toBeDefined();
    await closeGuessingWindow(testDb.pool, roundId);
    expect((await results(c)).comments[0]).toMatchObject({ comment: 'sounds like you', guesser: { accountId: a.accountId } });

    expect((await putComment(a, 'edited after results')).status).toBe(200);
    expect((await results(c)).comments[0].comment).toBe('edited after results');
    expect((await results(a)).yourGuess.comment).toBe('edited after results');
    await putComment(a, '  ');
    expect((await results(c)).comments).toEqual([]);
  });

  it('rejects over-long comments and editing a guess you never made', async () => {
    const { app, roundId, a, c, track, auth, putComment } = await setup();
    expect((await putComment(c, 'hi')).status).toBe(404);
    const long = await request(app)
      .post(`/rounds/${roundId}/submissions/${track.submissionId}/guesses`)
      .set(auth(a))
      .send({ guessedAccountId: c.accountId, comment: 'x'.repeat(501) });
    expect(long.status).toBe(400);
  });

  it('lets members reply and react once results are open, not before, and toggles reactions', async () => {
    const { app, roundId, a, b, c, track, auth, results } = await setup();
    const g = await request(app)
      .post(`/rounds/${roundId}/submissions/${track.submissionId}/guesses`)
      .set(auth(a))
      .send({ guessedAccountId: b.accountId, comment: 'hm' });
    const guessId = g.body.guessId;

    const early = await request(app).post(`/guesses/${guessId}/replies`).set(auth(b)).send({ body: 'nope' });
    expect(early.status).toBe(403);
    await closeGuessingWindow(testDb.pool, roundId);

    const outsider = await signUp(app, 'outsider@example.com');
    expect((await request(app).post(`/guesses/${guessId}/replies`).set(auth(outsider)).send({ body: 'hi' })).status).toBe(403);
    expect((await request(app).post(`/guesses/${guessId}/replies`).set(auth(b)).send({ body: ' ' })).status).toBe(400);

    const reply = await request(app).post(`/guesses/${guessId}/replies`).set(auth(b)).send({ body: 'it was me' });
    expect(reply.status).toBe(201);

    const react = (path: string, who: { token: string }, emoji: string) =>
      request(app).post(path).set(auth(who)).send({ emoji });
    expect((await react(`/guesses/${guessId}/reactions`, c, '🔥')).body.reacted).toBe(true);
    expect((await react(`/replies/${reply.body.replyId}/reactions`, c, '😂')).status).toBe(200);
    expect((await react(`/guesses/${guessId}/reactions`, c, 'nope')).status).toBe(400);

    let thread = (await results(c)).comments[0];
    expect(thread.reactions).toEqual([{ emoji: '🔥', count: 1, mine: true }]);
    expect(thread.replies[0]).toMatchObject({ body: 'it was me', author: { accountId: b.accountId } });
    expect(thread.replies[0].reactions).toEqual([{ emoji: '😂', count: 1, mine: true }]);
    expect((await results(a)).comments[0].reactions[0].mine).toBe(false);

    expect((await react(`/guesses/${guessId}/reactions`, c, '🔥')).body.reacted).toBe(false);
    thread = (await results(c)).comments[0];
    expect(thread.reactions).toEqual([]);
  });
});
