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
});
