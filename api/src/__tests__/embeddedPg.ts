import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';

export interface EmbeddedPg {
  pool: Pool;
  teardown(): Promise<void>;
}

export async function startEmbeddedPg(databaseName: string): Promise<EmbeddedPg> {
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
  await pg.createDatabase(databaseName);

  const pool = new Pool({ host: 'localhost', port, user: 'postgres', password: 'postgres', database: databaseName });

  return {
    pool,
    async teardown() {
      await pool.end();
      await pg.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
