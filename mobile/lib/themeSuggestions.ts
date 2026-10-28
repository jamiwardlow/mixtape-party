const IDEAS = [
  // moods
  'Songs for a rainy day', 'Guilty pleasures', 'Songs that make you cry in the car',
  'Instant mood boosters', 'Songs for sulking', 'Peak 2 a.m. energy', 'Sunday morning slow',
  'Songs that feel like summer', 'Cozy winter nights', 'Songs for angry cleaning',
  // eras
  'Best song of 1985', 'Songs from the year you turned 16', 'Released this year',
  'Songs older than you', 'The 90s on the radio', 'Early 2000s nostalgia', 'Songs from 1969',
  // genres and sounds
  'Best cover song', 'Instrumentals only', 'Songs in a language you do not speak',
  'One-hit wonders', 'Songs with a killer bassline', 'Best use of a saxophone',
  'Songs with a spoken-word intro', 'Folk songs with a twist', 'Hip-hop deep cuts',
  'Disco, but unexpected', 'Heavy but beautiful', 'Songs under two minutes',
  'Songs over seven minutes', 'Best live recording', 'Best B-side', 'Songs with a key change',
  // stories
  'Songs for a road trip', 'Song you would play at your own wedding',
  'Song you would play at your own funeral', 'First song you ever loved',
  'The song that was on repeat in your teens', 'Songs about home', 'Songs about leaving',
  'Songs about food', 'Songs with a color in the title', 'Songs with a name in the title',
  'Songs with a place in the title', 'Songs with a number in the title',
  'Songs about the weather', 'Songs about the night', 'Songs about the sea',
  'Songs for the end of the world', 'Songs for a first date', 'Songs for a breakup',
  'Song your parents loved', 'Song you would play to convert a skeptic',
  'The soundtrack to a movie that does not exist', 'Best movie soundtrack song',
  'Songs from a video game', 'Songs you discovered from a TV show',
  // wildcards
  'Make us dance', 'Make us laugh', 'Make us think', 'Songs that sound like a hug',
  'Hidden gems under 10,000 plays', 'Songs we have probably never heard',
  'Your favorite song nobody knows', 'Songs with one-word titles', 'Songs with a question title',
  'Songs that start with a drumbeat', 'Songs with great harmonies', 'Songs with a guitar solo',
  'Songs that sound like a place', 'Songs with a surprise ending', 'The most 2010s song',
  'Songs you play when no one is listening', 'Songs for a long walk', 'Songs for a long flight',
  'Songs for cooking dinner', 'Songs for running late', 'Best opening track', 'Best closing track',
  'Songs about being tired', 'A song that gives you chills', 'Songs that should be louder',
];

const norm = (s: string) => s.trim().toLowerCase();

/** Up to `count` distinct ideas not already in `taken` (compared case-insensitively). */
export function pickIdeas(count: number, taken: string[] = [], random: () => number = Math.random): string[] {
  const used = new Set(taken.map(norm));
  const pool = IDEAS.filter((idea) => !used.has(norm(idea)));
  // Partial Fisher-Yates: only the first `count` slots need to be shuffled.
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}
