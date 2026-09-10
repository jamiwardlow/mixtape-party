import type { Pool } from 'pg';
import { migrate } from '../db/migrate.js';
import { startEmbeddedPg } from './embeddedPg.js';

export interface TestDb {
  pool: Pool;
  reset(): Promise<void>;
  teardown(): Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const { pool, teardown } = await startEmbeddedPg('mixtape_party_test');
  await migrate(pool);

  return {
    pool,
    async reset() {
      await pool.query(
        'TRUNCATE auth_tokens, notifications, push_tokens, notification_settings, guesses, submissions, league_members, rounds, leagues, service_links, accounts RESTART IDENTITY CASCADE',
      );
    },
    teardown,
  };
}
