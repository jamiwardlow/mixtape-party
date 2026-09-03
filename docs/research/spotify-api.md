# Research: Spotify Web API + Web Playback SDK capabilities

Resolves: [#2](https://github.com/jamiwardlow/mixtape-party/issues/2) (child of [#1](https://github.com/jamiwardlow/mixtape-party/issues/1))

Sources are Spotify's official developer documentation at `developer.spotify.com`, fetched/verified 2026-09-02. Where a claim comes from secondary reporting (news coverage of a Spotify announcement) because the primary blog post could not be located, that is called out explicitly.

## 1. Track search

- Endpoint: `GET /v1/search`. [Search for Item reference](https://developer.spotify.com/documentation/web-api/reference/search)
- Required params: `q` (query string, supports field filters like `artist:`, `album:`, `track:`, `year:`, `isrc:`, `upc:`, `tag:new`, `tag:hipster`, `genre:`) and `type` (comma-separated list of item types to search).
- Optional params: `market` (ISO 3166-1 alpha-2), `limit` (0-10 per type range as documented, default 5 in this fetch — verify against the live reference table before implementing, as Spotify has changed default/max values before), `offset` (0-1000), `include_external=audio`.
- Searchable types: album, artist, playlist, track, show, episode, audiobook (audiobooks: US/UK/Canada/Ireland/New Zealand/Australia only).
- Auth: the reference page lists auth as simply "OAuth 2.0" with no specific scope named (unlike playlist-write endpoints, which explicitly name scopes on their reference pages). In practice this means Search works with an app-only **Client Credentials** token — no user login/consent screen is required just to search the catalog. [Search reference](https://developer.spotify.com/documentation/web-api/reference/search), [Client Credentials Flow](https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow)
- As of the November 27, 2024 platform changes, Search itself was **not** restricted — it remains available to all apps, including new Development Mode apps (unlike Recommendations/Related Artists/Audio Features, see §6). [Official blog: Introducing some changes to our Web API](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)

## 2. Creating / editing playlists

Reference: [Playlists concept guide](https://developer.spotify.com/documentation/web-api/concepts/playlists), [Create Playlist](https://developer.spotify.com/documentation/web-api/reference/create-playlist)

| Operation | Endpoint | Required scope(s) |
|---|---|---|
| Create playlist | `POST /v1/users/{user_id}/playlists` | `playlist-modify-public` (public playlist) or `playlist-modify-private` (private/collaborative) |
| Get a playlist | `GET /v1/playlists/{playlist_id}` | none for public playlists; `playlist-read-private` / `playlist-read-collaborative` for private/collaborative ones |
| Change playlist details (name, description, public/collaborative) | `PUT /v1/playlists/{playlist_id}` | `playlist-modify-public` or `playlist-modify-private` |
| Add items to a playlist | `POST /v1/playlists/{playlist_id}/tracks` | `playlist-modify-public` or `playlist-modify-private` |
| Update / reorder / replace playlist items | `PUT /v1/playlists/{playlist_id}/tracks` | `playlist-modify-public` or `playlist-modify-private` |
| Remove playlist items | `DELETE /v1/playlists/{playlist_id}/tracks` | `playlist-modify-public` or `playlist-modify-private` |
| Upload a custom playlist cover image | `PUT /v1/playlists/{playlist_id}/images` | `ugc-image-upload` plus `playlist-modify-public`/`playlist-modify-private` |

Create Playlist body params: `name` (required), `public` (bool, default true), `collaborative` (bool, default false — requires `public: false`), `description` (string).

Note the "public"/"private" scopes gate *which playlists your app may write to*, not visibility of the created playlist per se — pick the pair matching the playlist's intended visibility.

## 3. In-app playback

### Web: Web Playback SDK

[Web Playback SDK overview](https://developer.spotify.com/documentation/web-playback-sdk)

- It is a **client-side JavaScript library** that creates a local Spotify Connect device inside the browser tab and streams/controls audio directly — genuinely in-app playback, not a link-out.
- Runs in current Chrome, Firefox, Safari, Edge on desktop OSes; iOS Safari/mobile browser support is explicitly caveated (see limitations below).
- **Requires Spotify Premium** — non-Premium and mobile-only Premium tiers do not work. ("The Web Playback SDK requires a Spotify Premium subscription.")
- Typical scopes used to obtain the token consumed by the SDK: `streaming`, `user-read-email`, `user-read-private` (per Spotify's quick-start sample and the `streaming` scope's own description: "Control playback of a Spotify track. This scope is currently available to Spotify iOS and Android SDKs."). [Scopes reference](https://developer.spotify.com/documentation/web-api/concepts/scopes), [Getting Started tutorial](https://developer.spotify.com/documentation/web-playback-sdk/tutorials/getting-started)
- Documented limitations relevant to us:
  - On iOS, playback does **not** auto-start after transferring playback to the Web Playback SDK device — requires a user-initiated gesture.
  - Cross-origin iframes in Chrome need explicit `encrypted-media`/`autoplay` iframe permissions.
  - Ad-blocker/privacy browser extensions can break SDK loading.
  - **"Commercial use requires prior written approval from Spotify"** — directly relevant since Mixtape Party is a multi-service product.

### Mobile: iOS/Android SDKs

This is the most important nuance for the plan: Spotify's current mobile SDKs are **not** an in-app streaming/playback engine analogous to the Web Playback SDK.

- [Android documentation](https://developer.spotify.com/documentation/android) and [iOS documentation](https://developer.spotify.com/documentation/ios) both describe the **App Remote SDK**, which "interact[s] with the Spotify app running in the background as a service." It **remote-controls the separately-installed native Spotify app** — issuing play/pause/skip commands and receiving now-playing metadata — rather than decoding/streaming audio inside your own app process.
- The official Spotify app **must be installed** on the device for the App Remote SDK to function at all; there is no standalone in-app audio pipeline.
- Spotify's own earlier "Mobile Streaming SDK" (which did stream audio directly, launched 2014) was deprecated; developers were required to migrate off it by September 1, 2022, after which it stopped working. [Spotify blog: An update on the deprecated mobile streaming SDKs](https://developer.spotify.com/blog/2022-07-15-mobile-streaming-sdks-update)
- The Android App Remote SDK docs currently carry a beta disclaimer: "content and functionality [are] likely to change significantly without warning."
- Practical implication for Mixtape Party: true "play the track inside our app" UX on mobile is not available from Spotify today the way it is on web. A mobile integration would either (a) deep-link/launch the Spotify app and remote-control it via App Remote SDK (Spotify app icon/branding stays visible, playback happens in Spotify, not us), or (b) rely on 30-second preview clips via the Web API (see §6 — these were also restricted for new apps as of Nov 2024).

## 4. Auth model / OAuth scopes summary

Spotify Web API auth is OAuth 2.0. [Authorization concept](https://developer.spotify.com/documentation/web-api/concepts/authorization), [Scopes reference](https://developer.spotify.com/documentation/web-api/concepts/scopes)

Supported flows:
- **Authorization Code** — server-side apps that can hold a client secret.
- **Authorization Code with PKCE** — recommended flow for apps without a secure backend (mobile apps, SPAs, desktop apps).
- **Client Credentials** — app-only auth, no user login; can only reach endpoints that don't touch user data (e.g., Search, catalog lookups). Cannot read/write playlists on a user's behalf or use the `streaming` scope.
- **Implicit Grant** — explicitly marked **Deprecated** in current docs; do not use for new work.

Scopes relevant to Mixtape Party's known feature set:
- `playlist-modify-public`, `playlist-modify-private` — create/edit playlists (§2).
- `playlist-read-private`, `playlist-read-collaborative` — read a user's non-public playlists.
- `ugc-image-upload` — upload custom playlist cover art.
- `streaming` — required to use the Web Playback SDK ("Control playback of a Spotify track").
- `user-read-email`, `user-read-private` — commonly bundled with `streaming` for the Web Playback SDK auth flow / to read subscription type (needed to confirm Premium status).
- `user-read-playback-state`, `user-modify-playback-state` — read/control playback state via the regular Web API `/me/player` endpoints (Spotify Connect control, separate from the Web Playback SDK itself).
- Search requires no user scope at all (§1).

## 5. Is Premium required for playback?

- **Web Playback SDK: yes, unconditionally.** Non-Premium accounts and mobile-only Premium plans cannot use it. [Web Playback SDK overview](https://developer.spotify.com/documentation/web-playback-sdk)
- **Mobile App Remote SDK: not clearly stated as Premium-gated in the SDK docs themselves**, but since it only remote-controls the real Spotify app, playback there is subject to whatever the Spotify app / the signed-in account normally allows (i.e., a Free account listening through the Spotify app has Free-tier restrictions — shuffle-only, ads, limited skips — which would carry over into anything Mixtape Party remote-controls).
- The **Developer Policy** is unambiguous platform-wide: **"Streaming only permitted for Premium subscribers. Streaming of music sound recordings through the Spotify Platform shall only be made available to subscribers to the Premium Spotify Service."** Widgets and Audio Preview Clips are the only carve-outs allowed for non-Premium users. [Developer Policy §IV](https://developer.spotify.com/policy)

## 6. Rate limits

[Rate Limits concept](https://developer.spotify.com/documentation/web-api/concepts/rate-limits), [Quota Modes concept](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)

- Enforced per app (per client ID) on a **rolling 30-second window**. Exact numeric call-count thresholds are not published by Spotify — only that they differ by quota mode.
- **Development Mode** (default for new apps): lower rate limit; **as of the February 2026 changes, capped at 5 authenticated test users**, down from the historical 25-user cap, and **the app owner must hold an active Spotify Premium subscription** for the app to keep working — if it lapses, the app stops functioning until reactivated. New Development Mode apps are also limited to **1 client ID per developer** (per the Feb 11, 2026 change; this was subsequently raised to 25 as of July 2026 per the same migration guide). These rules applied to newly-created apps starting Feb 11, 2026 and were extended to all existing Development Mode apps starting Mar 9, 2026. [Quota Modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes), [February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- **Extended Quota Mode**: much higher rate limit, unlimited users, no allowlist. As of the current policy (effective May 15, 2025 per the Developer Policy's effective date), Spotify's stated bar for approval is steep: an established, legally registered business with an active launched product, a stated minimum of ~250,000 monthly active users, availability in key Spotify markets, and general commercial/policy compliance; review can take up to ~6 weeks. **This is a real go/no-go risk for an early-stage project like Mixtape Party** — we'd ship and grow entirely inside the 5-user Development Mode cap unless/until we clear that bar.
- On exceeding the limit: HTTP `429`, with a `Retry-After` header stating how many seconds to back off. Spotify's own guidance: implement backoff using `Retry-After`, batch requests where possible, and lazy-load rather than polling speculatively.
- Separately from rate limits, a wave of **endpoint restrictions** landed Nov 27, 2024: new apps (or apps in Development Mode without a pending extension) lost access to **Recommendations, Related Artists, Audio Features, Audio Analysis, Get Featured Playlists, Get Category's Playlists, 30-second preview URLs in multi-get responses, and algorithmic/Spotify-owned editorial playlists**. Apps that already had Extended Quota access relying on these were grandfathered in. [Official blog](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api) The February 2026 changes narrowed Development Mode further still (batch fetches, browse categories, artist top tracks, and some user-profile endpoints were also called out as removed for Development Mode apps in the migration guide). **Search and the core playlist read/write endpoints are not on either restricted list** — they remain available in Development Mode.

## 7. Developer Terms of Service — restrictions relevant to a multi-service (Spotify + Apple Music + YouTube) app

All quotes below are verbatim from the **Spotify Developer Policy**, effective May 15, 2025, incorporated by reference into the Developer Terms. [developer.spotify.com/policy](https://developer.spotify.com/policy)

This is the single most consequential finding for Mixtape Party's premise as a multi-service aggregator — several clauses in Section III ("Some prohibited applications") appear to bear directly on the "also integrates Apple Music and YouTube" design:

- **"Do not create any product or service which is integrated with streams or content from another service."** — read plainly, this prohibits building a single product that mixes Spotify streams/content with another streaming service's (e.g., Apple Music, YouTube) streams/content. This is a **potential hard blocker** for the "aggregate across services" concept as currently framed and should be flagged to whoever owns the platform/legal call in issue #1.
- **"Do not permit any device or system to segue, mix, re-mix, or overlap any Spotify Content with any other audio content (including other Spotify Content)."** — relevant if a "mixtape" feature ever crossfades/sequences audio, even Spotify-to-Spotify.
- **"Do not build an SDA that enables the transfer of data to another service, except for the purpose of enabling a user to transfer their personal data, or the metadata of the user's playlists to another service."** — there is a narrow, explicit carve-out for exporting a *user's own* playlist metadata to another service (e.g., a "copy this playlist to Apple Music" feature), which is meaningfully narrower than general cross-service aggregation/playback.
- **"Do not build products or services that mimic, or replicate or attempt to replace a core user experience of Spotify... without our prior written permission. Your product or service must add independent value or functionality that improves users' interactions with Spotify."**
- **"Do not use the Spotify Platform or any Spotify Content to train a machine learning or AI model or otherwise ingest Spotify Content into a machine learning or AI model."** — absolute prohibition, no carve-out language at all. Relevant if any part of the roadmap involves ML-based recommendations trained on Spotify metadata/listening data.
- **"Do not analyze the Spotify Content or the Spotify Service for any purpose, including... creating new or derived listenership metrics, benchmarking, functionality, usage statistics, user metrics, or building profiles of users, including for the purpose of targeting them with advertising or marketing."**
- Non-interactive webcasting is banned: **"Do not create any product or service which includes any non-interactive internet webcasting service. ... you can't create an application which plays content from a single source to several simultaneous listeners."**
- Business/public playback is banned: Spotify is licensed for **personal, non-commercial use**; it "can't be broadcast or played publicly from a business."
- **Commercial use (Section IV):** Except for limited non-streaming carve-outs, **"commercial uses are not permitted for [Streaming] SDAs"** — no selling the app/access to it, no e-commerce inside a Streaming SDA, and **no selling ads/sponsorships/promotions on a Streaming SDA**. Non-streaming SDAs *are* allowed to sell ads or charge for the app itself. Since Mixtape Party plans to stream via the Web Playback SDK, any monetization plan (ads, subscriptions, paid tiers) needs to route around this — likely meaning the "streaming surface" and any monetized surface need to be architected as distinct from Spotify's perspective, or monetization needs prior written Spotify approval.
- **Attribution (Section II):** Any displayed Spotify content (metadata, cover art, previews) must be clearly attributed via Spotify's branding marks, linked back to the source on Spotify, and never offered as a standalone product; **"there shall be no playback of Spotify Content without showing relevant cover art and metadata."**
- **Naming/branding (Section VI):** app name can't start with "Spot" or be confusable with Spotify; no implied endorsement/co-branding without permission. [Branding Guidelines](https://developer.spotify.com/documentation/design)
- **Design Guidelines** additionally recommend exposing only play/pause controls (not full transport controls) to avoid implying capabilities Spotify Free accounts don't actually have, and forbid modifying/cropping/overlaying Spotify-supplied artwork.

**Bottom line for #1's platform plan:** the "integrated with streams or content from another service" and "core user experience" clauses are broad enough that a strict reading could block exactly the cross-service mixtape concept the project is named for. This needs a legal/product decision, not an engineering workaround — worth raising as a blocking follow-up on issue #1 rather than assuming it's fine because no enforcement action has been observed elsewhere.

## 8. Restrictions on embedding/using playback outside the official Spotify experience

- Streaming is Premium-gated platform-wide (§5, §7).
- Any playback surface must show Spotify's cover art, metadata, and branding — you cannot build a "chrome-less" or reskinned player that hides Spotify's identity (Developer Policy §II: "there shall be no playback of Spotify Content without showing relevant cover art and metadata in your SDA"; Design Guidelines recommend the Spotify logo accompany any Spotify metadata/playback).
- Widgets have their own separate terms (Spotify Widgets Terms, linked from Developer Policy §V) if an `<iframe>`-embed widget approach is used instead of the full SDK.
- Audio Preview Clips (30-second previews) may only be used to *promote* the underlying track, must link back to Spotify, may not be offered as a standalone product, and — per the Nov 2024 changes — are no longer returned in multi-get responses for new/Development Mode apps (§6), which materially weakens "preview clip only" as a workaround for mobile in-app playback.
- Commercial use of a "Streaming SDA" (an app that streams full-length Spotify audio) is essentially prohibited beyond charging for the app itself or in-app purchases unrelated to Spotify content — no ads/sponsorships on the streaming surface (§7).
- Mobile: there is no supported way to embed literal Spotify audio playback inside a third-party app's own UI at all — the only supported mobile mechanism (App Remote SDK) hands control to, and requires, the separately-installed Spotify app (§3).

## Open questions / follow-ups for #1

1. Legal/product call needed on whether "integrated with streams or content from another service" (Developer Policy §III) is compatible with also integrating Apple Music and YouTube in the same product — this is the biggest platform risk uncovered here.
2. Confirm current Development Mode quota (5 test users, Premium-required owner account) is acceptable for however long it takes Mixtape Party to reach Extended Quota Mode eligibility (~250k MAU bar as currently documented) — or plan around staying in Development Mode indefinitely.
3. Decide the mobile playback strategy given there's no true in-app streaming SDK for iOS/Android — likely App Remote SDK (requires the Spotify app installed) vs. Web Playback SDK inside an in-app browser/webview vs. accepting we can only preview/deep-link on mobile.
