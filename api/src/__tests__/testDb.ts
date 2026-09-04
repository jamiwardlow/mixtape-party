import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { migrate } from '../db/migrate.js';

export interface TestDb {
  pool: Pool;
  reset(): Promise<void>;
  teardown(): Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mixtape-party-pg-'));
  const port = 40000 + Math.floor(Math.random() * 10000);
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('mixtape_party_test');

  const pool = new Pool({
    host: 'localhost',
    port,
    user: 'postgres',
    password: 'postgres',
    database: 'mixtape_party_test',
  });
  await migrate(pool);

  return {
    pool,
    async reset() {
      await pool.query('TRUNCATE service_links, accounts RESTART IDENTITY CASCADE');
    },
    async teardown() {
      await pool.end();
      await pg.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
