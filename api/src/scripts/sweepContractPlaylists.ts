import { YouTubeMusicAdapter, innertubePost } from '../adapters/youtubeMusicAdapter.js';

/**
 * Deletes leftover `contract-test-*` playlists from the shared YouTube Music app account.
 *
 * The daily contract test now deletes the playlist it creates (#78), so this is for the backlog
 * that accumulated before that, and for the occasional leak from a run killed mid-test.
 *
 * Dry run by default — it prints what it would delete and exits. Pass --yes to actually delete.
 *
 *   YOUTUBE_MUSIC_COOKIE='...' npx tsx src/scripts/sweepContractPlaylists.ts
 *   YOUTUBE_MUSIC_COOKIE='...' npx tsx src/scripts/sweepContractPlaylists.ts --yes
 */

const PREFIX = 'contract-test-';
const LIBRARY_BROWSE_ID = 'FEmusic_liked_playlists';
// ponytail: fixed pause between deletes rather than reading a rate-limit header innertube doesn't
// send. Raise it if a large sweep starts getting refused.
const DELETE_PAUSE_MS = 250;

interface FoundPlaylist {
  id: string;
  title: string;
}

/**
 * Walks the browse response for playlist tiles instead of indexing a fixed path into it. The
 * library's nesting (grid vs. shelf vs. carousel) has changed more than once and this script is
 * run rarely enough that a broken hardcoded path would only be discovered when it's needed.
 */
export function findPlaylists(node: unknown, found: FoundPlaylist[] = []): FoundPlaylist[] {
  if (Array.isArray(node)) {
    for (const item of node) findPlaylists(item, found);
    return found;
  }
  if (node === null || typeof node !== 'object') return found;

  const record = node as Record<string, unknown>;
  const tile = record.musicTwoRowItemRenderer as
    | {
        title?: { runs?: Array<{ text?: string }> };
        navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
      }
    | undefined;

  const title = tile?.title?.runs?.[0]?.text;
  const browseId = tile?.navigationEndpoint?.browseEndpoint?.browseId;
  // Library browseIds are the playlist id behind a `VL` prefix; the delete endpoint wants it bare.
  if (title && browseId?.startsWith('VLPL')) {
    found.push({ id: browseId.slice(2), title });
  }

  for (const value of Object.values(record)) findPlaylists(value, found);
  return found;
}

async function listContractPlaylists(cookie: string): Promise<FoundPlaylist[]> {
  const body = await innertubePost('browse', { browseId: LIBRARY_BROWSE_ID }, cookie);
  const all = findPlaylists(body);
  if (all.length === 0) {
    // Distinguishes "library is clean" from "the walk found nothing because the shape moved".
    throw new Error(
      'Found no playlists at all in the library response — the browse response shape likely changed. ' +
        'Nothing was deleted; check findPlaylists() against a captured response.',
    );
  }
  return all.filter((playlist) => playlist.title.startsWith(PREFIX));
}

async function main(): Promise<void> {
  const cookie = process.env.YOUTUBE_MUSIC_COOKIE ?? process.env.YOUTUBE_MUSIC_TEST_COOKIE;
  if (!cookie) throw new Error('Set YOUTUBE_MUSIC_COOKIE (the shared app-account cookie) to run the sweep');
  const confirmed = process.argv.includes('--yes');
  const adapter = new YouTubeMusicAdapter();

  let deleted = 0;
  // One browse only returns the library's first page. Rather than follow continuation tokens, the
  // sweep deletes what it can see and browses again — deleted playlists drop out of the library,
  // so the next page surfaces on its own. A pass that deletes nothing ends the loop.
  for (;;) {
    const stale = await listContractPlaylists(cookie);
    if (stale.length === 0) break;

    if (!confirmed) {
      console.log(`Would delete ${stale.length} playlist(s) on this page:`);
      for (const playlist of stale) console.log(`  ${playlist.id}  ${playlist.title}`);
      console.log('\nDry run — re-run with --yes to delete. (Only the first library page is listed.)');
      return;
    }

    for (const playlist of stale) {
      await adapter.deletePlaylist(cookie, { externalId: playlist.id, service: 'youtube_music' });
      deleted += 1;
      console.log(`deleted ${playlist.title}`);
      await new Promise((resolve) => setTimeout(resolve, DELETE_PAUSE_MS));
    }
  }

  console.log(`Done — deleted ${deleted} playlist(s).`);
}

// Guarded the same way as src/db/migrate.ts, so the test can import findPlaylists without
// the sweep firing at a real account on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
