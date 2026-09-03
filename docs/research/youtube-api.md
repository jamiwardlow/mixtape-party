# Research: YouTube Music / YouTube Data API capabilities

Resolves: https://github.com/jamiwardlow/mixtape-party/issues/4 (child of #1)

Sources are Google's official developer documentation only:
`developers.google.com/youtube/*`. No blog posts or secondary write-ups were
used as primary evidence; a couple of Google Support community threads are
cited only as corroboration for point 7, not as the basis of any claim.

## 1. Track/video search

`search.list` is the only search endpoint. It searches all of YouTube (videos,
channels, playlists), not a music-specific catalog.

- `part=snippet` is required.
- `q` takes a free-text query, with `-` (NOT) and `|` (OR) boolean operators.
- `type` restricts results to `video`, `channel`, `playlist` (default: all three) — for track search, always pass `type=video`.
- Filters relevant to a music app: `videoCategoryId` (Music is category id `10`, per the Video Categories reference), `order` (`relevance`, `date`, `rating`, `title`, `videoCount`, `viewCount`), `videoDuration`, `videoEmbeddable`, `regionCode`, `safeSearch`.
- `maxResults`: 0–50 per page (default 5), paged via `pageToken`.
- Source: https://developers.google.com/youtube/v3/docs/search/list

There is no way to search YouTube Music's curated catalog (official audio
tracks, albums, artist pages) through this or any other public endpoint — see
point 7.

## 2. Creating/editing playlists

Two resources are involved:

- `playlists.insert` — creates a playlist. Requires `part` and a `snippet.title` at minimum; optional `description`, `status.privacyStatus`, `defaultLanguage`, localizations. Fails if the channel already has the maximum number of playlists allowed.
  Source: https://developers.google.com/youtube/v3/docs/playlists/insert
- `playlistItems.insert` — adds a video to a playlist. Requires `snippet.playlistId` and `snippet.resourceId` (must be a `youtube#video` resource). Optional `position` (requires "manual sorting" enabled on the playlist), start/end times, and a note field (≤280 chars). Some playlists (e.g. the channel's uploads playlist) don't accept inserts, and playlists have a maximum item capacity.
  Source: https://developers.google.com/youtube/v3/docs/playlistItems/insert
- Full CRUD also exists: `playlists.update`/`delete`, `playlistItems.update`/`delete`, `playlistItems.list`, `playlists.list`.

Both write operations require OAuth 2.0 user authorization (an API key alone
is not sufficient) — see point 5.

## 3. In-app playback

**Web — IFrame Player API** (official, actively supported):
- Embed by replacing a `<div>` with an `<iframe>` via the JS API (load `https://www.youtube.com/iframe_api`, implement `onYouTubeIframeAPIReady`, construct `new YT.Player(...)`), or hand-write an `<iframe>` with `enablejsapi=1` in the src.
- Requires HTML5 `postMessage` support, an `origin` param for security, and a minimum player size of 200×200px (480×270 recommended for 16:9).
- Controls: `playVideo/pauseVideo/stopVideo/seekTo`, volume/mute, `nextVideo/previousVideo/playVideoAt/setLoop/setShuffle`, playback rate, 360° spherical properties, state getters (`getPlayerState/getCurrentTime/getDuration/getVideoLoadedFraction`).
- Events: `onReady`, `onStateChange`, `onPlaybackQualityChange`, `onPlaybackRateChange`, `onError`, `onApiChange`, `onAutoplayBlocked`.
- No API key/OAuth is required just to embed and drive the player.
- A video can refuse embedding; this surfaces as player error code `101`/`150` ("the owner of the requested video does not allow it to be played in embedded players").
- Source: https://developers.google.com/youtube/iframe_api_reference

**Mobile:** The dedicated YouTube Android Player API page
(`developers.google.com/youtube/android/player`) 404s — Google has taken it
down. There is no current official native SDK for iOS/Android playback.
Google's supported mobile path is the same IFrame Player API loaded inside a
WebView (this is the pattern documented in Google's own sample apps referenced
from the IFrame Player API docs and is what remains after the native
Android/iOS player SDKs were deprecated). Treat "mobile playback" as "same
IFrame/WebView embed as web," not a distinct native API.

## 4. Quota limits and cost units

Quota is measured in "units," queried at https://developers.google.com/youtube/v3/determine_quota_cost.

Costs for operations relevant to this project (verbatim from the quota-cost table):

| Method | Cost |
|---|---|
| `search.list` | 1 unit/call, but capped at **100 calls/day** as its own dedicated bucket |
| `videos.list` | 1 unit |
| `videos.insert` | 1 unit/call, capped at 100 calls/day (dedicated bucket) |
| `playlists.list` | 1 unit |
| `playlists.insert` / `update` / `delete` | 50 units each |
| `playlistItems.list` | 1 unit |
| `playlistItems.insert` / `update` / `delete` | 50 units each |
| `channels.list` | 1 unit |
| `captions.insert` | 400 units |

Default allocation per Google's own wording: **"Projects that enable the
YouTube Data API have a default quota allocation of 100 `search.list` calls,
100 `videos.insert` calls, and 10,000 units per day combined for all other
endpoints."** (https://developers.google.com/youtube/v3/getting-started)

Implication for Mixtape Party: search is capped at 100 calls/day regardless of
the 10,000-unit general pool — this is a hard, separate ceiling, not just "100
units worth of search." A search-heavy multi-service music app will hit this
fast in dev/testing and needs a quota increase request (via Google's audit
process) before any real usage. Playlist writes (`playlists.insert`,
`playlistItems.insert`) each cost 50 units, so the shared 10,000-unit pool
allows ~200 playlist-item inserts/day at most, shared with every other
non-search/non-insert call the app makes.

Sources: https://developers.google.com/youtube/v3/determine_quota_cost,
https://developers.google.com/youtube/v3/getting-started

## 5. Auth model

- **API key only** is sufficient for read-only, non-personal calls: `search.list`, `videos.list`, `playlists.list`, `playlistItems.list`, `channels.list`, etc. — anything that doesn't touch a specific user's account.
- **OAuth 2.0 user authorization** is required for anything that reads/writes a signed-in user's data: creating/editing playlists (`playlists.insert/update/delete`, `playlistItems.insert/update/delete`), rating videos, subscriptions, comments as the user, etc.
- Relevant scopes (from the OAuth guide):
  - `https://www.googleapis.com/auth/youtube` — manage the account (needed for playlist create/edit)
  - `https://www.googleapis.com/auth/youtube.readonly` — read-only account access
  - `https://www.googleapis.com/auth/youtube.force-ssl` — also accepted for playlist writes, plus needed for comments/ratings/captions
  - `https://www.googleapis.com/auth/youtubepartner`, `youtubepartner-channel-audit` — content-owner/partner operations only, not relevant here
  - `youtube.upload`, `youtube.channel-memberships.creator` — not relevant to this app
- `playlists.insert` and `playlistItems.insert` explicitly accept any of `youtube`, `youtube.force-ssl`, or `youtubepartner` — `youtube` or `youtube.force-ssl` is what a consumer app should request.
- Installed/mobile apps must use PKCE; DPoP is optional but recommended.

Sources: https://developers.google.com/youtube/v3/guides/auth/installed-apps,
https://developers.google.com/youtube/v3/docs/playlists/insert,
https://developers.google.com/youtube/v3/docs/playlistItems/insert

## 6. YouTube API Services Terms of Service — restrictions relevant to a multi-service (Spotify + Apple Music + YouTube) app

From the ToS (https://developers.google.com/youtube/terms/api-services-terms-of-service)
and the Developer Policies (https://developers.google.com/youtube/terms/developer-policies),
which is incorporated by reference into the ToS:

- **No downloading/re-hosting audio or video.** "No rights or licenses are granted to reproduce or distribute audiovisual content or make audiovisual content available in any manner other than through the use of the YouTube API Services." This rules out caching/downloading YouTube audio to build a unified offline-playable library across services the way Mixtape Party might want to for Spotify/Apple Music.
- **No stripping audio from video (Developer Policies III.I.7–8).** Must not "separate, isolate, or modify the audio or video components of any YouTube audiovisual content" nor "promote separately the audio or video components." This forecloses an audio-only YouTube playback mode — the video player must stay visibly a video player, which matters for parity with audio-only Spotify/Apple Music playback in the same UI.
- **Player/UI must not be modified (III.I.6).** Must not "modify, build upon, or block any portion or functionality of a YouTube player." Custom-skinning or hiding parts of the IFrame player to make it look consistent with the other two services' players is restricted.
- **Attribution can't be blended across services (III.F.2.a).** "Clearly identify YouTube as the source of ... search results from YouTube. ... The API Client cannot provide one general set of attribution for all search results" — meaning a unified cross-service search results list must label which results came from YouTube specifically, not lump YouTube results under a generic "results" or "matches" heading shared with Spotify/Apple Music.
- **Branding requirements (III.F.1).** Must display YouTube Brand Features per the Branding Guidelines when showing YouTube-sourced content.
- **Aggregation limits (III.E.2.a).** Aggregation of API Data is restricted to channels under the same content owner — i.e., you can't merge/de-duplicate YouTube metadata across unrelated channels into a synthetic "canonical track" record beyond what's needed for display.
- **Storage/caching duration (III.E.4.b–d).** Most "Non-Authorized Data" (e.g., search results, video metadata) may be cached only up to **30 calendar days**; some "Authorized Data" (per-user analytics) may be retained longer if necessary for the authorized purpose. This directly constrains any local search-result or metadata cache Mixtape Party builds for YouTube — Spotify/Apple Music don't have the same 30-day cap, so cache-expiry logic needs to be YouTube-specific.
- **No independently-calculated substitute metrics without disclosure (III.E.4.h).** Can't quietly replace YouTube's view counts/metrics with your own computed numbers without prominent disclosure — relevant if building a unified "popularity" score across all three services.
- **Quota compliance.** "YouTube may set a quota... at any time," and the developer must not "exceed or circumvent" it — ties directly to point 4.
- **Termination/deletion.** On termination, must "immediately stop accessing and using all YouTube Property and delete all YouTube API Services (including all API Data)" — any stored YouTube metadata must be purged on API access termination, unlike data from services with different terms.
- **No implied partnership.** Can't state or imply "partnership with, or sponsorship or endorsement by, YouTube" without written approval (Section 13/III.), relevant to marketing copy for a multi-service aggregator.
- Google also reserves audit rights: "YouTube may monitor, review and inspect your API Client(s), and monitor and audit your access to and use of the YouTube API Services, at any time and without further notice."

Net effect for Mixtape Party: YouTube can be a source in a cross-service
mixtape/playlist tool, but (a) it must stay a visible, unmodified video
player — no audio-only YouTube tracks sitting next to Spotify/Apple Music
audio-only tracks with a unified skin, (b) YouTube-sourced results/attribution
must be visually distinguished per-item rather than blended into a single
"all sources" list, and (c) any local cache of YouTube metadata needs a
≤30-day TTL distinct from whatever caching policy applies to Spotify/Apple
Music data.

## 7. Does YouTube Music expose anything different via public API?

**Confirmed: no.** There is no official YouTube Music API distinct from the
YouTube Data API v3. The full list of resource types in the official API
reference (https://developers.google.com/youtube/v3/docs) is: Activities,
Captions, ChannelBanners, Channels, ChannelSections, Comments,
CommentThreads, I18nLanguages, I18nRegions, Members, MembershipsLevels,
PlaylistItems, Playlists, Search, Subscriptions, Thumbnails,
VideoAbuseReportReasons, VideoCategories, Videos, Watermarks — nothing for
tracks, albums, artists, or a music-specific catalog/search. The
`getting-started` guide likewise never mentions YouTube Music.

The only official Google surface that touches YouTube Music data at all is
the **Data Portability API**'s YouTube/YouTube Music schema
(https://developers.google.com/data-portability/schema-reference/youtube),
and that is a **user-data export mechanism** (for GDPR/portability-style
"export my library songs, uploaded music media, playlists" requests via
explicit per-user consent), not a search or playback API — it cannot be used
to query or stream the general YouTube Music catalog.

This is also the consistent understanding among YouTube Music's own user
community — support threads explicitly asking "is there a YouTube Music API"
report there isn't one
(https://support.google.com/youtubemusic/thread/80759936/is-there-currently-a-youtube-music-api,
https://support.google.com/youtubemusic/thread/8028415/youtube-music-api).
These are cited only as corroboration; the primary evidence is the absence of
any music resource in the official API reference above.

**Practical consequence for Mixtape Party:** any YouTube-backed "search" or
"add to playlist" feature is really searching/operating on generic YouTube
*video* results (via `search.list` + `type=video`), not YouTube Music's
curated catalog of official audio tracks/albums with proper metadata. Expect:
- Duplicate/near-duplicate results for a track (official audio, lyric video, live version, fan upload, cover) with no reliable way to pick "the" canonical YouTube Music version.
- Inconsistent or missing structured metadata (artist/album) compared to Spotify's/Apple Music's catalog APIs, since YouTube video metadata is uploader-supplied title/description text, not a music-catalog schema.
- No guarantee that what YouTube Music's own app would surface as the "official" track matches what `search.list` ranks first — this is a real product-quality gap versus the Spotify/Apple Music integrations, not just a data-shape difference, and should be flagged to product/design as a known limitation of a YouTube-as-source feature.
