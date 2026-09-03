# Research: Apple MusicKit capabilities (JS + native)

Resolves: [#3 Research: Apple MusicKit capabilities (JS + native)](https://github.com/jamiwardlow/mixtape-party/issues/3)
Parent: [#1 Mixtape Party: game & platform spec](https://github.com/jamiwardlow/mixtape-party/issues/1)

Sources are Apple's official developer documentation (`developer.apple.com`) and Apple's official legal agreements (`developer.apple.com/support/terms/...`, `apple.com/legal/...`). Every claim below is followed by its source URL. Where the public DocC page renders client-side and couldn't be inspected via the normal page, the underlying documentation JSON/Markdown data endpoint Apple serves the same content from (`developer.apple.com/tutorials/data/documentation/...`) was fetched instead — content is identical, just the raw source Apple's own site hydrates from.

## 1. Track search (Apple Music API)

The Apple Music API's `Search` endpoint searches either the Apple Music Catalog or the signed-in user's personal library.

- **Catalog search** — `GET https://api.music.apple.com/v1/catalog/{storefront}/search`
  - Query params: `term` (required, spaces as `+`), `types` (comma list restricting results to specific resource types — `activities, albums, apple-curators, artists, curators, music-videos, playlists, record-labels, songs, stations`), `limit` (default **5**, **max 25**), `offset` (pagination), `l` (localization language tag).
  - Returns 200 with a `SearchResponse` (a map keyed by resource type); 401 for a bad `Authorization` header; 500 on server error.
  - Source: [Search for Catalog Resources](https://developer.apple.com/documentation/applemusicapi/search-for-catalog-resources), [Search overview](https://developer.apple.com/documentation/applemusicapi/search)
- **Library search** — a separate `Search for Library Resources` endpoint searches only the authenticated user's iCloud Music Library (requires a Music User Token). Source: [Search overview](https://developer.apple.com/documentation/applemusicapi/search) (topic "Searching for Library Resources").
- There are also **catalog search hints/suggestions** endpoints (`Get Catalog Search Hints`, `Get Catalog Search Suggestions`) for autocomplete-style term suggestions. Source: same overview page.
- Note the low default/max page size (5 / 25 per type) — for a mixtape-building UI you'll want to paginate via `offset` or raise `limit` up to 25 per call.

## 2. Creating / editing playlists (Apple Music API)

Playlist mutation lives entirely under `/v1/me/library/playlists` and requires **both** a developer token and a user-specific **Music User Token** (see §4).

- **Create** — `POST https://api.music.apple.com/v1/me/library/playlists`. Body is a `LibraryPlaylistCreationRequest`: `attributes.name` (required), `attributes.description` (optional), `attributes.isPublic` (optional), plus optional `relationships.tracks` (seed tracks at creation) and `relationships.parent` (nest inside a library playlist folder). Returns 201 with the new `LibraryPlaylistsResponse`.
  Source: [Create a New Library Playlist](https://developer.apple.com/documentation/applemusicapi/create-a-new-library-playlist)
- **Add tracks** — `POST https://api.music.apple.com/v1/me/library/playlists/{id}/tracks`. Appends tracks **to the end only**; returns 204 No Content on success.
  Source: [Add Tracks to a Library Playlist](https://developer.apple.com/documentation/applemusicapi/add-tracks-to-a-library-playlist)
- **Playlist folders** — you can also create library playlist folders (`Create a New Library Playlist Folder`) to organize playlists.
  Source: [Playlists overview](https://developer.apple.com/documentation/applemusicapi/playlists-api)
- **Reading** — `Get a Library Playlist`, `Get All Library Playlists`, `Get Multiple Library Playlists`, and relationship/track fetches all exist for read access.
  Source: [Playlists overview](https://developer.apple.com/documentation/applemusicapi/playlists-api)

**Gap worth flagging for the spec:** the documented Playlists API topic list has no endpoint for renaming/editing a playlist's name or description after creation, no reordering of tracks, and no removing a track from a playlist. The only documented mutations are *create* and *append tracks*. (Confirmed by enumerating every endpoint under [Playlists overview](https://developer.apple.com/documentation/applemusicapi/playlists-api) — "Creating and Modifying User Playlists" lists exactly two endpoints: Create, and Add Tracks.) If Mixtape Party needs users to reorder or trim an Apple Music playlist after the fact, that isn't supported by the public API today.

## 3. In-app playback

### MusicKit JS (web)

- MusicKit on the Web lets a website "stream songs, music videos, and radio directly in the browser," either via pre-built **MusicKit Web Components** or a custom player built against the `MusicKit` JS instance API (configure → authorize → queue → play/pause/skip). Source: [MusicKit overview](https://developer.apple.com/musickit/)
- Configuration: `MusicKit.configure({ developerToken, app: { name, build } })`, then `MusicKit.getInstance()` to get the player/queue/API surface. Source: [MusicKit overview](https://developer.apple.com/musickit/); reference site: [MusicKit JS docs](https://js-cdn.music.apple.com/musickit/v3/docs/index.html) (note: this is Apple's canonical MusicKit JS reference, but it is a client-rendered app hosted on `js-cdn.music.apple.com`, not the DocC site — Apple's own developer portal links out to it, e.g. from [`developer.apple.com/musickit/web/`](https://developer.apple.com/musickit/web/)).
- MusicKit JS **automatically manages the Music User Token** for web apps — it decorates Apple Music API requests for you once the user authorizes. Source: [User Authentication for MusicKit](https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit)

### MusicKit (native, Swift — iOS/iPadOS/macOS/tvOS/watchOS/visionOS)

- Native playback is provided by two player classes in the `MusicKit` Swift framework:
  - **`ApplicationMusicPlayer`** — plays music inside your app "in a way that doesn't affect the Music app's state," has its own isolated queue, and (with a background-audio `Info.plist` mode) keeps playing when your app is backgrounded. Available iOS/iPadOS/Mac Catalyst 15.0+, macOS 14.0+, tvOS 15.0+, visionOS 1.0+.
    Source: [ApplicationMusicPlayer](https://developer.apple.com/documentation/musickit/applicationmusicplayer)
  - **`SystemMusicPlayer`** — controls the system Music app's own playback state instead of an app-private queue.
    Source: [MusicKit framework overview](https://developer.apple.com/documentation/musickit) (Playback topic group)
  - Both conform to the shared `MusicPlayer` base type; `PlayableMusicItem` / `PlayParameters` describe what can be queued.
- MusicKit (Swift) also **automatically manages the Music User Token** for Apple platforms, decorating Apple Music API requests once the user grants permission via `MusicAuthorization`.
  Source: [User Authentication for MusicKit](https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit), [MusicKit framework overview](https://developer.apple.com/documentation/musickit)
- Apps must add `NSAppleMusicUsageDescription` to `Info.plist` or the system terminates the app when it touches music data.
  Source: [MusicKit framework overview](https://developer.apple.com/documentation/musickit)

## 4. Developer token / auth model

Two distinct tokens are involved, and yes — Apple Developer Program membership plus a MusicKit private key are both required.

- **Developer token** (server/app identity, not user-specific):
  - Requires **membership in the Apple Developer Program**.
  - Requires creating a **Media (MusicKit) identifier and a private key (.p8 file)** in Certificates, Identifiers & Profiles — this key signs your tokens. Source: [Create a media identifier and private key](https://developer.apple.com/help/account/capabilities/create-a-media-identifier-and-private-key/), [Generating Developer Tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)
  - The token is a JWT: header `alg: ES256` + `kid` (your 10-character Key ID); payload `iss` (your 10-character Team ID), `iat`, and `exp` — **`exp` must not exceed 15,777,000 seconds (~6 months) from issuance**; an optional `origin` array can restrict which web origins may use the token. Apple rejects any token not signed with ES256. Sent as `Authorization: Bearer <token>` on every Apple Music API request.
    Source: [Generating Developer Tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)
  - Xcode can also generate/manage this token automatically for native apps that enable the MusicKit App Service capability. Source: [Using Automatic Developer Token Generation for Apple Music API](https://developer.apple.com/documentation/musickit/using-automatic-token-generation-for-apple-music-api)
- **Music User Token** (per end-user, required for any request touching a specific user's data/library, e.g. creating playlists):
  - On Apple platforms and on the web, **MusicKit manages this automatically** once the user authorizes your app/site — you never see the raw token unless you want it.
  - On **Android**, there is no automatic management; you must retrieve the token yourself via MusicKit for Android and attach it as a `Music-User-Token` header alongside the developer token's `Authorization: Bearer` header.
    Source: [User Authentication for MusicKit](https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit)

## 5. Is an active Apple Music subscription required for playback?

Yes, in effect — MusicKit exposes explicit subscription-gating that developers must check before allowing catalog playback.

- The native `MusicSubscription` struct has instance properties `canPlayCatalogContent`, `hasCloudLibraryEnabled`, and `canBecomeSubscriber`, obtained via the type property `MusicSubscription.current` (and observed via `subscriptionUpdates`). Apps are expected to gate playback/library UI on `canPlayCatalogContent`.
  Source: [MusicSubscription](https://developer.apple.com/documentation/musickit/musicsubscription)
- The MusicKit framework overview explicitly frames this as: "Check specific capabilities for the current `MusicSubscription` to ensure your music-related functionality is available to the user," and separately supports "presenting a music subscription offer" (`MusicSubscriptionOffer`) so an app can prompt a non-subscriber to start a free trial in-app.
  Source: [MusicKit framework overview](https://developer.apple.com/documentation/musickit)
- The marketing overview page similarly lists "Check for active Apple Music subscriptions" and "Offer trial memberships directly in-app" as core native MusicKit capabilities — implying playback is unavailable/blocked without a subscription (or trial) in place.
  Source: [MusicKit overview](https://developer.apple.com/musickit/)

Net effect for Mixtape Party: an end user must have (or start a trial for) an Apple Music subscription to actually hear full-length playback through MusicKit; catalog **search/metadata** access does not require the listener to be subscribed, only the developer token.

## 6. Rate limits

Apple's public documentation intentionally does not publish exact numeric thresholds:

> "Apple Music API limits the number of requests your app can make using a developer token within a specific period of time. If this limit is exceeded, you'll temporarily receive `429 Too Many Requests` error responses for requests that use the token. This error resolves itself shortly after the request rate has reduced."

Source: [Generating Developer Tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens) ("Request Rate Limiting" section)

No specific requests-per-hour/day number, and no documented rate-limit response header, appears in the official docs (unlike, e.g., the App Store Connect API's [Identifying Rate Limits](https://developer.apple.com/documentation/appstoreconnectapi/identifying-rate-limits) page, which does document an `X-Rate-Limit` header — Apple Music API has no equivalent documented header). Practical implication: build retry/backoff on 429 rather than trying to pace against a fixed budget.

## 7. Apple Media Services Terms / license restrictions relevant to a multi-service (Spotify + YouTube + Apple Music) app

The consumer-facing **Apple Media Services Terms and Conditions** ([apple.com/legal/internet-services/itunes/us/terms.html](https://www.apple.com/legal/internet-services/itunes/us/terms.html)) governs end-user purchases/subscriptions and contains no MusicKit/API-specific language — it's the wrong document for this question (verified by full-text search of the page: no mentions of "MusicKit," "developer token," or "Apple Music API").

The relevant restrictions are in the **Apple Developer Program License Agreement** (ADPLA), Section 3.3.6.D "MusicKit" ([developer.apple.com/support/terms/apple-developer-program-license-agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)). Quoting the operative clause directly:

> "You agree not to call the MusicKit APIs or use MusicKit JS ... for purposes unrelated to facilitating access to Your end users' Apple Music subscriptions ... You agree not to require payment for or indirectly monetize access to the Apple Music service (e.g. in-app purchase, advertising, requesting user info) through Your use of the MusicKit APIs, MusicKit JS, or otherwise in any way. In addition: If You choose to offer music playback through the MusicKit APIs or MusicKit JS, full songs must be enabled for playback, and users must initiate playback and be able to navigate playback using standard media controls such as 'play,' 'pause,' and 'skip' ... **You may not, and You may not permit Your end users to, download, upload, or modify any MusicKit Content and MusicKit Content cannot be synchronized with any other content**, unless otherwise permitted by Apple in the Documentation; You may play MusicKit Content only as rendered by the MusicKit APIs or MusicKit JS and only as permitted in the Documentation (e.g., album art and music-related text from the MusicKit API may not be used separately from music playback or managing playlists); **Metadata from users (such as playlists and favorites) may be used only to provide a service or function that is clearly disclosed to end users and that is directly relevant to the use of Your Application** ... and **You may use MusicKit JS only as a stand-alone library in Your Application, website, or web application and only as permitted in the Documentation (e.g., You agree not to recombine MusicKit JS with any other JavaScript code or separately download and re-host it).**"

Source: [Apple Developer Program License Agreement, §3.3.6.D "MusicKit"](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)

Implications specifically for a multi-service aggregator (Spotify + YouTube + Apple Music in one app):

- **"MusicKit Content cannot be synchronized with any other content"** — this is the sharpest restriction for Mixtape Party's exact use case. A UI pattern that visually or functionally merges/synchronizes Apple Music playback with Spotify or YouTube playback in the same timeline/queue (e.g. a single cross-service crossfade queue) risks violating this clause. Rendering Apple Music tracks in their own clearly separate player/section alongside — but not synchronized/merged with — other services is the safer reading.
- **Full-song playback with standard, honestly-labeled transport controls (play/pause/skip)** must be preserved wherever MusicKit playback is offered — no truncated "preview-only" dressed up as full playback, and controls can't be relabeled/misrepresented.
- **No monetizing access to Apple Music itself** (no charging for or gating Apple Music playback behind payment, ads, or "give us your info" walls) — a paid Mixtape Party tier could still charge for the app/game, but not specifically for unlocking Apple Music playback.
- **No downloading/caching/re-uploading MusicKit content**, and playlist/favorite metadata pulled via the API can only be used for functionality "directly relevant" to the app, at Apple's sole discretion — so cross-service ML/analytics use of Apple Music library metadata (e.g., feeding it into a recommendation model that also ingests Spotify data) is a gray area Apple explicitly reserves judgment on.
- **MusicKit JS must be used stand-alone, unmodified, and not re-hosted** — it must be loaded from Apple's CDN, not bundled/recombined with your own JS.
- A more general, non-MusicKit-specific clause elsewhere in the same agreement (§2, on "Additional Terms for Apple Services and Content") states: "You agree not to create or attempt to create a substitute or similar service through use of or access to the services provided by or through the Program" — this is a boilerplate clause applied to multiple Apple services (also appears verbatim in the Apple Maps and MDM sections) rather than something MusicKit-specific; it's a broader "don't rebuild the size of Apple Music using our own API against us" guardrail, not a prohibition on merely aggregating alongside competitors.
  Source: same ADPLA page, §2.

Bottom line: nothing in Apple's terms bars an app from *also* integrating Spotify/YouTube — Apple doesn't require exclusivity — but the "no synchronization with other content" and "stand-alone JS" clauses mean Apple Music playback needs to stay a visually/functionally distinct lane inside the app rather than being interleaved or crossfaded with the other services' audio streams.

## 8. Capability gaps: MusicKit JS (web) vs. native MusicKit (Swift)

| Capability | Native MusicKit (Swift) | MusicKit JS (web) |
|---|---|---|
| Catalog search / resource requests | Typed Swift API: `MusicCatalogSearchRequest`, `MusicCatalogResourceRequest` + typed models (`Song`, `Album`, `Artist`, `Playlist`, etc.) | Goes through the `MusicKit` JS instance's REST call wrapper (`instance.api`) against the same Apple Music API — no typed Swift-style model layer |
| Playback | Two dedicated player types — `ApplicationMusicPlayer` (app-private queue, keeps playing in background) and `SystemMusicPlayer` (drives the OS Music app) | A single in-page player/queue (via the JS `MusicKit` instance); no equivalent to "hand off to the OS's own Music app" since there is no OS Music app in a browser context |
| Playlist / library **writes** (create playlist, add tracks) | **No dedicated Swift API** — the native `MusicKit` framework's Topics list has no library-write types (only a read-only `Playlist` model + `PlaylistFilter`); writes require dropping to `MusicDataRequest` to hit the raw Apple Music API endpoints directly (same JSON payloads as any other client) | Same underlying REST endpoints as native — the JS layer likewise has no bespoke playlist-mutation object; it's calling the identical Apple Music API | Effectively **no capability gap here** — both platforms lack a native, ergonomic playlist-write SDK and both fall back to raw Apple Music API calls |
| Music User Token handling | Fully automatic once `MusicAuthorization` is granted | Fully automatic once the user authorizes in-browser | Parity |
| Subscription / trial UX | `MusicSubscription` (`canPlayCatalogContent`, `hasCloudLibraryEnabled`, `canBecomeSubscriber`) + `MusicSubscriptionOffer` for in-app trial sign-up sheets | Subscription status must be inferred from authorization/playback state in JS; Apple's docs do not describe an equivalent first-class "present a trial offer sheet" API for the web | Native has richer, more explicit subscription-state APIs |
| Background audio | Explicit support via `Info.plist` background-audio mode + `ApplicationMusicPlayer` continuing playback backgrounded | Governed by normal browser tab/media-session lifecycle — playback can be paused/killed by the browser when the tab is backgrounded/closed, no OS-level background-audio guarantee | Native advantage |
| Distribution requirement | Apple Developer Program membership + registering an App ID with the "MusicKit" App Service enabled in Certificates, Identifiers & Profiles (Xcode auto-wires it from there) | Only a MusicKit developer token (from the same Program membership) is needed — no App ID/App Service registration step, since there's no native app bundle | Setup is lighter-weight for web-only integration |
| Platform reach | iOS, iPadOS, macOS, tvOS, watchOS, visionOS, Mac Catalyst | Any modern browser | MusicKit JS is the only path to non-Apple platforms Apple itself ships (Android is a separate SDK — see below) |

Sources: [MusicKit framework overview](https://developer.apple.com/documentation/musickit) (native topic list, incl. absence of library-write types), [ApplicationMusicPlayer](https://developer.apple.com/documentation/musickit/applicationmusicplayer), [MusicSubscription](https://developer.apple.com/documentation/musickit/musicsubscription), [MusicKit overview](https://developer.apple.com/musickit/) (web vs. native vs. Android capability lists), [Integrating MusicKit into your app](https://developer.apple.com/documentation/musickit/integrating-musickit-into-your-app) (App ID / MusicKit App Service registration steps), [User Authentication for MusicKit](https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit) (automatic token management parity/gap vs. Android).

One more relevant data point: Apple also ships a **MusicKit SDK for Android** (an authentication library + a media-playback library), which is the third leg beyond web/native — mentioned here because it's the one platform where Music User Token management is *not* automatic and must be implemented by hand. Source: [MusicKit overview](https://developer.apple.com/musickit/).

## Primary sources referenced

- [Apple Music API overview](https://developer.apple.com/documentation/applemusicapi)
- [Search overview](https://developer.apple.com/documentation/applemusicapi/search) / [Search for Catalog Resources](https://developer.apple.com/documentation/applemusicapi/search-for-catalog-resources)
- [Playlists overview](https://developer.apple.com/documentation/applemusicapi/playlists-api) / [Create a New Library Playlist](https://developer.apple.com/documentation/applemusicapi/create-a-new-library-playlist) / [Add Tracks to a Library Playlist](https://developer.apple.com/documentation/applemusicapi/add-tracks-to-a-library-playlist)
- [Generating Developer Tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)
- [User Authentication for MusicKit](https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit)
- [MusicKit framework (native/Swift) overview](https://developer.apple.com/documentation/musickit)
- [ApplicationMusicPlayer](https://developer.apple.com/documentation/musickit/applicationmusicplayer)
- [MusicSubscription](https://developer.apple.com/documentation/musickit/musicsubscription)
- [Integrating MusicKit into your app](https://developer.apple.com/documentation/musickit/integrating-musickit-into-your-app)
- [Using Automatic Developer Token Generation for Apple Music API](https://developer.apple.com/documentation/musickit/using-automatic-token-generation-for-apple-music-api)
- [MusicKit overview / marketing page](https://developer.apple.com/musickit/) and [MusicKit on the Web](https://developer.apple.com/musickit/web/)
- [MusicKit JS reference docs](https://js-cdn.music.apple.com/musickit/v3/docs/index.html)
- [Create a media identifier and private key](https://developer.apple.com/help/account/capabilities/create-a-media-identifier-and-private-key/)
- [Apple Developer Program License Agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/) (§2 general Services restrictions, §3.3.6.D MusicKit)
- [Apple Media Services Terms and Conditions](https://www.apple.com/legal/internet-services/itunes/us/terms.html) (checked, found not applicable to API/developer terms)
