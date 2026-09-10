import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Pool } from 'pg';
import { createPool } from './pool.js';

const dbDir = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(dbDir, 'schema.sql');
const migrationsDir = path.join(dbDir, 'migrations');

export async function migrate(pool: Pool): Promise<void> {
  await pool.query(readFileSync(schemaPath, 'utf8'));

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const { rows: applied } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const appliedNames = new Set(applied.map((row) => row.name));

  const pending = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => !appliedNames.has(name));

  for (const name of pending) {
    const sql = readFileSync(path.join(migrationsDir, name), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool();
  migrate(pool)
    .then(() => pool.end())
    .then(() => console.log('migrated'));
}
