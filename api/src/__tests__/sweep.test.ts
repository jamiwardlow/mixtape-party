import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from './testDb.js';
import { FakeEmailChannel, FakePushChannel } from '../notifications/fakeChannels.js';
import { runNotificationSweep } from '../notifications/sweep.js';

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

async function createAccount(email: string): Promise<string> {
  const res = await testDb.pool.query<{ id: string }>(
    "INSERT INTO accounts (email, password_hash) VALUES ($1, 'hash') RETURNING id",
    [email],
  );
  return res.rows[0].id;
}

async function createLeague(hostId: string, seasonLength = 8): Promise<string> {
  const res = await testDb.pool.query<{ id: string }>(
    `INSERT INTO leagues (name, season_length, host_account_id, invite_code) VALUES ('L', $1, $2, $3) RETURNING id`,
    [seasonLength, hostId, `code-${Math.random()}`],
  );
  return res.rows[0].id;
}

async function addMember(leagueId: string, accountId: string) {
  await testDb.pool.query('INSERT INTO league_members (league_id, account_id) VALUES ($1, $2)', [leagueId, accountId]);
}

async function createRound(
  leagueId: string,
  roundNumber: number,
  createdAt: Date,
  submissionDeadline: Date,
  guessingDeadline: Date,
): Promise<string> {
  const res = await testDb.pool.query<{ id: string }>(
    `INSERT INTO rounds (league_id, round_number, theme, submission_deadline, guessing_deadline, created_at)
     VALUES ($1, $2, 'Theme', $3, $4, $5) RETURNING id`,
    [leagueId, roundNumber, submissionDeadline.toISOString(), guessingDeadline.toISOString(), createdAt.toISOString()],
  );
  return res.rows[0].id;
}

async function submit(roundId: string, accountId: string) {
  await testDb.pool.query(
    `INSERT INTO submissions (round_id, account_id, service, external_id, title, artist)
     VALUES ($1, $2, 'spotify', 'x', 'Song', 'Artist')`,
    [roundId, accountId],
  );
}

function buildDeps() {
  return { pool: testDb.pool, pushChannel: new FakePushChannel(), emailChannel: new FakeEmailChannel() };
}

describe('runNotificationSweep', () => {
  it('reminds only members who have not submitted, once, via email by default', async () => {
    const host = await createAccount(`host-${Math.random()}@example.com`);
    const laggard = await createAccount(`laggard-${Math.random()}@example.com`);
    const leagueId = await createLeague(host);
    await addMember(leagueId, host);
    await addMember(leagueId, laggard);
    const roundId = await createRound(
      leagueId,
      1,
      new Date('2030-01-01T00:00:00Z'),
      new Date('2030-01-06T00:00:00Z'), // 5-day window, 20% remaining = Jan 5
      new Date('2030-01-13T00:00:00Z'),
    );
    await submit(roundId, host);

    const deps = buildDeps();
    await runNotificationSweep(deps, new Date('2030-01-05T00:00:00Z'));

    const notifs = await testDb.pool.query('SELECT account_id, type FROM notifications');
    expect(notifs.rows).toEqual([{ account_id: laggard, type: 'submission_reminder' }]);
    expect(deps.emailChannel.sent).toHaveLength(1);
    expect(deps.pushChannel.sent).toHaveLength(0); // no push token registered for laggard

    await runNotificationSweep(deps, new Date('2030-01-05T00:00:00Z'));
    const again = await testDb.pool.query('SELECT * FROM notifications');
    expect(again.rows).toHaveLength(1); // idempotent
  });

  it('does not remind before the threshold, and skips email when disabled', async () => {
    const host = await createAccount(`host-${Math.random()}@example.com`);
    const leagueId = await createLeague(host);
    await addMember(leagueId, host);
    await testDb.pool.query(
      'INSERT INTO notification_settings (account_id, push_enabled, email_enabled) VALUES ($1, true, false)',
      [host],
    );
    await createRound(
      leagueId,
      1,
      new Date('2030-01-01T00:00:00Z'),
      new Date('2030-01-06T00:00:00Z'),
      new Date('2030-01-13T00:00:00Z'),
    );

    const deps = buildDeps();
    await runNotificationSweep(deps, new Date('2030-01-04T00:00:00Z')); // before threshold
    expect((await testDb.pool.query('SELECT * FROM notifications')).rows).toHaveLength(0);

    await runNotificationSweep(deps, new Date('2030-01-05T00:00:00Z')); // at threshold
    const notifs = await testDb.pool.query('SELECT account_id FROM notifications');
    expect(notifs.rows).toEqual([{ account_id: host }]);
    expect(deps.emailChannel.sent).toHaveLength(0); // disabled
  });

  it('reminds members who have not finished guessing every other submission', async () => {
    const host = await createAccount(`host-${Math.random()}@example.com`);
    const laggard = await createAccount(`laggard-${Math.random()}@example.com`);
    const leagueId = await createLeague(host);
    await addMember(leagueId, host);
    await addMember(leagueId, laggard);
    const roundId = await createRound(
      leagueId,
      1,
      new Date('2030-01-01T00:00:00Z'),
      new Date('2030-01-06T00:00:00Z'),
      new Date('2030-01-11T00:00:00Z'), // 5-day window from submission deadline, 20% remaining = Jan 10
    );
    const hostSub = await testDb.pool.query<{ id: string }>(
      `INSERT INTO submissions (round_id, account_id, service, external_id, title, artist)
       VALUES ($1, $2, 'spotify', 'x', 'Song', 'Artist') RETURNING id`,
      [roundId, host],
    );
    await testDb.pool.query(
      'INSERT INTO guesses (submission_id, guesser_account_id, guessed_account_id) VALUES ($1, $2, $3)',
      [hostSub.rows[0].id, host, laggard],
    );

    const deps = buildDeps();
    await runNotificationSweep(deps, new Date('2030-01-10T00:00:00Z'));

    const notifs = await testDb.pool.query('SELECT account_id, type FROM notifications');
    expect(notifs.rows).toEqual([{ account_id: laggard, type: 'guessing_reminder' }]);
  });

  it('notifies every league member once results are ready, after the guessing deadline passes', async () => {
    const host = await createAccount(`host-${Math.random()}@example.com`);
    const other = await createAccount(`other-${Math.random()}@example.com`);
    const leagueId = await createLeague(host);
    await addMember(leagueId, host);
    await addMember(leagueId, other);
    await createRound(
      leagueId,
      1,
      new Date('2030-01-01T00:00:00Z'),
      new Date('2000-01-01T00:00:00Z'),
      new Date('2000-01-02T00:00:00Z'),
    );

    const deps = buildDeps();
    await runNotificationSweep(deps);

    const notifs = await testDb.pool.query<{ account_id: string; type: string }>(
      "SELECT account_id, type FROM notifications WHERE type = 'results_ready' ORDER BY account_id",
    );
    expect(notifs.rows.map((r) => r.account_id).sort()).toEqual([host, other].sort());

    await runNotificationSweep(deps); // idempotent
    const again = await testDb.pool.query("SELECT * FROM notifications WHERE type = 'results_ready'");
    expect(again.rows).toHaveLength(2);
  });

  it('notifies members once a season-final round concludes', async () => {
    const host = await createAccount(`host-${Math.random()}@example.com`);
    const leagueId = await createLeague(host, 1);
    await addMember(leagueId, host);
    await createRound(
      leagueId,
      1,
      new Date('2030-01-01T00:00:00Z'),
      new Date('2000-01-01T00:00:00Z'),
      new Date('2000-01-02T00:00:00Z'),
    );

    const deps = buildDeps();
    await runNotificationSweep(deps);

    const notifs = await testDb.pool.query("SELECT account_id, type FROM notifications WHERE type = 'season_concluded'");
    expect(notifs.rows).toEqual([{ account_id: host, type: 'season_concluded' }]);

    await runNotificationSweep(deps); // idempotent
    const again = await testDb.pool.query("SELECT * FROM notifications WHERE type = 'season_concluded'");
    expect(again.rows).toHaveLength(1);
  });

  it('sends push to every registered device, split from the email channel', async () => {
    const host = await createAccount(`host-${Math.random()}@example.com`);
    const leagueId = await createLeague(host);
    await addMember(leagueId, host);
    await testDb.pool.query("INSERT INTO push_tokens (account_id, platform, token) VALUES ($1, 'expo', 'tok-1')", [
      host,
    ]);
    await createRound(
      leagueId,
      1,
      new Date('2030-01-01T00:00:00Z'),
      new Date('2000-01-01T00:00:00Z'),
      new Date('2000-01-02T00:00:00Z'),
    );

    const deps = buildDeps();
    await runNotificationSweep(deps);

    expect(deps.pushChannel.sent).toHaveLength(1);
    expect(deps.pushChannel.sent[0].tokens).toEqual([{ platform: 'expo', token: 'tok-1' }]);
    expect(deps.emailChannel.sent).toHaveLength(1);
  });
});
