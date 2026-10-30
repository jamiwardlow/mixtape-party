import type { Pool } from 'pg';

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Ids the blocker has blocked: their comments, replies and reactions are left out of the blocker's views. */
export async function blockedIds(pool: Pool, blockerId: string): Promise<Set<string>> {
  const rows = (await pool.query<{ blocked_id: string }>('SELECT blocked_id FROM blocks WHERE blocker_id = $1', [blockerId])).rows;
  return new Set(rows.map((r) => r.blocked_id));
}

/** True when `recipient` has blocked `sender`, so nothing from `sender` should ping them. */
export async function hasBlocked(pool: Pool, recipient: string, sender: string) {
  return !!(await pool.query('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [recipient, sender])).rowCount;
}

/** True when the two accounts are members of at least one common league. */
export async function sharesLeague(pool: Pool, a: string, b: string) {
  return !!(
    await pool.query(
      `SELECT 1 FROM league_members x JOIN league_members y ON y.league_id = x.league_id
       WHERE x.account_id = $1 AND y.account_id = $2 LIMIT 1`,
      [a, b],
    )
  ).rowCount;
}

/** A blocked player shows as "Blocked player" with no photo wherever the blocker sees a roster. */
export function maskBlocked<T extends { accountId: string; displayName: string | null; avatarUrl?: string | null }>(player: T, blocked: Set<string>): T {
  return blocked.has(player.accountId) ? { ...player, displayName: 'Blocked player', avatarUrl: undefined } : player;
}
