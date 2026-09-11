import { describe, expect, it } from 'vitest';
import { startEmbeddedPg } from './embeddedPg.js';

describe('startEmbeddedPg', () => {
  // The flake this guards: every test file starts its own cluster, and vitest runs files in
  // parallel. Two clusters on the same port make `pg.start()` hang until the file's hook timeout,
  // which surfaces as unrelated failures somewhere else in the suite.
  it('starts concurrent clusters that do not collide or share state', async () => {
    const [a, b] = await Promise.all([startEmbeddedPg('concurrent_a'), startEmbeddedPg('concurrent_b')]);

    try {
      await a.pool.query('CREATE TABLE only_in_a (id int)');

      const ports = await Promise.all(
        [a, b].map(async ({ pool }) => (await pool.query<{ port: number }>('SELECT inet_server_port() AS port')).rows[0].port),
      );
      expect(ports[0]).not.toBe(ports[1]);

      await expect(b.pool.query('SELECT * FROM only_in_a')).rejects.toThrow(/only_in_a/);
    } finally {
      await Promise.all([a.teardown(), b.teardown()]);
    }
  });
});
