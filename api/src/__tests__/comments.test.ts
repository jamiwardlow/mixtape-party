import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
  const { app, pushChannel, emailChannel } = buildTestApp();
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
  return { app, pushChannel, emailChannel, ...league, a, b, c, track, auth, results, putComment };
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
    expect((await react(`/guesses/${guessId}/reactions`, c, '👍🏽')).status).toBe(200);
    expect((await react(`/guesses/${guessId}/reactions`, c, '🔥🔥')).status).toBe(400);
    await react(`/guesses/${guessId}/reactions`, c, '👍🏽');

    let thread = (await results(c)).comments[0];
    expect(thread.reactions).toEqual([{ emoji: '🔥', count: 1, mine: true }]);
    expect(thread.replies[0]).toMatchObject({ body: 'it was me', author: { accountId: b.accountId } });
    expect(thread.replies[0].reactions).toEqual([{ emoji: '😂', count: 1, mine: true }]);
    expect((await results(a)).comments[0].reactions[0].mine).toBe(false);

    expect((await react(`/guesses/${guessId}/reactions`, c, '🔥')).body.reacted).toBe(false);
    thread = (await results(c)).comments[0];
    expect(thread.reactions).toEqual([]);
  });

  it('threads replies to replies, lets authors edit and delete them, and notifies whoever was replied to', async () => {
    const { app, roundId, a, b, c, track, auth, results } = await setup();
    const g = await request(app)
      .post(`/rounds/${roundId}/submissions/${track.submissionId}/guesses`)
      .set(auth(a))
      .send({ guessedAccountId: b.accountId, comment: 'hm' });
    const guessId = g.body.guessId;
    await closeGuessingWindow(testDb.pool, roundId);
    const post = (who: { token: string }, body: string, parentReplyId?: string) =>
      request(app).post(`/guesses/${guessId}/replies`).set(auth(who)).send({ body, parentReplyId });

    const first = await post(b, 'it was me');
    const nested = await post(c, 'ha', first.body.replyId);
    expect((await post(c, 'x', '00000000-0000-0000-0000-000000000000')).status).toBe(400);
    await post(a, 'talking to myself'); // a replying to their own comment: no notification

    const inbox = async (who: { accountId: string }) =>
      (await testDb.pool.query('SELECT type, title, body FROM notifications WHERE account_id = $1 AND type = $2', [who.accountId, 'comment_reply'])).rows;
    expect(await inbox(a)).toHaveLength(1);
    expect(await inbox(a)).toEqual([expect.objectContaining({ body: 'it was me' })]);
    expect(await inbox(b)).toEqual([expect.objectContaining({ body: 'ha' })]);
    expect(await inbox(c)).toHaveLength(0);

    const replies = (await results(a)).comments[0].replies;
    expect(replies.find((r: { replyId: string }) => r.replyId === nested.body.replyId).parentReplyId).toBe(first.body.replyId);

    const edit = (who: { token: string }, id: string) =>
      request(app).put(`/replies/${id}`).set(auth(who)).send({ body: 'edited' });
    expect((await edit(a, first.body.replyId)).status).toBe(404);
    expect((await edit(b, first.body.replyId)).status).toBe(200);
    expect((await results(a)).comments[0].replies[0]).toMatchObject({ body: 'edited', mine: false });

    expect((await request(app).delete(`/replies/${first.body.replyId}`).set(auth(c))).status).toBe(404);
    expect((await request(app).delete(`/replies/${first.body.replyId}`).set(auth(b))).status).toBe(204);
    // The reply under it goes with it.
    expect((await results(a)).comments[0].replies.map((r: { body: string }) => r.body)).toEqual(['talking to myself']);
  });

  it('lets members react to the submitted track once results open', async () => {
    const { app, roundId, c, track, auth, results } = await setup();
    const path = `/submissions/${track.submissionId}/reactions`;
    expect((await request(app).post(path).set(auth(c)).send({ emoji: '🎸' })).status).toBe(403);
    await closeGuessingWindow(testDb.pool, roundId);
    expect((await request(app).post(path).set(auth(c)).send({ emoji: '🎸' })).body.reacted).toBe(true);
    expect((await results(c)).reactions).toEqual([{ emoji: '🎸', count: 1, mine: true }]);
  });

  it('pushes (never emails) whoever was reacted to, skips self-reactions and removals, and links emailed replies to the reply', async () => {
    const { app, roundId, a, b, c, track, auth, pushChannel, emailChannel } = await setup();
    const guessId = (
      await request(app)
        .post(`/rounds/${roundId}/submissions/${track.submissionId}/guesses`)
        .set(auth(a))
        .send({ guessedAccountId: b.accountId, comment: 'hm' })
    ).body.guessId;
    await closeGuessingWindow(testDb.pool, roundId);
    await testDb.pool.query("INSERT INTO push_tokens (account_id, platform, token) VALUES ($1, 'expo', 'tok-a')", [a.accountId]);
    const react = (path: string, who: { token: string }, emoji = '🔥') =>
      request(app).post(path).set(auth(who)).send({ emoji });
    const inbox = async (who: { accountId: string }, type: string) =>
      (await testDb.pool.query('SELECT title, body FROM notifications WHERE account_id = $1 AND type = $2', [who.accountId, type])).rows;

    await react(`/guesses/${guessId}/reactions`, c);
    await vi.waitFor(async () => expect(await inbox(a, 'comment_reaction')).toEqual([{ title: expect.stringContaining('🔥'), body: 'hm' }]));
    await vi.waitFor(() => expect(pushChannel.sent).toHaveLength(1));
    expect(pushChannel.sent[0].payload.data).toEqual({ roundId, screen: 'results', focus: guessId });
    expect(emailChannel.sent).toHaveLength(0);

    await react(`/guesses/${guessId}/reactions`, c); // taking it back tells nobody
    await react(`/guesses/${guessId}/reactions`, a, '👏'); // your own comment: nobody to tell
    await react(`/submissions/${track.submissionId}/reactions`, c, '🎸');
    await vi.waitFor(async () => expect(await inbox(b, 'comment_reaction')).toHaveLength(1));
    expect(await inbox(a, 'comment_reaction')).toHaveLength(1);
    expect(emailChannel.sent).toHaveLength(0);

    const reply = await request(app).post(`/guesses/${guessId}/replies`).set(auth(b)).send({ body: 'it was me' });
    await vi.waitFor(() => expect(emailChannel.sent).toHaveLength(1));
    expect(emailChannel.sent[0].payload.link).toBe(`https://app.test/round/${roundId}/results?focus=${reply.body.replyId}`);
  });
});
