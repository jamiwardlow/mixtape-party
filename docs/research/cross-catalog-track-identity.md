# Research: how to tell a YouTube Music result and an Apple Music result are the same track

Resolves: [#203](https://github.com/jamiwardlow/mixtape-party/issues/203)
Parent: [#200 Map: Apple Music as a third service, with one submit box](https://github.com/jamiwardlow/mixtape-party/issues/200)

Sources: this repo's code and git history, Apple's Apple Music API docs on `developer.apple.com`, and the
[`ytmusicapi`](https://github.com/sigma67/ytmusicapi) source (the best-maintained innertube client; last commit
2026-11-12). The Apple Music API needs a developer token we don't have locally, so its endpoints were not called. Two
credential-free probes were run on 2026-11-20 from a dev laptop:
- **YouTube Music:** the exact unauthenticated innertube `search` request `YouTubeMusicAdapter.search` sends.
- **Apple:** the public iTunes Search API, which serves the same catalog with the same numeric song IDs but no ISRC.

The probe output is quoted where it backs a claim. The latencies are indicative only, because Cloud Run in `us-west1`
will differ.

## TL;DR

- **The two sides are lopsided.** An Apple Music song carries `isrc` and `durationInMillis` in every search result. A
  YouTube Music search row carries title, all artists, album and an `m:ss` duration. It has **no ISRC anywhere**, not in
  search and not in the per-track `player` call either. So no ISRC-to-ISRC comparison is possible, at any cost.
- **Merging at search time costs no extra round-trips.** You already have both lists, so deciding whether a YTM row and
  an Apple row match is a local comparison: normalised title, then primary artist, then duration within ±2 s. Request
  latency becomes the slower of two parallel searches. YTM measured about 1.0 s and is the slow one; Apple-catalog
  search measured 0.3–0.4 s through the iTunes API.
- **Duration is necessary but not sufficient.** Remasters, "Drumless" editions and 2019 remixes land within 0.1 s of
  the original. The version tags in the title ("Live", "Radio Edit", "2019 Mix", …) are what separate them, so
  normalisation must strip only tags that don't change the recording (`feat.`, `Remastered …`).
- **No accuracy evidence exists for the existing match cache.** `resolveMatch` has been unreachable in production since
  Apple Music was dropped, it has no tests of its own, and both adapters' `match` trust the top search hit blindly. A
  YTM search by ISRC returns 20+ rows even for a made-up ISRC, and for Bohemian Rhapsody's real ISRC the top hit was
  unrelated.
- **Recommendation:** merge conservatively at search time (a false merge plays the wrong recording, while a missed
  merge only shows two rows). Store the counterpart ID the player implicitly confirmed. Do the remaining cross-catalog
  resolution lazily (guess, export) through a fixed `match` that verifies its candidate.

## 1. What each side exposes

### YouTube Music (innertube `search`, songs filter)

The adapter POSTs `youtubei/v1/search` with `params: 'EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D'` (songs only), without
credentials (`api/src/adapters/youtubeMusicAdapter.ts`, `search`). Each row is a `musicResponsiveListItemRenderer`:

| Field | Where | Used by the adapter today? |
| --- | --- | --- |
| `videoId` | `playlistItemData.videoId` | yes, as `externalId` |
| title | `flexColumns[0]` runs | yes |
| artists | `flexColumns[1]` runs, before the first ` • ` | **first run only** |
| album | `flexColumns[1]`, the second ` • ` segment | no |
| duration (`m:ss`, whole seconds) | `flexColumns[1]`, the last segment | no |
| video type | `…watchEndpointMusicConfig.musicVideoType` | no |
| ISRC | **not present** | n/a |

The probe confirms the layout. The second column of a row reads
`'Daft Punk | , | Pharrell Williams | & | Nile Rodgers | • | Random Access Memories | • | 6:10'`.
`ytmusicapi` parses the same runs into `artists`, `album`, `duration` and `duration_seconds`
([`parsers/search.py`](https://github.com/sigma67/ytmusicapi/blob/main/ytmusicapi/parsers/search.py),
`parse_search_result` → `parse_song_runs` in
[`parsers/songs.py`](https://github.com/sigma67/ytmusicapi/blob/main/ytmusicapi/parsers/songs.py)).

**"Song" vs "video" results.** Every row the songs filter returned across 7 probe queries had
`musicVideoType: MUSIC_VIDEO_TYPE_ATV`, the label-supplied audio track. The filter keeps out official videos (`OMV`) and
user uploads (`UGC`), so the adapter only sees ATV rows today. That matters, because an OMV is often a different cut
(intro, skit, extended outro) with a different duration. If the submit box ever accepts a pasted
`music.youtube.com/watch?v=` link to a video, that ID can be an OMV, and it should not be merged by title alone.
`ytmusicapi` exposes this type as `videoType` on every song or video result (same file, `search_result["videoType"]`).

**ISRC.** It is not in search results or in the `player` response that backs a per-track detail call. The `ytmusicapi`
maintainer checked both and found that the ISRC is "only available in the backend for search. It was not contained in
search or get_song response"
([sigma67/ytmusicapi#144](https://github.com/sigma67/ytmusicapi/issues/144)). The `get_song` docstring example shows
what the detail call does return: `videoDetails` with `lengthSeconds`, `author` and `musicVideoType`, plus
`microformat`
([`mixins/browsing.py`, `get_song`](https://github.com/sigma67/ytmusicapi/blob/main/ytmusicapi/mixins/browsing.py)).
So **a detail call buys nothing for identity**. It would cost another ~1 s round-trip per row for a duration we
already have.

**Searching YTM *by* ISRC works sometimes, and it fails silently.**

| Query | Result |
| --- | --- |
| `USSM19500010` (Earth Song) | Correct top hit, then 19 unrelated rows (`Suraj Hua Maddham`, `Thunderstruck`, …) |
| `GBUM71029604` (Bohemian Rhapsody 2011 remaster, per Deezer `/track/isrc:`) | Top hit `GMM 39374 EN REV1` by "Gift My Music"; the real song was **second** |
| `ZZXX12345678` (made up) | 25 rows, top hit `zxxc` by DOOM |

The response never echoes the ISRC, so nothing tells a hit from fuzzy text matching on the string.

### Apple Music (catalog API)

- **Search.** `GET /v1/catalog/{storefront}/search?term=…&types=songs` returns a `SearchResponse` whose `songs` are
  `Songs` resources ([Search for Catalog Resources (by type)](https://developer.apple.com/documentation/applemusicapi/search-for-catalog-resources-(by-type)),
  [SearchResponse.Results](https://developer.apple.com/documentation/applemusicapi/searchresponse/results-data.dictionary)).
  `limit` defaults to 5 with a maximum of 25 (prior research, `research/apple-musickit` branch,
  `docs/research/apple-musickit.md` §1).
- **`Songs.Attributes`**
  ([docs](https://developer.apple.com/documentation/applemusicapi/songs/attributes-data.dictionary)):
  - `name`, `artistName`, `albumName` and `durationInMillis` are required.
  - `isrc` is optional and is not marked "Extended", so it comes back without `extend=`.
  - `releaseDate`, `contentRating`, `trackNumber` and `discNumber` are also there.
  - Featured artists sit in `artistName` (`"Daft Punk, Pharrell Williams & Nile Rodgers"`), not in `name`.
- **ISRC lookup.** `GET /v1/catalog/{storefront}/songs?filter[isrc]=…` is the documented way to find songs by ISRC.
  The docs warn that "one ISRC value may return more than one song", with up to 25 per call
  ([Get Multiple Catalog Songs by ISRC](https://developer.apple.com/documentation/applemusicapi/get-multiple-catalog-songs-by-isrc)).
  Searching with an ISRC as `term`, which the deleted Apple adapter did, is not documented to work.
- **Storefronts.** Catalog IDs are fetched per storefront, while the ISRC is the cross-storefront key
  ([Handling Requests and Responses](https://developer.apple.com/documentation/applemusicapi/handling-requests-and-responses)).
- **Rate limits.** No numbers are published, only a 429 on excess
  (prior research §6, [Generating Developer Tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)).

## 2. Title and artist normalisation: what actually differs

Matching pairs from the probe (YTM search with songs filter, iTunes Search API with `country=us`):

| Recording | YouTube Music | Apple | Pitfall |
| --- | --- | --- | --- |
| Get Lucky (album) | `Get Lucky (feat. Pharrell Williams and Nile Rodgers)` / `Daft Punk` (+2 artist runs) / 6:10 | `Get Lucky` / `Daft Punk, Pharrell Williams & Nile Rodgers` / 369 629 ms | `feat.` sits in YTM's title but in Apple's artist |
| Get Lucky (Drumless Edition) | not in the top results | `Get Lucky (Drumless Edition) (feat. …)` / 369 747 ms | **0.1 s from the album cut**, so only the title tag separates them |
| Get Lucky (Radio Edit) | `Get Lucky (Radio Edit - feat. …)` / 4:09 | n/a | duration separates it |
| Here Comes the Sun (2009 remaster) | `Here Comes The Sun (Remastered 2009)` / 3:06 | `Here Comes the Sun` (album "Abbey Road (Remastered)") / 185 733 ms | YTM puts the remaster tag in the title and Apple doesn't; case differs ("The") |
| Here Comes the Sun (2019 mix) | n/a | `Here Comes the Sun (2019 Mix)` / 185 707 ms | a different recording, **0.03 s** from the 2009 one |
| Earth Song | `Earth Song` (HIStory) 6:47, and `Earth Song (Remastered Version)` (This Is It) 6:47 | `Earth Song` ×2 HIStory IDs (405 934 ms), plus This Is It (406 211 ms) | duplicates *within* each catalog; YTM rounds 405.9 s to 6:47 = 407 s |
| Hurt | `Hurt` / Johnny Cash / 3:37 | n/a | covers with the same title and close durations (`Hurt` by Diane Raini, 3:44) are separated only by artist |

The rules that fall out of this table:

1. **Strip** `(feat. …)`, `[feat. …]`, `- feat. …` and `(with …)` from the title. Compare the *primary* artist only:
   YTM's first artist run against Apple's `artistName` split on `,` and `&`, first element. That needs the adapter to
   keep all YTM artist runs, not just `runs[0]`.
2. **Strip only "remaster" tags**: `(Remastered)`, `(Remastered 2009)`, `- Remastered 2011`, `(Remastered Version)`.
   A remaster is the same performance, and the catalogs disagree on where the tag goes.
3. **Keep every other tag as part of the identity**: Live, Acoustic, Demo, Radio Edit, Single Version, Remix, `… Mix`,
   Instrumental, Karaoke, Drumless, Edit, Version, Mono, Stereo. Two rows with different tags are different rows.
4. **Normalise text** with lowercase, NFKD, dropping punctuation and `&`/`and`. `deezerPreview.ts`'s
   `normalize` (`[^a-z0-9]` removal) already does this. As that file notes, all-non-Latin names normalise to `''` and
   must not match each other.
5. **Duration within ±2 s** as a guard, never as the deciding signal. YTM is whole seconds (Earth Song's gap is 1.07 s).
6. Album name: don't require it to match, because compilation, deluxe and "This Is It" reissues carry the same
   recording.

When the two disagree, **don't merge**. Two rows for one song is a cosmetic miss. A wrong merge means the player
submits one recording and a guesser on the other service hears a different one.

## 3. The existing match cache: what it does, and its track record

- **`resolveMatch`** (`api/src/adapters/matchCache.ts`) keys on `isrc:<ISRC>` if the track has one, else
  `ta:<lower(title)>|<lower(artist)>`. It reads `track_matches` and returns the hit, a cached no-match included.
  - On a miss it calls `adapter.match`, writes the outcome **permanently** (`ON CONFLICT DO NOTHING`, no expiry,
    no invalidation), and skips the write on `ServiceUnavailableError`.
  - The key has no duration or version, so a cached wrong answer for `ta:hurt|johnny cash` is served forever.
- **`YouTubeMusicAdapter.match`** searches `track.isrc ?? "title artist"` and returns `results[0]` with no
  verification. The deleted `AppleMusicAdapter.match` (`git show 6d007b2^:api/src/adapters/appleMusicAdapter.ts`) was
  the same: it searched with an ISRC as `term`, not `filter[isrc]`, and took `results[0]`.
- **Callers.** Only `matchSubmissions` in `api/src/routes/export.ts` calls it.
  - `EXPORTABLE_SERVICES = ['youtube_music']`, and Bandcamp submissions are filtered out of the export query.
  - Every exportable submission is therefore already on YTM and takes the "already on this exact service" branch.
  - **So `resolveMatch` has not been able to call `match` since `6d007b2` ("Drop Apple Music entirely",
    2026-10-23)**, and `track_matches.service` is `CHECK (service IN ('youtube_music'))` in `api/src/db/schema.sql`.
- **Submit-time `match`.** `POST /rounds/:roundId/submissions` calls `adapter.match` as an existence check and ignores
  the result (`api/src/routes/submissions.ts`). It never compares the matched ID with the submitted `externalId`, and it
  adds a second YTM search (~1 s) to every submit.
- **ISRC in practice.** YTM search never produces one, so submissions from search store `isrc = null`. The mobile
  submit screen forwards `item.isrc` (`mobile/app/round/[roundId]/submit.tsx`), but it is always undefined today.
- **Accuracy evidence: none.**
  - No test touches `resolveMatch` or `track_matches` (`git log -S track_matches -- api/src/__tests__` is empty).
  - The pre-removal export tests used fakes with forced no-matches (`git show 6d007b2 -- api/src/__tests__/export.test.ts`).
  - The YTM contract and integration tests don't exercise `match`.
  - No issue reports a wrong match, but Apple Music was live only briefly (#25, #70–#73), so silence is not evidence.
  - Production `track_matches` wasn't queried (no credentials). Expect it to be small and dominated by
    Apple-era `ta:` rows.
  - The ISRC probe above is the only real evidence, and it shows the top hit of an ISRC query is unreliable.
- **Side finding.** `deezerPreview.ts`'s ISRC branch is live: Deezer's `/search` rows do include `isrc` (probe keys:
  `album, artist, duration, …, isrc, …, title, title_short, title_version`). Deezer also has a credential-free exact
  lookup, `GET https://api.deezer.com/track/isrc:<ISRC>`, which returned `Bohemian Rhapsody (Remastered 2011)` for
  `GBUM71029604`. Deezer could act as an ISRC oracle for a YTM row: title and artist search, then verify duration. That
  adds a third service to the critical path, so it's noted here, not recommended.

## 4. Latency, and where the merge should happen

Measured round-trips on a dev laptop (not Cloud Run):

| Call | Samples | Time |
| --- | --- | --- |
| YTM innertube `search` | 10 | 942–1 248 ms, median about 1 000 ms |
| iTunes Search API (Apple's catalog, no auth) | 3 | 290–380 ms |

The Apple Music API itself is unmeasured.

| Option | Extra calls per search | Added latency | Notes |
| --- | --- | --- | --- |
| **A. Merge at search time, local compare** (search both in parallel, pair rows with §2 rules) | 0 | max(YTM, Apple) − YTM ≈ **0** when YTM is the slower side | Only pairs songs that both searches surfaced. That covers popular songs, which are also the ones most likely to show twice |
| B. A + ISRC-verify each candidate pair against YTM (search YTM by Apple's ISRC) | 1 YTM search per pair (~1 s, parallelisable) | +~1 s | Not worth it: the YTM ISRC search can't confirm anything (§1) |
| C. For every result, resolve its counterpart on the other service | up to 20+25 searches | +1–2 s even fully parallel; rate-limit exposure on both sides | Search-as-you-type makes this many times worse |
| **D. Lazy: resolve the counterpart when needed** (on submit for the picked row, or at guess or export time) | 1 per submission, cached | 0 on search, ~1 s once per submission off the search path | This is what `resolveMatch` is shaped for, after its `match` is fixed |

The two searches don't share a deadline today. `REQUEST_TIMEOUT_MS = 5000` on YTM, and one service being down must
still return the other's results (`ServiceUnavailableError` → per-service "unavailable", not a 503 for the whole box).

## Implications for the map

### #204: single submit box with merged duplicates

- **Do it with option A.** Run both searches in parallel and merge locally with the §2 rules. That adds no round-trips
  and leaves the latency at the slower service, which is YTM at ~1 s. A merged row shows one title and both service
  marks. An unpaired row shows its single mark.
- **Merge conservatively.** Remaster and `feat.` differences may merge. Any other version tag, a different primary
  artist, or more than 2 s of difference means two rows. The prototype should show what a near-miss looks like:
  `Here Comes the Sun` next to `Here Comes the Sun (2019 Mix)`.
- **Merge groups can be many-to-many.** Earth Song has two Apple IDs and two YTM IDs that all pass the rules. Collapse
  them into one row and pick a representative per service: the first in that service's own ranking.
- **Adapter changes the box needs.** These are small and live in `youtubeMusicAdapter.ts` `search`:
  - keep all artist runs
  - parse album and duration from `flexColumns[1]`
  - add `durationMs?` (and probably `album?`) to `TrackResult` in `types.ts`

  Apple's `durationInMillis` and `isrc` come free.
- **Pasted links.** A pasted YTM `watch?v=` link may be a video (`OMV`/`UGC`), not an `ATV` song. Treat it as
  unmerged and resolve it lazily, or not at all.

### #205: what a submission records

- **Record the origin service and ID, as today, plus the counterpart ID when the player picked a merged row.** That
  pairing came from a search the player looked at and picked, which beats any later blind `match`. The obvious place
  is a confirmed row in `track_matches`, or a per-submission counterpart column. #205 should decide which. The
  `track_matches.service` CHECK needs `apple_music` either way.
- **Always record `isrc` and `duration_ms` when the source has them.** Apple always gives both. YTM gives duration and
  never ISRC. An Apple-origin submission can then resolve to YTM later by verified text search, and a YTM-origin
  submission can resolve to Apple by text search plus duration plus tags.
- **Fix `match` before relying on lazy resolution.** Treat these as prerequisites, not polish:
  - verify the candidate (§2 rules) instead of taking `results[0]`
  - on Apple, use `filter[isrc]` when an ISRC is known
  - never trust a YTM ISRC query's top hit without the title and duration check
  - add duration (or a version-tag-aware title) to the `ta:` cache key, so `Hurt` and a live `Hurt` don't share an
    entry
- **Drop or repurpose the submit-time existence `match`.** It costs a second YTM search per submit and verifies
  nothing. #205 is the natural place to decide that.
- **Results reveal is unaffected.** The origin service is still the one column the player chose. Any counterpart is
  derived data.
