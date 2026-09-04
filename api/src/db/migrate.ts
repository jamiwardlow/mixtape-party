import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Pool } from 'pg';
import { createPool } from './pool.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

export async function migrate(pool: Pool): Promise<void> {
  const schema = readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool();
  migrate(pool)
    .then(() => pool.end())
    .then(() => console.log('migrated'));
}
