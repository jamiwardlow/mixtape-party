import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
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

/**
 * A port nothing holds on 127.0.0.1 as of right now, drawn from below the OS ephemeral range
 * (49152+ on macOS, 32768+ on Linux). supertest serves each request from an OS-assigned ephemeral
 * port bound to `::`, and macOS lets that bind succeed even while a cluster holds the same number
 * on 127.0.0.1 — the request then reaches Postgres and fails with "socket hang up". Staying out of
 * that range keeps the two from ever sharing a port.
 */
async function freePort(): Promise<number> {
  for (;;) {
    const port = 15_000 + Math.floor(Math.random() * 15_000);
    const server = createServer();
    const free = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (!free) continue;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  }
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
        // A client still closing when the server goes down emits 57P01 on the pool; nothing is
        // left to care about it, and unhandled it fails the whole run.
        pool.on('error', () => {});
        await pool.end();
        await pg.stop();
        rmSync(dataDir, { recursive: true, force: true });
      },
    };
  }

  throw new Error(`embedded postgres failed to start after ${START_ATTEMPTS} attempts`, { cause: lastError });
}
