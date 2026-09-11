import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';

export interface EmbeddedPg {
  pool: Pool;
  teardown(): Promise<void>;
}

/**
 * Each test file starts its own cluster and vitest runs files in parallel, so two files in one run
 * must not land on the same port. A taken port used to surface as a mystery failure in an
 * unrelated file: the losing cluster stalls until the file's `beforeAll` hook times out and every
 * test in it fails at once. So take a port the OS confirms is free, then bound both calls that can
 * stall — a contended `start()` usually rejects in under a second, but `stop()` on a cluster that
 * never came up hangs indefinitely, which would move the stall into the cleanup path.
 *
 * Worst case is ATTEMPTS * (initdb + START + STOP), kept comfortably under the 60s `hookTimeout`
 * in vitest.config.ts — raise those and this budget needs revisiting.
 */
const START_ATTEMPTS = 3;
const START_TIMEOUT_MS = 8_000;
const STOP_TIMEOUT_MS = 3_000;

/** Rejects rather than hanging, so a wedged cluster can't hold the suite open. */
function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** A port nothing holds as of right now, per the OS. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export async function startEmbeddedPg(databaseName: string): Promise<EmbeddedPg> {
  let lastError: unknown;

  for (let attempt = 0; attempt < START_ATTEMPTS; attempt++) {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'mixtape-party-pg-'));
    const port = await freePort();
    const pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port,
      persistent: false,
    });

    try {
      await pg.initialise();
      await within(pg.start(), START_TIMEOUT_MS, `postgres start on port ${port}`);
      await pg.createDatabase(databaseName);
    } catch (error) {
      lastError = error;
      // A wedged or half-started cluster still owns its data dir; drop both before retrying.
      await within(pg.stop(), STOP_TIMEOUT_MS, 'postgres stop').catch(() => {});
      rmSync(dataDir, { recursive: true, force: true });
      continue;
    }

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

  throw new Error(`embedded postgres failed to start after ${START_ATTEMPTS} attempts`, { cause: lastError });
}
