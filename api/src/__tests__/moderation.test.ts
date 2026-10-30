import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startTestDb, type TestDb } from './testDb.js';
import { buildApp, closeGuessingWindow, closeSubmissionWindow, createLeagueWithPlayers, signUp } from './testHelpers.js';

let testDb: TestDb;
beforeAll(async () => {
  testDb = await startTestDb();
}, 60_000);
afterEach(() => testDb.reset());
afterAll(() => testDb.teardown());

// Players a, b, c; a comments on b's track, b replies, c reacts to the comment.
async function setup() {
  const { app, emailChannel, pushChannel } = buildApp(testDb.pool);
  const league = await createLeagueWithPlayers(app, 4);
  await closeSubmissionWindow(testDb.pool, league.roundId);
  const [a, b, c] = league.members;
  const auth = (m: { token: string }) => ({ Authorization: `Bearer ${m.token}` });
  const track = league.submissions.find((s) => s.accountId === b.accountId)!;
  await request(app)
    .post(`/rounds/${league.roundId}/submissions/${track.submissionId}/guesses`)
    .set(auth(a))
    .send({ guessedAccountId: b.accountId, comment: 'rude comment' });
  await closeGuessingWindow(testDb.pool, league.roundId);
  const results = async (m: { token: string }) =>
    (await request(app).get(`/rounds/${league.roundId}/results`).set(auth(m))).body.tracks.find(
      (t: { submissionId: string }) => t.submissionId === track.submissionId,
    );
  const guessId = (await results(c)).comments[0].guessId as string;
  const report = (m: { token: string }, body: object) => request(app).post('/reports').set(auth(m)).send(body);
  return { app, emailChannel, pushChannel, a, b, c, auth, results, guessId, report, leagueId: league.leagueId };
}

describe('reports and blocks (#144)', () => {
  it('stores a report on a comment and emails the owner', async () => {
    const { a, c, guessId, report, emailChannel } = await setup();
    const res = await report(c, { targetType: 'comment', targetId: guessId, reason: 'harassment', note: 'mean' });
    expect(res.status).toBe(201);
    const rows = (await testDb.pool.query('SELECT * FROM reports')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reporter_id: c.accountId, reported_account_id: a.accountId, target_type: 'comment', reason: 'harassment', note: 'mean' });
    await vi_waitFor(() => emailChannel.sent.length === 1);
    expect(emailChannel.sent[0]).toMatchObject({ email: 'owner@app.test' });
    expect(emailChannel.sent[0].payload.body).toContain('rude comment');
  });

  it('reports a reply, an avatar and a display name; rejects bad input, self-reports and outsiders', async () => {
    const { app, a, b, c, auth, guessId, report } = await setup();
    const reply = await request(app).post(`/guesses/${guessId}/replies`).set(auth(b)).send({ body: 'nasty reply' });
    expect((await report(c, { targetType: 'reply', targetId: reply.body.replyId, reason: 'spam' })).status).toBe(201);
    expect((await report(c, { targetType: 'avatar', targetId: a.accountId, reason: 'inappropriate' })).status).toBe(201);
    expect((await report(c, { targetType: 'display_name', targetId: a.accountId, reason: 'other' })).status).toBe(201);
    expect((await report(c, { targetType: 'comment', targetId: guessId, reason: 'nope' })).status).toBe(400);
    expect((await report(a, { targetType: 'comment', targetId: guessId, reason: 'spam' })).status).toBe(400);
    expect((await report(c, { targetType: 'avatar', targetId: c.accountId, reason: 'spam' })).status).toBe(400);
    const outsider = await signUp(app, 'outsider@example.com');
    expect((await report(outsider, { targetType: 'comment', targetId: guessId, reason: 'spam' })).status).toBe(403);
    expect((await report(outsider, { targetType: 'avatar', targetId: a.accountId, reason: 'spam' })).status).toBe(404);
    expect((await report(c, { targetType: 'comment', targetId: 'junk', reason: 'spam' })).status).toBe(404);
  });

  it('hides a blocked player’s comments, replies and reactions from the blocker only, and can unblock', async () => {
    const { app, a, b, c, auth, guessId, results } = await setup();
    const reply = await request(app).post(`/guesses/${guessId}/replies`).set(auth(a)).send({ body: 'hi' });
    await request(app).post(`/guesses/${guessId}/reactions`).set(auth(a)).send({ emoji: '👍' });
    expect((await results(c)).comments[0].replies).toHaveLength(1);

    expect((await request(app).put(`/blocks/${a.accountId}`).set(auth(c))).status).toBe(204);
    expect((await results(c)).comments).toEqual([]);
    expect((await results(b)).comments[0].replies).toHaveLength(1);
    expect((await request(app).get('/blocks').set(auth(c))).body.blocked.map((x: { accountId: string }) => x.accountId)).toEqual([a.accountId]);

    expect(reply.status).toBe(201);
    await request(app).delete(`/blocks/${a.accountId}`).set(auth(c));
    expect((await results(c)).comments[0].replies).toHaveLength(1);
  });

  it('only lets you block someone you share a league with, never yourself', async () => {
    const { app, a, c, auth } = await setup();
    const outsider = await signUp(app, 'outsider2@example.com');
    expect((await request(app).put(`/blocks/${outsider.accountId}`).set(auth(c))).status).toBe(404);
    expect((await request(app).put(`/blocks/${c.accountId}`).set(auth(c))).status).toBe(400);
    expect((await request(app).put(`/blocks/${a.accountId}`)).status).toBe(401);
  });

  it('does not notify someone about replies from a player they blocked', async () => {
    const { app, a, c, auth, guessId, pushChannel, emailChannel } = await setup();
    await request(app).put(`/blocks/${c.accountId}`).set(auth(a));
    await request(app).post(`/guesses/${guessId}/replies`).set(auth(c)).send({ body: 'hello' });
    await new Promise((r) => setTimeout(r, 100));
    expect(pushChannel.sent).toHaveLength(0);
    expect(emailChannel.sent.filter((e) => e.email !== 'owner@app.test')).toHaveLength(0);
  });
});

describe('follow-ups (#167)', () => {
  it('stores a repeated report once and emails once', async () => {
    const { c, guessId, report, emailChannel } = await setup();
    const body = { targetType: 'comment', targetId: guessId, reason: 'spam' };
    expect((await report(c, body)).status).toBe(201);
    expect((await report(c, body)).status).toBe(201);
    await vi_waitFor(() => emailChannel.sent.length === 1);
    await new Promise((r) => setTimeout(r, 100));
    expect((await testDb.pool.query('SELECT 1 FROM reports')).rowCount).toBe(1);
    expect(emailChannel.sent).toHaveLength(1);
  });

  it('caps how many reports one account files per hour', async () => {
    const { a, c, guessId, report } = await setup();
    await testDb.pool.query(
      `INSERT INTO reports (reporter_id, reported_account_id, target_type, target_id, reason)
       SELECT $1, $2, 'comment', gen_random_uuid(), 'spam' FROM generate_series(1, 20)`,
      [c.accountId, a.accountId],
    );
    expect((await report(c, { targetType: 'comment', targetId: guessId, reason: 'spam' })).status).toBe(429);
  });

  it('keeps a report after its reporter deletes their account', async () => {
    const { c, guessId, report } = await setup();
    await report(c, { targetType: 'comment', targetId: guessId, reason: 'spam' });
    await testDb.pool.query('DELETE FROM accounts WHERE id = $1', [c.accountId]);
    expect((await testDb.pool.query('SELECT reporter_id FROM reports')).rows).toEqual([{ reporter_id: null }]);
  });

  it('hides replies nested under a blocked player’s reply, and masks their name', async () => {
    const { app, a, b, c, auth, guessId, results } = await setup();
    const top = await request(app).post(`/guesses/${guessId}/replies`).set(auth(b)).send({ body: 'top' });
    await request(app).post(`/guesses/${guessId}/replies`).set(auth(a)).send({ body: 'nested', parentReplyId: top.body.replyId });
    expect((await results(c)).comments[0].replies).toHaveLength(2);
    await request(app).put(`/blocks/${b.accountId}`).set(auth(c));
    expect((await results(c)).comments[0].replies).toEqual([]);
    const { submitter } = await results(c); // b's own track
    expect(submitter).toEqual({ accountId: b.accountId, displayName: 'Blocked player' });
  });

  it('masks a blocked player in the league overview roster and standings', async () => {
    const { app, b, c, auth, leagueId } = await setup();
    await request(app).put(`/blocks/${b.accountId}`).set(auth(c));
    const overview = (await request(app).get(`/leagues/${leagueId}/overview`).set(auth(c))).body;
    const masked = { accountId: b.accountId, displayName: 'Blocked player' };
    expect(overview.members.find((m: { accountId: string }) => m.accountId === b.accountId)).toMatchObject(masked);
    expect(overview.standings.find((m: { accountId: string }) => m.accountId === b.accountId)).toMatchObject(masked);
    expect(overview.members.find((m: { accountId: string }) => m.accountId === b.accountId).avatarUrl).toBeUndefined();
  });
});

async function vi_waitFor(cond: () => boolean) {
  for (let i = 0; i < 50 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
}
