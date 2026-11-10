import { BandcampAdapter } from '../adapters/bandcampAdapter.js';
import { createPool } from '../db/pool.js';

/**
 * Fills submissions.page_url for Bandcamp tracks submitted before #197, by reading `linkback` off
 * each embedded player page. Bandcamp bot-walls Cloud Run, so run this from a laptop:
 *
 *   DATABASE_URL=... npx tsx src/scripts/backfillBandcampPageUrl.ts
 *
 * Idempotent: only touches rows where page_url is null; a track that can't be read stays null and
 * keeps opening the bare player.
 */
const pool = createPool();
const adapter = new BandcampAdapter();
const { rows } = await pool.query<{ external_id: string }>(
  "SELECT DISTINCT external_id FROM submissions WHERE service = 'bandcamp' AND page_url IS NULL",
);
for (const { external_id } of rows) {
  const [, kind, id] = external_id.match(/^(track|album)=(\d+)$/) ?? [];
  const found = kind ? await adapter.submit(`https://bandcamp.com/EmbeddedPlayer/${kind}=${id}`).catch(() => null) : null;
  if (!found?.pageUrl) {
    console.log('skipped', external_id);
    continue;
  }
  await pool.query("UPDATE submissions SET page_url = $1 WHERE service = 'bandcamp' AND external_id = $2 AND page_url IS NULL", [found.pageUrl, external_id]);
  console.log('filled', external_id, found.pageUrl);
}
await pool.end();
