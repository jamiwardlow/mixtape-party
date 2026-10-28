import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startTestDb, type TestDb } from './testDb.js';
import { buildApp, closeGuessingWindow, closeSubmissionWindow, createLeagueWithPlayers, guess, signUp } from './testHelpers.js';

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

const besties = (app: ReturnType<typeof buildApp>['app'], token: string) =>
  request(app).get('/accounts/me/besties').set('Authorization', `Bearer ${token}`);

const name = (accountId: string, displayName: string) =>
  testDb.pool.query('UPDATE accounts SET display_name = $2 WHERE id = $1', [accountId, displayName]);

/** Everyone guesses every other player's track; `wrong` lists guessers (by index) who guess wrong on member 0's track. */
async function guessAll(app: ReturnType<typeof buildApp>['app'], league: Awaited<ReturnType<typeof createLeagueWithPlayers>>, wrong: number[] = []) {
  const { roundId, members, submissions } = league;
  await closeSubmissionWindow(testDb.pool, roundId);
  for (let g = 0; g < members.length; g++) {
    for (let s = 0; s < members.length; s++) {
      if (g === s) continue;
      const target = g !== 0 && s === 0 && wrong.includes(g) ? members[g === 1 ? 2 : 1].accountId : submissions[s].accountId;
      await guess(app, roundId, submissions[s].submissionId, members[g].token, target);
    }
  }
}

describe('GET /accounts/me/besties', () => {
  it('requires a session', async () => {
    const { app } = buildApp(testDb.pool);
    expect((await request(app).get('/accounts/me/besties')).status).toBe(401);
  });

  it('is empty for a new account', async () => {
    const { app } = buildApp(testDb.pool);
    const me = await signUp(app, 'new@example.com');
    const res = await besties(app, me.token);
    expect(res.body).toEqual({ guessedMe: [], iGuessed: [] });
  });

  it('counts only correct guesses, and only once the guessing deadline has passed', async () => {
    const { app } = buildApp(testDb.pool);
    const league = await createLeagueWithPlayers(app, 3);
    await guessAll(app, league, [1]); // member 1 guesses wrong on my (member 0's) track
    const me = league.members[0];

    expect((await besties(app, me.token)).body).toEqual({ guessedMe: [], iGuessed: [] });

    await closeGuessingWindow(testDb.pool, league.roundId);
    const res = await besties(app, me.token);
    expect(res.body.guessedMe).toEqual([{ accountId: league.members[2].accountId, displayName: null, count: 1 }]);
    expect(res.body.iGuessed.map((b: { accountId: string }) => b.accountId).sort()).toEqual(
      [league.members[1].accountId, league.members[2].accountId].sort(),
    );
  });

  it('sums across leagues', async () => {
    const { app } = buildApp(testDb.pool);
    const a = await createLeagueWithPlayers(app, 2);
    await guessAll(app, a);
    const me = a.members[0];
    // second league with the same two accounts
    const b = await request(app).post('/leagues').set('Authorization', `Bearer ${me.token}`)
      .send({ name: 'Second', seasonLength: 8, theme: 't', submissionDeadline: '2030-01-10T00:00:00.000Z', guessingDeadline: '2030-01-17T00:00:00.000Z' });
    await request(app).post(`/leagues/invite/${b.body.inviteCode}/join`).set('Authorization', `Bearer ${a.members[1].token}`);
    const subs: string[] = [];
    for (const m of a.members) {
      const r = await request(app).post(`/rounds/${b.body.round.id}/submissions`).set('Authorization', `Bearer ${m.token}`)
        .send({ externalId: `x-${m.accountId}`, title: 't', artist: 'a', service: 'youtube_music' });
      subs.push(r.body.submissionId);
    }
    await closeSubmissionWindow(testDb.pool, b.body.round.id);
    await guess(app, b.body.round.id, subs[0], a.members[1].token, me.accountId);
    await closeGuessingWindow(testDb.pool, a.roundId);
    await closeGuessingWindow(testDb.pool, b.body.round.id);

    const res = await besties(app, me.token);
    expect(res.body.guessedMe).toEqual([{ accountId: a.members[1].accountId, displayName: null, count: 2 }]);
    expect(res.body.iGuessed).toEqual([{ accountId: a.members[1].accountId, displayName: null, count: 1 }]);
  });

  it('caps at 3 and orders ties by display name', async () => {
    const { app } = buildApp(testDb.pool);
    const league = await createLeagueWithPlayers(app, 5);
    await guessAll(app, league);
    await closeGuessingWindow(testDb.pool, league.roundId);
    const names = ['Eve', 'Dan', 'Cat', 'Bob', 'Amy'];
    await Promise.all(league.members.map((m, i) => name(m.accountId, names[i])));

    const res = await besties(app, league.members[0].token);
    expect(res.body.guessedMe.map((b: { displayName: string }) => b.displayName)).toEqual(['Amy', 'Bob', 'Cat']);
    expect(res.body.iGuessed).toHaveLength(3);
  });
});
