import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from './testDb.js';
import { buildApp, closeGuessingWindow, closeSubmissionWindow, createLeagueWithPlayers } from './testHelpers.js';
import { gateError, rosterFor, targetGateError } from '../visibility.js';

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

describe('rosterFor', () => {
  // Every roster screen (season, round, guessing, results, standings) reads rosterFor, so this one
  // test is the block-masking test for all of them.
  it('masks players the viewer blocked, and only for that viewer', async () => {
    const { app } = buildApp(testDb.pool);
    const { leagueId, members } = await createLeagueWithPlayers(app, 3);
    const [viewer, blocked, other] = members;
    await testDb.pool.query("UPDATE accounts SET display_name = 'Real Name', avatar_updated_at = now() WHERE id = $1", [blocked.accountId]);
    await testDb.pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [viewer.accountId, blocked.accountId]);

    const seenByViewer = await rosterFor(testDb.pool, leagueId, viewer.accountId);
    expect(seenByViewer.map((p) => p.accountId)).toEqual(members.map((m) => m.accountId));
    expect(seenByViewer[1]).toMatchObject({ displayName: 'Blocked player', avatarUrl: undefined });

    const seenByOther = await rosterFor(testDb.pool, leagueId, other.accountId);
    expect(seenByOther[1]).toMatchObject({ displayName: 'Real Name', avatarUrl: expect.stringContaining(blocked.accountId) });
  });
});

describe('gates', () => {
  it('opens a round to members only, guessing at the submission deadline and results at the guessing deadline', async () => {
    const { app } = buildApp(testDb.pool);
    const { roundId, members, submissions } = await createLeagueWithPlayers(app, 2);
    const outsider = (await createLeagueWithPlayers(app, 1)).members[0];
    const member = members[1].accountId;
    const round = async () =>
      (await testDb.pool.query('SELECT league_id AS "leagueId", submission_deadline AS "submissionDeadline", guessing_deadline AS "guessingDeadline" FROM rounds WHERE id = $1', [roundId])).rows[0];

    expect(await gateError(testDb.pool, outsider.accountId, await round(), 'guessing')).toMatchObject({ status: 403 });
    expect(await gateError(testDb.pool, member, await round(), 'guessing')).toMatchObject({ status: 403 });
    expect(await targetGateError(testDb.pool, member, 'submission', submissions[0].submissionId)).toMatchObject({ status: 403 });

    await closeSubmissionWindow(testDb.pool, roundId);
    expect(await gateError(testDb.pool, member, await round(), 'guessing')).toBeNull();
    expect(await targetGateError(testDb.pool, member, 'submission', submissions[0].submissionId)).toBeNull();
    expect(await gateError(testDb.pool, member, await round(), 'results')).toMatchObject({ status: 403 });

    await closeGuessingWindow(testDb.pool, roundId);
    expect(await gateError(testDb.pool, member, await round(), 'results')).toBeNull();
    expect(await targetGateError(testDb.pool, outsider.accountId, 'submission', submissions[0].submissionId)).toMatchObject({ status: 403 });
    expect(await targetGateError(testDb.pool, member, 'comment', submissions[0].submissionId)).toMatchObject({ status: 404 });
  });
});
