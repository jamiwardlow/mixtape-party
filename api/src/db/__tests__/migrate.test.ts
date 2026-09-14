import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEmbeddedPg, type EmbeddedPg } from '../../__tests__/embeddedPg.js';
import { migrate } from '../migrate.js';

const fixturesDir = path.dirname(fileURLToPath(import.meta.url));
const legacySchema = readFileSync(path.join(fixturesDir, 'fixtures', 'preSpotifyRemovalSchema.sql'), 'utf8');

async function startLegacyDb(): Promise<EmbeddedPg> {
  const db = await startEmbeddedPg('mixtape_party_legacy');
  await db.pool.query(legacySchema);
  return db;
}

describe('migrate', () => {
  describe('against a legacy pre-#51 database', () => {
    let db: EmbeddedPg;
    let accountId: string;
    let roundId: string;

    beforeAll(async () => {
      db = await startLegacyDb();

      const { rows } = await db.pool.query<{ id: string }>(
        "INSERT INTO accounts (email, password_hash) VALUES ('legacy@example.com', 'hash') RETURNING id",
      );
      accountId = rows[0].id;

      await db.pool.query(
        "INSERT INTO service_links (account_id, service, service_user_id, access_token) VALUES ($1, 'spotify', 'legacy-user', 'legacy-token')",
        [accountId],
      );

      const { rows: leagueRows } = await db.pool.query<{ id: string }>(
        "INSERT INTO leagues (name, season_length, host_account_id, invite_code) VALUES ('Legacy League', 4, $1, 'LEGACY1') RETURNING id",
        [accountId],
      );
      const { rows: roundRows } = await db.pool.query<{ id: string }>(
        "INSERT INTO rounds (league_id, round_number, theme, submission_deadline, guessing_deadline) VALUES ($1, 1, 'legacy theme', now() + interval '1 day', now() + interval '2 days') RETURNING id",
        [leagueRows[0].id],
      );
      roundId = roundRows[0].id;

      await db.pool.query(
        "INSERT INTO submissions (round_id, account_id, service, external_id, title, artist) VALUES ($1, $2, 'spotify', 'legacy-track', 'Legacy Title', 'Legacy Artist')",
        [roundId, accountId],
      );

      await db.pool.query(
        "INSERT INTO track_matches (match_key, service, external_id) VALUES ('legacy-match-key', 'spotify', 'legacy-track')",
      );

      await db.pool.query(
        "INSERT INTO round_exports (round_id, account_id, service) VALUES ($1, $2, 'spotify')",
        [roundId, accountId],
      );

      await migrate(db.pool);
    }, 60_000);

    afterAll(async () => {
      await db.teardown();
    });

    it.each(['service_links', 'submissions', 'track_matches', 'round_exports'])(
      'deletes legacy spotify rows from %s',
      async (table) => {
        const { rows } = await db.pool.query(`SELECT * FROM ${table} WHERE service = 'spotify'`);
        expect(rows).toHaveLength(0);
      },
    );

    it('rejects a new spotify service_links row', async () => {
      await expect(
        db.pool.query(
          "INSERT INTO service_links (account_id, service, service_user_id, access_token) VALUES ($1, 'spotify', 'new-user', 'new-token')",
          [accountId],
        ),
      ).rejects.toThrow(/violates check constraint/);
    });

    it('rejects a new spotify submissions row', async () => {
      await expect(
        db.pool.query(
          "INSERT INTO submissions (round_id, account_id, service, external_id, title, artist) VALUES ($1, $2, 'spotify', 'new-track', 'New Title', 'New Artist')",
          [roundId, accountId],
        ),
      ).rejects.toThrow(/violates check constraint/);
    });

    it('rejects a new spotify track_matches row', async () => {
      await expect(
        db.pool.query("INSERT INTO track_matches (match_key, service) VALUES ('new-match-key', 'spotify')"),
      ).rejects.toThrow(/violates check constraint/);
    });

    it('rejects a new spotify round_exports row', async () => {
      await expect(
        db.pool.query("INSERT INTO round_exports (round_id, account_id, service) VALUES ($1, $2, 'spotify')", [
          roundId,
          accountId,
        ]),
      ).rejects.toThrow(/violates check constraint/);
    });

    it('still accepts a supported service on service_links', async () => {
      await expect(
        db.pool.query(
          "INSERT INTO service_links (account_id, service, service_user_id, access_token) VALUES ($1, 'bandcamp', 'new-user', 'new-token')",
          [accountId],
        ),
      ).resolves.toBeDefined();
    });

    it('is safe to run again', async () => {
      await expect(migrate(db.pool)).resolves.toBeUndefined();
    });
  });
  describe('against a pre-#74 database, part-way through a season', () => {
    let db: EmbeddedPg;
    let leagueId: string;

    beforeAll(async () => {
      db = await startEmbeddedPg('mixtape_party_pre74');
      await migrate(db.pool);
      // Rewind just the backfill, then set the database up the way #74 found it: a league whose
      // host had started three of its eight rounds by hand.
      await db.pool.query("DELETE FROM schema_migrations WHERE name LIKE '0002%'");

      const { rows: accountRows } = await db.pool.query<{ id: string }>(
        "INSERT INTO accounts (email, password_hash) VALUES ('midseason@example.com', 'hash') RETURNING id",
      );
      const { rows: leagueRows } = await db.pool.query<{ id: string }>(
        "INSERT INTO leagues (name, season_length, host_account_id, invite_code) VALUES ('Midseason', 8, $1, 'MID1') RETURNING id",
        [accountRows[0].id],
      );
      leagueId = leagueRows[0].id;

      for (const n of [1, 2, 3]) {
        await db.pool.query(
          `INSERT INTO rounds (league_id, round_number, theme, submission_deadline, guessing_deadline, created_at)
           VALUES ($1, $2, 'Theme', $3::timestamptz + make_interval(weeks => 2 * ($2 - 1)),
                   $4::timestamptz + make_interval(weeks => 2 * ($2 - 1)),
                   $5::timestamptz + make_interval(weeks => 2 * ($2 - 1)))`,
          // May to July, so no daylight-saving boundary makes these instants depend on the
          // machine's timezone.
          [leagueId, n, '2030-05-07T00:00:00Z', '2030-05-14T00:00:00Z', '2030-04-30T00:00:00Z'],
        );
      }
      await db.pool.query('UPDATE rounds SET submission_opens_at = NULL');

      await migrate(db.pool);
    }, 60_000);

    afterAll(async () => {
      await db.teardown();
    });

    async function schedule() {
      const { rows } = await db.pool.query<{
        round_number: number;
        theme: string | null;
        submission_opens_at: Date;
        submission_deadline: Date;
        guessing_deadline: Date;
      }>(
        `SELECT round_number, theme, submission_opens_at, submission_deadline, guessing_deadline
         FROM rounds WHERE league_id = $1 ORDER BY round_number`,
        [leagueId],
      );
      return rows;
    }

    it('fills the season out from the last round the host actually started', async () => {
      const rounds = await schedule();
      expect(rounds.map((r) => r.round_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      // Round 3 ran 2030-06-04 -> 2030-06-11, so the rest of the season is weekly from there.
      expect(rounds[3]).toMatchObject({
        theme: null,
        submission_opens_at: new Date('2030-06-04T00:00:00Z'),
        submission_deadline: new Date('2030-06-11T00:00:00Z'),
        guessing_deadline: new Date('2030-06-18T00:00:00Z'),
      });
      expect(rounds[7].guessing_deadline).toEqual(new Date('2030-07-16T00:00:00Z'));
    });

    it('leaves the rounds the host scheduled alone, opening them where they were created', async () => {
      const rounds = await schedule();
      expect(rounds.slice(0, 3).map((r) => r.theme)).toEqual(['Theme', 'Theme', 'Theme']);
      expect(rounds[0].submission_opens_at).toEqual(new Date('2030-04-30T00:00:00Z'));
      expect(rounds[2].guessing_deadline).toEqual(new Date('2030-06-11T00:00:00Z'));
    });

    it('is safe to run again', async () => {
      await migrate(db.pool);
      expect((await schedule()).map((r) => r.round_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });
  });
});
