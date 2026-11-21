# Where an Apple Music account can be linked from the Expo app

Research for #202 (child of map #200). Researched 2026-11-20 against Expo SDK 57
(`expo ~57.0.31`, `react-native 0.86.3`, iOS deployment floor 16.4 from
`ExpoModulesCore.podspec`), `mobile/app.json` (bundle id / package `com.mixtapeparty.app`,
`web.output: "server"`) and `mobile/eas.json` (Apple team `D5TLK455G6`, ASC app `6828562097`, so the
developer enrollment that #43 waited on exists).

**Question.** On which platforms (iOS native, Android native, web at mixtape-party.com) can a player
authorize Apple Music and hand our API a **Music User Token** (MUT), and with what library?

**Short answer.** iOS native and web work. Android native technically works but is fragile, so treat
it as degraded and send Android players to the web to link. A MUT is account-scoped and stored by the
API, so linking once on any platform covers every platform.

## Background: what "linking" needs

- The API needs two things to write a playlist into a player's library: a **developer token**, which
  is an ES256 JWT we sign with a MusicKit `.p8` key (max about 6 months, optional `origin` claim for
  web), and the player's **Music User Token**. API calls send
  `Authorization: Bearer <dev token>` plus a `Music-User-Token` header.
  Source: https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit
- On that page Apple says MusicKit manages the MUT automatically on Apple platforms and on the web,
  but on Android "you need to manage the Music User Token yourself". This repo's prior notes say the
  same (`docs/research/apple-musickit.md` on branch `research/apple-musickit`, #3).
- MUT lifetime is not documented. Plan for re-linking when a call returns 401/403.

## 1. The EAS / entitlement gap from #43 is a misconfiguration, not an EAS limitation

#43 reverted the native MusicKit wiring (6ca7313) partly because EAS could not provision
`com.apple.developer.musickit`. That entitlement does not exist:

- Apple DTS's pinned post "Determining if an entitlement is real" lists
  `com.apple.developer.musickit` among commonly hallucinated entitlements. It says: "There is no
  MusicKit capability. Rather, enable MusicKit via the App Services column in the App ID editor ...
  tied to your App ID on the server side, meaning that they have no presence in your code
  signature." https://developer.apple.com/forums/thread/799000
- Apple's account help: Certificates, IDs & Profiles → Identifiers → App ID → **App Services** tab →
  tick **MusicKit**. https://developer.apple.com/help/account/services/musickit/
- Expo's iOS capabilities page never mentions MusicKit. It says unsupported capabilities "must be
  manually enabled via Apple Developer Console".
  https://docs.expo.dev/build-reference/ios-capabilities/
- Lomray-Software/react-native-apple-music#14 ("EAS Build: MusicKit entitlement") is still **open**
  (opened 2026-03-18, last comment 2026-05-18). The maintainer says they "haven't yet validated a
  fully working setup with EAS Build". The fix proposed in PR #16 is still open and unmerged.
  https://github.com/Lomray-Software/react-native-apple-music/issues/14 ,
  https://github.com/Lomray-Software/react-native-apple-music/pull/16 .
  That library's README still tells users to add the fake entitlement, which is how #43 ran into
  the problem.

**Conclusion:** add no entitlements to `app.json`. A human ticks MusicKit on the
`com.mixtapeparty.app` App ID, and EAS Build signs normally. The same portal visit creates the Media
ID and the MusicKit `.p8` key the API needs to sign developer tokens.

## 2. React Native / Expo MusicKit wrappers

Survey from npm search (https://registry.npmjs.org/-/v1/search?text=musickit), checked against each
repo's source.

| Package | Latest | Platforms | Exposes a MUT? | Verdict |
| --- | --- | --- | --- | --- |
| [`@wwdrew/expo-apple-music`](https://github.com/wwdrew/expo-apple-music) | 1.1.3 (2026-06-08), repo active to 2026-08 | iOS, Android, web | **Yes**: `Auth.authorize(developerToken?)` resolves `{ status, musicUserToken? }` | **Best fit.** Expo Module with a config plugin. Built against SDK 56 (devDeps `expo ^56`, peers `*`), so it needs a spike on 57. |
| [`@lomray/react-native-apple-music`](https://github.com/Lomray-Software/react-native-apple-music) | 1.4.0 (2026-04-07) | iOS only | **No**: `Auth.authorize()` returns only an auth status | Ruled out. It can't hand us a token, uses the legacy NativeModules bridge, and its README documents the fake entitlement. |
| `@beatsphere/expo-apple-music-kit` | 0.1.0 (2026-04-23), single commit | iOS (Android build broken per open issue) | Yes (`getUserToken`) | Too thin and unmaintained. |
| `0xA-10/expo-music-kit`, `react-native-apple-music-sdk`, the `@shehryarraza` / `@soundxyz` / `@channingb` / `@charliemitchell` / `@ayoelutilo` forks, `capacitor-plugin-musickit` | 2023–2024 | — | — | Abandoned. |

Notes on `@wwdrew/expo-apple-music`, from its source:

- iOS returns a MUT only when you pass a developer token. It calls
  `SKCloudServiceController.requestUserToken(forDeveloperToken:)` (`ios/SubscriptionService.swift`),
  which Apple deprecated in iOS 18 in favor of MusicKit's `MusicUserTokenProvider` (iOS 15+). It
  still works, but a fork or patch may eventually be needed.
- Its `IOS_SETUP.md` says explicitly not to add `com.apple.developer.musickit`, and to enable
  MusicKit on the App ID instead. This matches section 1.
- Its config plugin sets `NSAppleMusicUsageDescription` and the iOS 16.4 target, which already
  matches SDK 57's floor.
- Android needs Apple's MusicKit AARs placed in a directory named by the `androidMusicKitAarDir`
  plugin option. Apple doesn't allow redistributing them, so they'd be committed to our repo or
  fetched in the build.
- Web lazy-loads `https://js-cdn.music.apple.com/musickit/v3/musickit.js` on the first
  `authorize()` call.
- Same author as `expo-spotify-sdk`. It has a small following (2 stars), so we'd effectively own it
  if it breaks.

## 3. Web: MusicKit JS v3 inside the Expo web export

- Apple's v3 docs, "User Authorization": "The `authorize` method will open the sign-in and
  authorization flow, which, when successful, will resolve the promise ... If the user has previously
  authorized your app, and their Music User Token (MUT) is still valid, then the method will resolve
  without opening the authorize flow." The token is then available as `music.musicUserToken`.
  https://js-cdn.music.apple.com/musickit/v3/docs/index.html
- The licence (ADPLA §3.3.6.D, summarised in `docs/research/apple-musickit.md` on
  `research/apple-musickit`) requires loading MusicKit JS from Apple's CDN, not bundling it. That
  rules out a bundled npm copy; use a `<script>` tag or the wwdrew web module, which injects it.
- The flow is a **popup** to `authorize.music.apple.com`. Operational gotchas, all from community
  reports on Apple's forums rather than Apple documentation:
  - `authorize()` must run from a user gesture, or the popup gets blocked.
    https://developer.apple.com/forums/thread/106795
  - `Referrer-Policy: no-referrer` breaks the popup. `mobile/server.js` sets no such header today;
    keep it that way. https://developer.apple.com/forums/thread/837028
  - Recent AUTHORIZATION_ERROR reports on Windows Chrome/Edge.
    https://developer.apple.com/forums/thread/853567
  - In-app browsers (Instagram, Messenger, etc.) block the popup. Apple points to its "Native
    Webviews" tech note; a redirect workaround exists, but its reliability is reported as mixed.
    https://developer.apple.com/forums/thread/674118
- Since `web.output` is `"server"` and the app is the Expo export, a `/link/apple-music` route can
  call `authorize()` from a button press and POST the MUT to the API. The API must also serve the
  developer token. Sign it with an `origin` claim of `https://mixtape-party.com` for web.

**Verdict:** works, with the usual popup caveats.

## 4. Android: Apple's MusicKit for Android

- Apple ships two proprietary AARs (auth and media playback) behind a developer login:
  https://developer.apple.com/musickit/ ("Libraries are available to let users sign in to their
  Apple Music account and play music directly from your app").
- Auth hands off to the **Apple Music Android app**. That app must be installed and signed in, and
  in practice the user needs a subscription. There is no web login inside the SDK.
- Fragility, from Apple's forum (https://developer.apple.com/forums/thread/838633):
  - Apple Music for Android 6.5.0 (July 2026) broke SDK auth (`USER_CANCELLED`).
  - 6.5.1–6.5.2 hung.
  - 6.5.3 (September 2026) fixed it.
  - DTS pointed developers to MusicKit SDK for Android 1.1.4 (May 2026), which ships
    `MusicKitAuth-release-1.1.5.aar` and `MediaPlayback-release-1.1.4.aar`. The Feedback tickets
    were still open.
- The only React Native binding is `@wwdrew/expo-apple-music`. Its docs target the older
  1.1.2 / 1.1.1 AARs, so we'd have to test whether it works with the newer ones.
- Per Apple's user-auth page, the MUT isn't managed automatically on Android, so the app must store
  and refresh it itself. That is fine for us, because the API stores it anyway.
- WWDC26 session 254, "Integrate MusicKit into your app", is Swift-only. It made no Android or web
  announcements. https://developer.apple.com/videos/play/wwdc2026/254/

**Verdict:** degraded. It's possible, but it depends on a third-party app's version, non-redistributable
binaries, and a single small wrapper. Recommended Android path: a "Link Apple Music" button opens
`https://mixtape-party.com/link/apple-music` with `WebBrowser.openAuthSessionAsync` (already used in
`mobile/app/sign-in.tsx`), runs the section 3 web flow, and returns via the `mixtapeparty://` scheme.
Whether the MusicKit JS popup works inside a Chrome Custom Tab is **unverified** and needs a
spike. The fallback is to tell the player to link from a desktop or phone browser.

## 5. iOS: is a web-based MusicKit JS flow a viable fallback?

- Not inside an embedded WebView. `authorize()` reportedly does nothing in WKWebView or
  react-native-webview (https://developer.apple.com/forums/thread/746776, unanswered).
- Possibly via `openAuthSessionAsync` (ASWebAuthenticationSession), as on Android. Whether the
  popup opens inside that session is unverified.
- It's moot. With MusicKit ticked on the App ID, the native path through `@wwdrew/expo-apple-music`
  is the primary route, and the web route stays available as "link from the website".

## Per-platform summary

| Platform | Verdict | How | Preconditions / caveats |
| --- | --- | --- | --- |
| iOS native | **Works** | `@wwdrew/expo-apple-music` `Auth.authorize(devToken)` → MUT → POST to API | Human ticks MusicKit on the App ID (no entitlement); API serves the developer token; spike on SDK 57; it uses the deprecated `requestUserToken` |
| Web (mixtape-party.com) | **Works** | MusicKit JS v3 from Apple's CDN, `authorize()` on a button press | User gesture, popups allowed, no `no-referrer` policy; in-app browsers fail; developer token with `origin` claim |
| Android native | **Degraded** | Preferred: link via the web flow in a browser tab. Possible: `@wwdrew/expo-apple-music` with vendored Apple AARs | Native requires the Apple Music app installed, signed in and current; the SDK has broken on app updates; Custom Tab popup behaviour unverified |

Shared prerequisites, all human portal steps: tick MusicKit on the App ID, create a Media ID and a
MusicKit private key, and store the key in Secret Manager for the API to sign developer tokens.

## Implications for the map

- **Linking is per account, not per device.** The MUT lives server-side and is used for playlist
  export, so a player who links once, anywhere, is linked everywhere. No platform is a dead end:
  Android players (and anyone in an in-app browser) can link on mixtape-party.com.
- **#206 (listen-on preference):** don't hide or disable "Apple Music" as a listen-on choice on any
  platform. The preference is per player and service-neutral, and it should stay independent of
  whether a MUT is linked yet. Suggested states:
  - *Apple Music, linked* → the round playlist is written into the player's library.
  - *Apple Music, not linked* (including a player on Android who hasn't visited the web) → the
    degraded mode. Show the round's tracks as Apple Music links (catalog search by ISRC, which the
    API can do with the developer token alone) that open in the Apple Music app or web player,
    plus a "Link Apple Music" prompt that routes to the web flow on Android.
  - This is distinct from "not yet specified", which #200 already covers.
- **Expired or revoked tokens** fall back to the same "not linked" state and prompt a re-link. The
  API needs to treat a 401/403 from Apple as "unlinked", not as a hard error.
- **Spikes before committing:**
  1. `@wwdrew/expo-apple-music` on SDK 57 with a dev client.
  2. MusicKit JS `authorize()` inside `openAuthSessionAsync` on Android (Custom Tab), and on iOS
     if we ever want it.
- **Not needed:** any entitlement in `app.json`, a revival of the `@lomray` wiring from #43, or a
  WebView-based flow.
