import { existsSync, readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { hashPassword } from '../auth.js';
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/pool.js';

/**
 * Seeds the demo accounts and leagues for App Store review and screenshots (#135 section 5).
 * Every player is invented. Songs are invented unless listed in REAL below. Re-running wipes and rebuilds the demo data, and only the
 * demo data: it deletes exactly the accounts and invite codes named below, nothing else.
 *
 *   DEMO_PASSWORD='...' DATABASE_URL=... npx tsx src/scripts/seedDemoLeague.ts
 *
 * Live rounds run LIVE_DAYS from now, so re-run before a review submission or a screenshot session.
 *
 * What each league is for:
 *   Friday Night Mixtape  home + results + league screens; round 3 is open for guessing (Demo has not guessed)
 *   Office Jukebox        round 2 is open for submissions (Demo has submitted): the Edit your track screen
 *   Summer Road Trip      finished season: the final-standings screen
 *   Bandcamp Basement     Demo is NOT a member: join it with code DEMOJOIN
 */

export const DEMO_EMAIL = 'demo@mixtape-party.com';
const LIVE_DAYS = 45;
const AVATAR_DIR = new URL('./demo-avatars/', import.meta.url);
/**
 * Guesses forced wrong (`<code>:<round>:<guesser>:<actual>`, lower case) so a screenshot gets a spread of scores.
 * Friday round 2 ends Priya 5, Maya 4, Theo 3, then Demo, Jonah and Lucia on 2: ties sort by name, so Theo only
 * reaches the podium's third (pink) block if everyone else is below him.
 */
const FORCED_WRONG = new Set([
  'theo:demo', 'theo:lucia',
  'demo:maya', 'demo:theo',
  'jonah:maya', 'jonah:theo',
  'lucia:demo', 'lucia:theo',
].map((k) => `demofri:2:${k}`));

type Service = 'youtube_music' | 'bandcamp';
// [title, artist, service?, comment?]
type Pick = [string, string, Service?, string?];

const PEOPLE: Record<string, { name: string; about?: string; pronouns?: string }> = {
  demo: { name: 'Demo Player', about: 'App Store review account. Everyone in these leagues is made up.' },
  maya: { name: 'Maya Okafor', about: 'Will defend a bubblegum pop song to the death.' },
  theo: { name: 'Theo Lindqvist' },
  priya: { name: 'Priya Raman', pronouns: 'she/her' },
  jonah: { name: 'Jonah Beck' },
  lucia: { name: 'Lucia Ferreira', about: 'Three playlists open at all times.' },
  sam: { name: 'Sam Whitaker', pronouns: 'they/them' },
  dara: { name: 'Dara Nolan' },
};
// Demo's own address is the only one that can receive mail; the rest are undeliverable by design.
const emailOf = (key: string) => (key === 'demo' ? DEMO_EMAIL : `${key}@demo.mixtape-party.invalid`);

interface RoundSpec {
  theme: string;
  /** Days from now: submissions open, submissions close, guessing closes. */
  window: [number, number, number];
  picks: Record<string, Pick>;
}
interface LeagueSpec {
  name: string;
  code: string;
  host: string;
  seasonLength: number;
  members: string[];
  rounds: RoundSpec[];
}

/**
 * Real tracks (#190), used only when DEMO_TRACKS=real (the App Review demo). Store screenshots are
 * captured with the default invented songs. Keyed by `<league code>-<round number>-<who>` in lower case, e.g. 'demofri-3-maya'.
 * An entry replaces that pick's title, artist and ID, so the player, art and deep link all work. Picks
 * with no entry keep their invented song. Look IDs up by hand and paste them in; the seed never calls a
 * music service, so it stays offline and re-runnable. Only use tracks you have the right to show
 * (Creative Commons, royalty-free, or an artist who said yes), and re-check they still play before a screenshot session.
 *   youtube_music: externalId is the videoId from watch?v=<id>.
 *   bandcamp:      externalId is `track=<id>`; pageUrl is the track page; artId is the cover art id.
 */
interface RealTrack {
  title: string;
  artist: string;
  externalId: string;
  service?: Service;
  artId?: number;
  pageUrl?: string;
}
const REAL: Record<string, RealTrack> = {
  // Friday Night Mixtape, round 3 (open for guessing). Friends' projects, used with their say-so, plus one CC track.
  'demofri-3-demo': { title: 'a farewell to charms', artist: 'Trough', service: 'bandcamp', externalId: 'track=3088299914', artId: 4173454769, pageUrl: 'https://troughband.bandcamp.com/track/a-farewell-to-charms-2' },
  'demofri-3-maya': { title: 'I Wish I Was in Denver', artist: 'zach H.', service: 'bandcamp', externalId: 'track=4196785198', artId: 2008612253, pageUrl: 'https://zach.bandcamp.com/track/i-wish-i-was-in-denver' },
  'demofri-3-theo': { title: 'Time: This Time Next Time', artist: 'Talking Ghosts', externalId: 'F2UedY2oavg' },
  'demofri-3-priya': { title: 'Flex It, Tagger', artist: 'HLLLYH', externalId: '2SMfkFH3wts' },
  'demofri-3-jonah': { title: 'Fool Me Once', artist: 'BAUS', service: 'bandcamp', externalId: 'track=3215498856', artId: 877994258, pageUrl: 'https://baus.bandcamp.com/track/fool-me-once-single' },
  // CC BY-SA 3.0
  'demofri-3-lucia': { title: 'She Never Finds', artist: 'The Whip Hand', service: 'bandcamp', externalId: 'track=3723961343', artId: 1331865975, pageUrl: 'https://thewhiphanditaly.bandcamp.com/track/she-never-finds-single' },
  // Office Jukebox, round 2 (open for submissions). Creative Commons production music.
  'demojuke-2-demo': { title: 'Surf Riff', artist: 'Owen Lowery', service: 'bandcamp', externalId: 'track=85140321', artId: 1147072385, pageUrl: 'https://owenlowery.bandcamp.com/track/surf-riff' },
  'demojuke-2-sam': { title: '80s Synth Pop', artist: 'Sounds Like An Earful', service: 'bandcamp', externalId: 'track=993345619', artId: 3335967944, pageUrl: 'https://soundslikeanearful.bandcamp.com/track/80s-synth-pop' },
  'demojuke-2-dara': { title: 'Background Pop Punk', artist: 'Sounds Like An Earful', service: 'bandcamp', externalId: 'track=1915335116', artId: 3335967944, pageUrl: 'https://soundslikeanearful.bandcamp.com/track/background-pop-punk' },
  'demojuke-2-maya': { title: 'Mellow Harmonics', artist: 'Sounds Like An Earful', service: 'bandcamp', externalId: 'track=2928045806', artId: 3335967944, pageUrl: 'https://soundslikeanearful.bandcamp.com/track/mellow-harmonics' },
  // Bandcamp Basement (join with DEMOJOIN).
  'demojoin-1-jonah': { title: 'The Pohono', artist: 'Awahnichi', service: 'bandcamp', externalId: 'track=2167884026', artId: 1499503074, pageUrl: 'https://awahnichi.bandcamp.com/track/the-pohono' },
  'demojoin-1-sam': { title: 'Corazon', artist: 'Valley Wolf', service: 'bandcamp', externalId: 'track=4271538934', artId: 1780953540, pageUrl: 'https://valleywolf.bandcamp.com/track/corazon' },
};

const L = LIVE_DAYS;
const LEAGUES: LeagueSpec[] = [
  {
    name: 'Friday Night Mixtape',
    code: 'DEMOFRI',
    host: 'maya', // never 'demo': hosting a live league blocks account deletion, which App Review tests
    seasonLength: 4,
    members: ['demo', 'maya', 'theo', 'priya', 'jonah', 'lucia'],
    rounds: [
      {
        theme: 'Songs for a long drive',
        window: [-42, -35, -28],
        picks: {
          demo: ['Highway Hum', 'Cassette Weather', 'youtube_music', 'Best with the windows down and nowhere to be.'],
          maya: ['Four Lanes Out', 'The Paper Comets'],
          theo: ['Mile Marker 90', 'Juniper Static'],
          priya: ['Gas Station Sunrise', 'Neon Orchard', 'youtube_music', 'Hour five of the road trip, this one saves the day.'],
          jonah: ['Cruise Control Heart', 'Lowtide Parade'],
          lucia: ['Dust on the Dashboard', 'Marigold Avenue'],
        },
      },
      {
        theme: 'Guilty pleasures',
        window: [-28, -21, -14],
        picks: {
          demo: ['Glitter Revenge', 'Velvet Arcade'],
          maya: ['Dance Like Nobody Is Paying', 'The Sequin Club', 'youtube_music', 'Zero shame.'],
          theo: ['Karaoke Breakdown', 'Big Hair Energy'],
          priya: ['Sugar Rush Summer', 'Pastel Riot'],
          jonah: ['Heartbreak Hotline', 'Cherry Cola Kids'],
          lucia: ['Mirrorball Monday', 'Faye Ardent'],
        },
      },
      {
        theme: 'Best opening track',
        window: [-14, -1, L],
        picks: {
          demo: ['Overture for Small Rooms', 'Glass Harbor'],
          maya: ['Here We Go Again, Again', 'Pinwheel'],
          theo: ['Curtain Up', 'The Late Bloomers'],
          priya: ['Static Then Silence', 'Moth Radio'],
          jonah: ['Hello Stranger (Intro)', 'Oak & Ember'],
          lucia: ['First Light', 'Halcyon Row'],
        },
      },
      { theme: 'Covers better than the original', window: [L, L + 14, L + 21], picks: {} },
    ],
  },
  {
    name: 'Office Jukebox',
    code: 'DEMOJUKE',
    host: 'sam',
    seasonLength: 3,
    members: ['demo', 'sam', 'dara', 'maya'],
    rounds: [
      {
        theme: 'Monday morning energy',
        window: [-21, -14, -7],
        picks: {
          demo: ['Coffee Cannon', 'Alarm Clock Orchestra'],
          sam: ['Up and At Em', 'The Early Birds Union'],
          dara: ['Snooze Never', 'Kettle Drum Collective'],
          maya: ['Bright Side Boulevard', 'Sunny Side Up'],
        },
      },
      {
        theme: 'Songs with a color in the title',
        window: [-7, L, L + 7],
        picks: {
          demo: ['Cobalt Monday', 'Velvet Lanterns'],
          sam: ['Indigo Hours', 'Lowtide Parade'],
          dara: ['Red Door Revival', 'Cedar & Smoke'],
          maya: ['Seafoam', 'Pinwheel'],
        },
      },
      { theme: 'One-hit wonders', window: [L + 7, L + 21, L + 28], picks: {} },
    ],
  },
  {
    name: 'Summer Road Trip',
    code: 'DEMOROAD',
    host: 'theo',
    seasonLength: 3,
    members: ['demo', 'theo', 'priya', 'lucia', 'sam'],
    rounds: [
      {
        theme: 'Windows down',
        window: [-60, -53, -46],
        picks: {
          demo: ['Open Road Anthem', 'The Sunburnt Kids'],
          theo: ['Salt in My Hair', 'Coastline Static'],
          priya: ['Convertible Weather', 'Aviator Pop'],
          lucia: ['Wildflower Highway', 'Marigold Avenue'],
          sam: ['Cheap Sunglasses', 'Lemonade Stand Band'],
        },
      },
      {
        theme: 'Sunset songs',
        window: [-46, -39, -32],
        picks: {
          demo: ['Golden Hour Hotel', 'Glass Harbor'],
          theo: ['Last Light on Route 9', 'Juniper Static'],
          priya: ['Amber Sky Lullaby', 'Moth Radio'],
          lucia: ['Dusk Is a Slow Dancer', 'Halcyon Row'],
          sam: ['Orange Horizon', 'Quiet Cartographers'],
        },
      },
      {
        theme: 'Gas station singalong',
        window: [-32, -25, -18],
        picks: {
          demo: ['Slurpee Serenade', 'Cassette Weather'],
          theo: ['Pump Four Heartbreak', 'Big Hair Energy'],
          priya: ['Beef Jerky Blues', 'Neon Orchard'],
          lucia: ['Fluorescent Lullaby', 'Faye Ardent'],
          sam: ['Open All Night', 'The Early Birds Union'],
        },
      },
    ],
  },
  {
    name: 'Bandcamp Basement',
    code: 'DEMOJOIN',
    host: 'jonah',
    seasonLength: 3,
    members: ['jonah', 'dara', 'sam'],
    rounds: [
      {
        theme: 'Songs that sound like a place',
        window: [-3, L, L + 7],
        picks: {
          jonah: ['Harbor Town Lullaby', 'Saltwater Choir', 'bandcamp'],
          dara: ['Desert Motel Neon', 'Mesa Radio'],
          sam: ['Foggy Pier', 'Quiet Cartographers', 'bandcamp'],
        },
      },
      { theme: 'Songs that sound like a season', window: [L + 7, L + 14, L + 21], picks: {} },
      { theme: 'Songs for a rainy day', window: [L + 21, L + 28, L + 35], picks: {} },
    ],
  },
];

const GUESS_COMMENTS = [
  'Called it from the first chord.',
  'Way too on-brand.',
  'I was sure this one was mine, honestly.',
  'No notes. Great pick.',
  'This is a menace and I love it.',
  'Wrong again, but I regret nothing.',
];
const REPLIES = ['Ha, you know me too well.', 'Close, but no.', 'Thank you, I felt this one.'];
const EMOJI = ['🔥', '😂', '❤️', '👏', '🎧'];

const DAY = 86_400_000;

export async function seedDemo(pool: Pool, password: string, now = new Date(), useReal = false): Promise<{ email: string; inviteCodes: string[] }> {
  if (password.length < 8) throw new Error('DEMO_PASSWORD must be at least 8 characters');
  const at = (days: number) => new Date(now.getTime() + days * DAY);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Leagues first, then accounts: a demo account can host only demo leagues, so this is the whole set.
    await client.query('DELETE FROM leagues WHERE invite_code = ANY($1)', [LEAGUES.map((l) => l.code)]);
    await client.query('DELETE FROM accounts WHERE email = ANY($1)', [Object.keys(PEOPLE).map(emailOf)]);

    const hash = hashPassword(password);
    const ids: Record<string, string> = {};
    for (const [key, p] of Object.entries(PEOPLE)) {
      // demo-avatars/<key>.png, when present; players without a file keep the initial.
      const avatarFile = new URL(`${key}.png`, AVATAR_DIR);
      const avatar = existsSync(avatarFile) ? readFileSync(avatarFile) : null;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO accounts (email, password_hash, display_name, about_me, pronouns, avatar, avatar_content_type, avatar_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [emailOf(key), key === 'demo' ? hash : null, p.name, p.about ?? null, p.pronouns ?? null, avatar, avatar && 'image/png', avatar && now],
      );
      ids[key] = rows[0].id;
      // The sweep emails and pushes every member of a live round. These accounts must never be reached.
      await client.query('INSERT INTO notification_settings (account_id, push_enabled, email_enabled) VALUES ($1, false, false)', [ids[key]]);
    }

    const subIds = new Map<string, string>(); // `${code}:${n}:${who}` -> id
    for (const league of LEAGUES) {
      const finished = league.rounds.at(-1)!.window[2] <= 0;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO leagues (name, season_length, host_account_id, invite_code, created_at, concluded_notified_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [league.name, league.seasonLength, ids[league.host], league.code, at(league.rounds[0].window[0] - 3), finished ? now : null],
      );
      const leagueId = rows[0].id;
      for (const key of league.members) {
        await client.query('INSERT INTO league_members (league_id, account_id, joined_at) VALUES ($1, $2, $3)', [
          leagueId, ids[key], at(league.rounds[0].window[0] - 2),
        ]);
      }

      for (const [i, round] of league.rounds.entries()) {
        const [opens, closes, guessCloses] = round.window;
        // All four sweep flags are set so the notification sweep treats every demo round as already handled.
        const r = await client.query<{ id: string }>(
          `INSERT INTO rounds (league_id, round_number, theme, submission_opens_at, submission_deadline, guessing_deadline, created_at,
                               submission_reminder_sent_at, guessing_reminder_sent_at, guessing_notified_at, results_notified_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8, $8) RETURNING id`,
          [leagueId, i + 1, round.theme, at(opens), at(closes), at(guessCloses), at(league.rounds[0].window[0] - 3), now],
        );
        const roundId = r.rows[0].id;

        const submitters = league.members.filter((k) => round.picks[k]);
        for (const [n, who] of submitters.entries()) {
          const [pickTitle, pickArtist, pickService = 'youtube_music', comment] = round.picks[who];
          const slug = `${league.code}-${i + 1}-${who}`.toLowerCase();
          const real = useReal ? REAL[slug] : undefined;
          const title = real?.title ?? pickTitle;
          const artist = real?.artist ?? pickArtist;
          const service = real ? real.service ?? 'youtube_music' : pickService;
          const s = await client.query<{ id: string }>(
            `INSERT INTO submissions (round_id, account_id, service, external_id, art_id, page_url, title, artist, comment, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [roundId, ids[who], service, real?.externalId ?? `demo-${slug}`, real?.artId ?? null, real?.pageUrl ?? null, title, artist, comment ?? null, at(Math.min(opens + 0.1 * (n + 1), -0.01))],
          );
          subIds.set(`${league.code}:${i + 1}:${who}`, s.rows[0].id);
        }

        // Guesses exist once submissions have closed. In a round still open for guessing, Demo has
        // not guessed, so a reviewer can walk the whole flow.
        if (closes > 0) continue;
        const live = guessCloses > 0;
        for (const [g, guesser] of submitters.entries()) {
          if (live && guesser === 'demo') continue;
          for (const [s, actual] of submitters.entries()) {
            if (actual === guesser) continue;
            // Deterministic: every fourth guess is wrong, and lands on the next player along.
            const wrong = (g * 3 + s) % 4 === 0 || FORCED_WRONG.has(`${league.code}:${i + 1}:${guesser}:${actual}`.toLowerCase());
            const others = submitters.filter((k) => k !== guesser && k !== actual);
            const guessed = wrong && others.length ? others[(g + s) % others.length] : actual;
            const commented = (g + s) % 5 === 0;
            const gr = await client.query<{ id: string }>(
              `INSERT INTO guesses (submission_id, guesser_account_id, guessed_account_id, comment, created_at)
               VALUES ($1, $2, $3, $4, $5) RETURNING id`,
              [subIds.get(`${league.code}:${i + 1}:${actual}`), ids[guesser], ids[guessed], commented ? GUESS_COMMENTS[(g + s) % GUESS_COMMENTS.length] : null, at(closes + 0.2 + 0.05 * g)],
            );
            if (commented && !live && (g + s) % 2 === 0) {
              await client.query('INSERT INTO guess_replies (guess_id, account_id, body, created_at) VALUES ($1, $2, $3, $4)', [
                gr.rows[0].id, ids[actual], REPLIES[(g + s) % REPLIES.length], at(closes + 0.5),
              ]);
            }
          }
        }
        if (!live) {
          // Two reactions on every track, from players other than its submitter.
          for (const [s, who] of submitters.entries()) {
            const reactors = submitters.filter((k) => k !== who);
            for (const [j, reactor] of [...new Set([reactors[s % reactors.length], reactors[(s + 1) % reactors.length]])].entries()) {
              await client.query('INSERT INTO comment_reactions (submission_id, account_id, emoji) VALUES ($1, $2, $3)', [
                subIds.get(`${league.code}:${i + 1}:${who}`), ids[reactor], EMOJI[(s + j) % EMOJI.length],
              ]);
            }
          }
        }
      }
    }

    // A few favorites and inbox rows so those screens aren't empty for the reviewer.
    for (const key of ['DEMOFRI:1:priya', 'DEMOFRI:2:maya', 'DEMOROAD:1:theo', 'DEMOROAD:2:lucia']) {
      await client.query('INSERT INTO favorites (account_id, submission_id) VALUES ($1, $2)', [ids.demo, subIds.get(key)]);
    }
    await client.query(
      `INSERT INTO notifications (account_id, type, round_id, league_id, title, body, created_at)
       SELECT $1, v.type, r.id, r.league_id, v.title, v.body, now() - v.age
       FROM (VALUES
         ('guessing_open', 'DEMOFRI', 3, 'Time to guess', 'Everyone has picked for "Best opening track". Who chose what?', interval '2 hours'),
         ('results_ready', 'DEMOFRI', 2, 'Results are in', 'See who has the guilty-pleasure crown in Friday Night Mixtape.', interval '9 days')
       ) AS v(type, code, n, title, body, age)
       JOIN leagues l ON l.invite_code = v.code
       JOIN rounds r ON r.league_id = l.id AND r.round_number = v.n`,
      [ids.demo],
    );

    await client.query('COMMIT');
    return { email: DEMO_EMAIL, inviteCodes: LEAGUES.map((l) => l.code) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) {
    console.error('Set DEMO_PASSWORD (min 8 characters). It is the reviewers\' password, so it is deliberately not in the repo.');
    process.exit(1);
  }
  const pool = createPool();
  console.log(`Seeding demo data into ${new URL(process.env.DATABASE_URL!).host}`);
  migrate(pool)
    .then(() => seedDemo(pool, password, new Date(), process.env.DEMO_TRACKS === 'real'))
    .then((r) => console.log(`Seeded. Sign in as ${r.email}. Invite codes: ${r.inviteCodes.join(', ')}`))
    .finally(() => pool.end());
}
