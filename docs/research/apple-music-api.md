# Research: what the Apple Music API offers today

Resolves: [#201 Research: what the Apple Music API offers today](https://github.com/jamiwardlow/mixtape-party/issues/201)
Parent map: [#200 Apple Music as a third service, with one submit box](https://github.com/jamiwardlow/mixtape-party/issues/200)
Builds on: `docs/research/apple-musickit.md` on branch `research/apple-musickit` (2026-09-02, for #3)

Checked 2026-11-20. Sources are Apple's developer documentation, the Apple Developer Program License
Agreement (ADPLA), the App Review Guidelines, and, only where Apple publishes nothing, Apple
Developer Forums threads (marked as such). Apple's DocC pages render client-side, so the content
was read from the JSON endpoint each page loads from
(`developer.apple.com/tutorials/data/documentation/<path>.json`). The text is the same; links
below point to the human-readable pages.

## What changed since the September research

| Topic | September (`research/apple-musickit`) | Today |
| --- | --- | --- |
| Playlist creation fields | Listed `attributes.isPublic` as an optional creation field | The creation schema documents only `name` (required) and `description`. `isPublic` now appears only as a **read-only** attribute of an existing library playlist. There is no documented way to create a public playlist or make one public. See §4. |
| Search page size | "default 5, max 25" | The current Search page lists `limit` with no default or maximum stated. It points to each resource's fetch limits instead. See §2. |
| Search result types | 10 types | `SearchResponse.Results` also has a `top` member (top results). See §2. |
| ISRC lookup, `isrc`, `durationInMillis`, artwork | Not covered | Covered in §2 and §3. |
| Music User Token lifetime | Not covered | Not documented by Apple. On the forums, Apple staff said "6 months currently" (2020). Tokens stored on a backend are reported returning `403` after 1–2 days, and Apple DTS says the device should mint a fresh one each launch. See §5. |
| Subscription per operation | Covered for playback only | Covered per operation in §6. |
| ADPLA §3.3.6.D MusicKit | Quoted with an ellipsis | Wording unchanged. The elided sentence requires following the Apple Music Identity Guidelines. |
| App Review Guidelines | Not covered | 4.5.2 and 5.2.5 are relevant, including a rule that previews may not be used as a game's soundtrack. See §8. |

Everything else in the September doc still matches current docs: the JWT shape, the 6-month
developer-token cap, append-only playlist mutation, rate limiting with no published numbers, and
automatic token handling on Apple platforms and web vs. manual handling on Android.

## 1. Developer token (JWT) from the team's MusicKit key

- Every Apple Music API request needs a signed developer token, which requires Apple Developer Program membership. Source: [Generating Developer Tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)
- The key comes from Certificates, Identifiers & Profiles: you create a media identifier, then a private key (`.p8`) with MusicKit enabled. Source: [Create a media identifier and private key](https://developer.apple.com/help/account/capabilities/create-a-media-identifier-and-private-key/)
- Token format:
  - Header: `alg: ES256` and `kid`, the 10-character key ID.
  - Claims: `iss` (the 10-character Team ID), `iat`, and `exp`. `exp` must be no more than `15777000` seconds (6 months) after the current Unix time on the server.
  - Optional `origin` claim: an array of allowed web origins, recommended for web clients.
  - The token is signed with the MusicKit private key. Tokens not signed with ES256 are rejected with `401`. It is sent as `Authorization: Bearer <token>`.
  - Source: [Generating Developer Tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)
- For Apple-platform apps, Apple recommends MusicKit for Swift with automatic token generation instead. Source: same page; [Using Automatic Developer Token Generation](https://developer.apple.com/documentation/musickit/using-automatic-token-generation-for-apple-music-api)
- A bad developer token returns `401`. A problem with the user token returns `403`. Source: [Handling Requests and Responses](https://developer.apple.com/documentation/applemusicapi/handling-requests-and-responses)

## 2. Catalog search

- Endpoint: `GET https://api.music.apple.com/v1/catalog/{storefront}/search`. Parameters:
  - `term`: required, with `+` between words.
  - `types`: required.
  - `limit`, `offset`, `l`, and `with`.
  - Returns `200 SearchResponse`, `401`, or `500`.
  - The storefront (an ISO 3166 alpha-2 code) is part of the path.
  - Source: [Search for Catalog Resources](https://developer.apple.com/documentation/applemusicapi/search-for-catalog-resources-(by-type))
- `SearchResponse.Results` has one member per resource type: `activities, albums, apple-curators, artists, curators, music-videos, playlists, record-labels, songs, stations`, plus `top`. Source: [SearchResponse.Results](https://developer.apple.com/documentation/applemusicapi/searchresponse/results-data.dictionary)
- **Page size:** the current Search page gives no default or maximum for `limit`. The paging guide says the API applies a default if you don't set one, to "see the corresponding resource's object model for the default fetch limit", and to follow the `next` subpath. Source: [Fetching Resources by Page](https://developer.apple.com/documentation/applemusicapi/fetching-resources-by-page). The September doc's "default 5, max 25" is no longer stated on the page. Treat 25 per type as a working assumption and confirm it in a contract test.
- Hints and suggestions endpoints exist for autocomplete. A separate library-search endpoint needs a Music User Token. Source: [Search](https://developer.apple.com/documentation/applemusicapi/search)
- Searching the catalog needs only the developer token: the endpoint lists no `403` and no user-token requirement. Source: [Search for Catalog Resources](https://developer.apple.com/documentation/applemusicapi/search-for-catalog-resources-(by-type))

### Fields on a song (`Songs.Attributes`)

Source for every row: [Songs.Attributes](https://developer.apple.com/documentation/applemusicapi/songs/attributes-data.dictionary)

| Field | Required? | Notes |
| --- | --- | --- |
| `name`, `artistName`, `albumName` | yes | `name` is localized (see `l`) |
| `durationInMillis` | yes | integer milliseconds |
| `isrc` | **optional** | "The International Standard Recording Code (ISRC) for the song." Not guaranteed present. |
| `artwork` | yes | an `Artwork` object (below) |
| `url` | yes | "The URL for sharing the song in Apple Music" |
| `previews` | yes | array of `Preview` (`url`, optional `hlsUrl`) ([Preview](https://developer.apple.com/documentation/applemusicapi/preview)) |
| `playParams` | optional | "When present, this attribute indicates that the song is available to play with an Apple Music subscription … Previews of the song audio may be available with or without an Apple Music subscription." |
| `contentRating`, `releaseDate`, `genreNames`, `trackNumber`, `discNumber`, `composerName`, `hasLyrics`, `isAppleDigitalMaster` | mixed | `contentRating` is `explicit`/`clean` or absent |

**Artwork:** `url` (required) is a template that contains `{w}x{h}`, which you replace with a
size. `width` and `height` give the largest size available. There are also optional `bgColor` and
`textColor1`–`textColor4` fields. Source: [Artwork](https://developer.apple.com/documentation/applemusicapi/artwork)

## 3. ISRC and catalog lookup for matching

- **By ISRC:** `GET /v1/catalog/{storefront}/songs?filter[isrc]=…`. Source: [Get Multiple Catalog Songs by ISRC](https://developer.apple.com/documentation/applemusicapi/get-multiple-catalog-songs-by-isrc)
  - Takes a list of ISRCs. The fetch limit is 25.
  - "Note that one ISRC value may return more than one song."
  - Can be combined with `ids`.
  - Needs only the developer token.
  - Matching must therefore pick one result from several, e.g. by album, explicit rating, or duration.
- **By catalog ID:** `Get a Catalog Song` and `Get Multiple Catalog Songs by ID` (`?ids=`). Source: [Songs](https://developer.apple.com/documentation/applemusicapi/songs-api)
- **IDs differ per storefront:** catalog IDs can differ between storefronts for the same recording. `filter[equivalents]=<id>` finds the best match in another storefront, and `restrict=explicit` substitutes clean versions. Source: [Managing Content Ratings, Alternate Versions, and Equivalencies](https://developer.apple.com/documentation/applemusicapi/managing-content-ratings-alternate-versions-and-equivalencies)
- **A user's storefront:** `GET /v1/me/storefront` (needs a Music User Token). Source: [Get a User's Storefront](https://developer.apple.com/documentation/applemusicapi/get-a-user's-storefront). The old adapter hardcoded `us`. A track matched in `us` may need `filter[equivalents]` before it is written to a non-US player's library.
- **Library IDs:** library IDs are separate from catalog IDs. "If a user removes an item from their music library but then adds it back later, it will have a new and different identifier." Source: [Handling Requests and Responses](https://developer.apple.com/documentation/applemusicapi/handling-requests-and-responses)
- **No ISRC from other services:** none of the other services has an ISRC to send. YouTube Music and Bandcamp don't expose one in this codebase, so cross-service matching from those directions is search by title and artist, checked against `durationInMillis`. ISRC only helps for Apple → Apple re-lookups.

## 4. Creating and appending to a library playlist (Music User Token)

- **Create:** `POST /v1/me/library/playlists` → `201 LibraryPlaylistsResponse`, or `401` / `403` / `500`. Source: [Create a New Library Playlist](https://developer.apple.com/documentation/applemusicapi/create-a-new-library-playlist)
  - Requires a Music User Token.
  - "There may be a delay before a new resource appears in a user's library."
  - Body attributes: `name` (required) and `description`, and nothing else. Source: [LibraryPlaylistCreationRequest.Attributes](https://developer.apple.com/documentation/applemusicapi/libraryplaylistcreationrequest/attributes-data.dictionary)
  - Optional relationships: `tracks` (seed tracks) and `parent` (a playlist folder). Source: [LibraryPlaylistCreationRequest.Relationships](https://developer.apple.com/documentation/applemusicapi/libraryplaylistcreationrequest/relationships-data.dictionary)
- **Append:** `POST /v1/me/library/playlists/{id}/tracks` adds to the end of the playlist and returns `204`. Source: [Add Tracks to a Library Playlist](https://developer.apple.com/documentation/applemusicapi/add-tracks-to-a-library-playlist)
  - Body: `data: [{ id, type }]`, where `type` is one of `songs`, `music-videos`, `library-songs`, or `library-music-videos`. Catalog song IDs can be added directly. Source: [LibraryPlaylistTracksRequest.Data](https://developer.apple.com/documentation/applemusicapi/libraryplaylisttracksrequest/data-data.dictionary)
- **No other playlist edits:** the "Creating and Modifying User Playlists" topic lists only Create, Add Tracks, and Add a Resource to a Library. There is no rename, reorder, track removal, or playlist deletion. Source: [Playlists](https://developer.apple.com/documentation/applemusicapi/playlists-api). This is unchanged since September. **Mixtape Party can never delete or rewrite a playlist it created.** The demo-reseed pattern (`7baac69`, deleting old YTM playlists) has no Apple equivalent.
- **Reading back:** `Get a Library Playlist` returns `canEdit`, `hasCatalog`, and `isPublic`. Its `tracks` relationship is limited to 100 per page. Source: [LibraryPlaylists.Attributes](https://developer.apple.com/documentation/applemusicapi/libraryplaylists/attributes-data.dictionary), [LibraryPlaylists.Relationships](https://developer.apple.com/documentation/applemusicapi/libraryplaylists/relationships-data.dictionary). This lets the app check that a stored playlist ID still exists before appending. A `404` means the user deleted it.
- **Sharing / public:**
  - **There is no documented way to make a playlist public or shareable.** `isPublic` is read-only, there is no update endpoint, and the creation request has no `isPublic` field. Sources: same pages as above.
  - A library playlist has a `catalog` relationship to "the corresponding playlist in the Apple Music catalog". That exists only after the user publishes the playlist themselves in the Music app. Source: [LibraryPlaylists.Relationships](https://developer.apple.com/documentation/applemusicapi/libraryplaylists/relationships-data.dictionary).
  - So the app cannot produce a shareable Apple Music link the way it does for YTM. Each Apple Music player gets their own private copy.
- Also available: `POST /v1/me/library?ids[songs]=…` adds catalog items to the library and returns `202`. IDs that can't be added are silently ignored. Source: [Add a Resource to a Library](https://developer.apple.com/documentation/applemusicapi/add-a-resource-to-a-library)

## 5. Music User Token lifetime and expiry

- **Apple's API docs give no lifetime, expiry claim, or refresh flow** for the Music User Token. They say only that it is required for subscriber-specific data. They also say it is managed automatically by MusicKit (Swift) and MusicKit JS, and manually on Android, sent as the `Music-User-Token` header. Source: [User Authentication for MusicKit](https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit)
- **Forums, Apple staff (Aug 2020):** "The expiration is 6 months currently". Source: [Developer Forums thread 654814](https://developer.apple.com/forums/thread/654814). This is not a documented guarantee.
- **Forums, developers:**
  - Developers storing the token on a backend report much shorter lifetimes in practice: `403` responses starting **1–2 days** after the token was created (Feb 2023, still being reported in Dec 2024). Source: [thread 724576](https://developer.apple.com/forums/thread/724576).
  - An Apple DTS Engineer replied in that thread that the user token "is created by the device … on behalf of the current user… You don't really care when it expires, because the device is also responsible for creating a new user token when the current one is no longer valid". They suggested getting a fresh token on each app launch. Apple has not answered the backend-storage case. Source: [thread 724576](https://developer.apple.com/forums/thread/724576).
  - The token "is not a regular jwt token", so its expiry can't be read from it. Source: [thread 744156](https://developer.apple.com/forums/thread/744156).
  - There is no refresh-token mechanism. A new token must come from the user's device or browser re-authorizing. Source: [thread 777549](https://developer.apple.com/forums/thread/777549) (developer post, 2025).
- **Observed behaviour:** an expired or revoked user token shows up as `403` ("issue with the media user token"). Source: [Handling Requests and Responses](https://developer.apple.com/documentation/applemusicapi/handling-requests-and-responses). The removed adapter (`6d007b2^:api/src/adapters/appleMusicAdapter.ts`) already treated `401`/`403` on library writes as "the account's problem". `401` is really the developer token.
- **Practical rule:** don't trust a stored token's age. Treat any `403` from a `/me` call as "relink needed". The token can only be refreshed when the player next opens the app (MusicKit JS / native) and re-authorizes, never from the server or the sweep.

## 6. Which operations need an active subscription

| Operation | Tokens | Subscription? | Source |
| --- | --- | --- | --- |
| Catalog search, song by ID or ISRC, equivalents | developer only | No | [Search](https://developer.apple.com/documentation/applemusicapi/search-for-catalog-resources-(by-type)), [ISRC](https://developer.apple.com/documentation/applemusicapi/get-multiple-catalog-songs-by-isrc) |
| 30-second previews (`previews[].url`) | none to stream the URL | No: "Previews … may be available with or without an Apple Music subscription" | [Songs.Attributes](https://developer.apple.com/documentation/applemusicapi/songs/attributes-data.dictionary) |
| Full playback (MusicKit JS / native) | developer + user | **Yes.** `playParams` signals the song is "available to play with an Apple Music subscription", and native gates this on `canPlayCatalogContent` | [Songs.Attributes](https://developer.apple.com/documentation/applemusicapi/songs/attributes-data.dictionary), [MusicSubscription](https://developer.apple.com/documentation/musickit/musicsubscription) |
| Create playlist, add tracks, add to library | developer + user | **Effectively yes.** Writes need the user's iCloud Music Library: `hasCloudLibraryEnabled` is "a capability that allows your app to perform modifications to the user's iCloud Music Library". The user token is described as being for "an Apple Music subscriber". Apple does not state what a non-subscriber gets back. Expect `403`. | [hasCloudLibraryEnabled](https://developer.apple.com/documentation/musickit/musicsubscription/hascloudlibraryenabled), [User Authentication](https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit) |
| `GET /v1/me/storefront` | developer + user | Needs a user token. Subscription not stated. | [Get a User's Storefront](https://developer.apple.com/documentation/applemusicapi/get-a-user's-storefront) |

The web gives no first-class subscription check. The native `MusicSubscription` (`canPlayCatalogContent`, `hasCloudLibraryEnabled`, `canBecomeSubscriber`) is Swift-only ([MusicSubscription](https://developer.apple.com/documentation/musickit/musicsubscription)). On the web, the first failed write is the signal. This is unchanged since September.

## 7. Rate limits

Unchanged. Requests are limited per developer token within an unpublished window. Going over the limit returns `429 Too Many Requests`, which "resolves itself shortly after the request rate has reduced". No numbers and no rate-limit header are published. Source: [Generating Developer Tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens) ("Request Rate Limiting"). One developer token is shared across all players' catalog searches, so a busy submit box can hit the limit. Back off on `429`, and consider caching search results.

## 8. Terms that bear on combining several music services

**ADPLA §3.3.6.D MusicKit.** The wording is the same as in September. Source: [Apple Developer Program License Agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)

- MusicKit may be used only "for purposes … related to facilitating access to Your end users' Apple Music subscriptions". You "must follow the Apple Music Identity Guidelines". You may not "require payment for or indirectly monetize access to the Apple Music service".
- If you offer playback, "full songs must be enabled for playback". Users must initiate playback and have play/pause/skip controls.
- "MusicKit Content cannot be synchronized with any other content." MusicKit content may not be downloaded, uploaded, or modified.
- "album art and music-related text from the MusicKit API may not be used separately from music playback or managing playlists".
- "Metadata from users (such as playlists and favorites) may be used only to provide a service or function that is clearly disclosed to end users and that is directly relevant to the use of Your Application".
- MusicKit JS must be used "only as a stand-alone library", not recombined or re-hosted.
- §2 boilerplate: "You agree not to create or attempt to create a substitute or similar service". This is not MusicKit-specific.

**App Review Guidelines.** These are new to this research. Source: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

- **4.5.2(i):** with the user's permission an app "can create playlists, add songs to their library". It repeats the playback and no-monetization rules. "Do not download, upload, or enable sharing of music files sourced from the MusicKit APIs".
- **4.5.2(ii):** "Cover art and other metadata may only be used in connection with music playback or playlists". Playing "a specific song at a particular moment" may need separate rights.
- **4.5.2(iii):** apps that access user playlists or favorites must disclose that in the purpose string. The data may not be shared with third parties except to support the app.
- **5.2.5:** "Music from iTunes and Apple Music previews may not be used for their entertainment value (such as as the background music to a photo collage or the soundtrack to a game)". "If you provide music previews from iTunes or Apple Music, you must display a link to the corresponding music in iTunes or Apple Music."
- **4.10:** you may not monetize "Apple Music access".

**Nothing requires exclusivity.** No clause forbids an app that also integrates YouTube Music or Bandcamp, and the September doc reached the same conclusion. The constraints are about how Apple content is used:

- Don't mix Apple audio into a cross-service stream.
- Use Apple artwork and metadata only alongside playback or playlist management.
- Link previews back to Apple Music.

**Grey areas for Mixtape Party.** These are a reading of the terms, not Apple statements:

- **Catalog search for a YTM listener.** Searching the Apple catalog when the player isn't an Apple Music user is metadata use. It arguably isn't "facilitating access to … Apple Music subscriptions". Showing Apple artwork in a merged submit-box list next to YTM results arguably falls under "managing playlists", since the pick feeds the round playlist. It is safest if every Apple-sourced row links to Apple Music.
- **Previews as a guessing game.** Using Apple previews as the game's guess-screen audio is close to the 5.2.5 example ("the soundtrack to a game"). Full-song MusicKit playback that the user starts, with standard controls, fits better than previews.

## Implications for the map

**For #207 (per-player playlist lifecycle):**

- **Build on demand or at results open, from the client, not from the sweep.** A server-side build works only while the stored user token is still valid. Apple staff said about 6 months in 2020, but backend-stored tokens are reported returning `403` after 1–2 days, and there is no refresh. Apple's guidance is to get a fresh token from the device each launch. A sweep-time build will hit stale tokens and can't fix them. Building when the player opens results lets the client re-authorize first.
- **Store the playlist ID per player per round, and treat the playlist as append-only.** It can't be renamed, reordered, trimmed, or deleted by API (§4). Re-running the build must append only missing tracks, using `GET` on the playlist to diff. A `404` on that `GET` means the user deleted it; create a new one.
- **Build only for players whose listen-on preference is Apple Music.** Writes need a user token and, in practice, a subscription (§6). Linked players who listen on YTM gain nothing from it.
- **Map `403` on a write to a "relink needed" status** in the #73 ServiceExport statuses, `429`/`5xx` to retryable, and "no catalog match" to the unmatched list. An unlinked account or expired token is not a failure of the round.
- **There is no shared Apple link.** Unlike the single YTM playlist in `round_exports`, each Apple row belongs to one player and is private. Model it as per-player rows, not one round-level link.
- **Resolve the player's storefront** (`GET /v1/me/storefront`) and use `filter[equivalents]` when it isn't `us`. Otherwise writes may silently add the wrong or unavailable version (§3).

**Token, subscription and terms limits that matter elsewhere on the map:**

- **The developer token lasts at most 6 months.** Mint it server-side from the `.p8` and rotate it automatically. The old adapter did this, caching with a 5-minute margin. For MusicKit JS on the web, set the `origin` claim.
- **Catalog search needs no user or subscription,** so the merged submit box can search Apple for everyone. Budget for an unpublished per-token rate limit (`429`) and cache results.
- **ISRC is optional and only exists on the Apple side.** Cross-service matching is title + artist + duration, and one ISRC can map to several songs.
- **Previews (deferred item on #200):** 5.2.5 forbids previews as "the soundtrack to a game" and requires a link to Apple Music. Raise this before reusing the #102 preview pattern for Apple.
- **Anonymity:** showing an Apple match for a YTM-submitted track is fine, but the Apple artwork and text must stay tied to playback or playlist actions (ADPLA §3.3.6.D, 4.5.2(ii)).
- **Privacy and App Store labels:** reading or writing user playlists must be disclosed in the purpose string (`NSAppleMusicUsageDescription`). That data can't be shared with third parties (4.5.2(iii)).
