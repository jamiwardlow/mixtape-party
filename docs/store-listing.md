# Store listing drafts (#135)

Paste-ready drafts for App Store Connect and Play Console. Nothing here is submitted; review before use.
Copy is lifted from `mobile/landing.html` and `PRODUCT.md` so the stores match the site. Items marked **VERIFY**
are answers I couldn't confirm from the code.

iPad is off (`supportsTablet: false`), so no iPad screenshots are needed.

## 1. Listing copy

| Field | Limit | Draft |
| --- | --- | --- |
| Name (both stores) | 30 | `Mixtape Party` |
| Apple subtitle | 30 | `Everyone picks. You guess.` (26) |
| Apple promotional text | 170 | `Pick a song for the theme, keep it secret, then guess who chose what. Playlists with your friends, with a game on top.` (118) |
| Play short description | 80 | `Everyone secretly picks a song. You guess whose. A music game for friends.` (74) |
| Apple keywords | 100 | `music,game,friends,playlist,party,guess,league,quiz,songs,social,bandcamp,youtube` (81) |
| Apple primary category | | Music |
| Apple secondary category | | Games > Music (or Social Networking) |
| Play category | | Music & Audio (Play's Games > Music is for rhythm games, not this) |
| Support URL | `https://mixtape-party.com/support` | Page shows `hello@mixtape-party.com`; live after the next push to `main`. |
| Privacy URL | | `https://mixtape-party.com/privacy` |
| Terms URL (optional) | | `https://mixtape-party.com/terms` |
| Data-deletion URL (Play) | | `https://mixtape-party.com/delete-account` |

Keyword notes: Apple indexes the name and subtitle already, so those words are left out of the keyword list. "bandcamp" and "youtube" are
trademarks; they're fine as honest descriptions of supported services but drop them if review pushes back.

### Full description (Apple 4000 / Play 4000)

```
Make a playlist with your friends, and turn it into a game.

Start a league, invite your friends with a code or link, and play a round together. Every round has a theme. Everyone secretly picks one song that fits. When submissions close, the guessing begins: who picked which track?

ONE ROUND, THREE STEPS
1. Submit. Search for a track from any supported music service and send it in. Nobody sees who picked what.
2. Guess. Listen through the lineup and match each song to the friend you think chose it.
3. Results. The picks are revealed, the scores are tallied, and the podium decides who has the best taste this week.

WHY IT'S FUN
- Anonymous picks. Nobody knows whose song is whose until the guesses are locked in.
- Any service. Pick from YouTube Music or Bandcamp. You don't need to link an account to play.
- Play along with friends. Comment on the results, react to the picks, and save your favorites.
- Keep the playlist. After a round, export the songs to a playlist.
- Reminders that nudge, not nag. Get notified when a round opens, when it's time to guess, and when results are in. Turn them off any time.

Mixtape Party is a game for friends. There are no ads and we don't sell your data.

Tracks play from their own services; we don't host any music.
```

**VERIFY before pasting:** the "export to a playlist" and "react / comment / favorites" lines match what's shipped (they're from the
code and landing page; delete any line that isn't live in the release build). "Play along with friends" should not claim a minimum or maximum league size.

### What's new (first release)

```
First release. Start a league, pick a song, and guess who picked what.
```

## 2. Apple App Privacy labels

Source: `mobile/app/privacy.tsx` (what the policy already says). Answer **Yes, we collect data**. Every item below is
**Linked to the user** and **not used for tracking**; purpose is **App Functionality** only (no analytics, no advertising, no personalization).

| Apple category | Data type | Collected? | Why |
| --- | --- | --- | --- |
| Contact Info | Email Address | Yes | Account and sign-in, reminders |
| Contact Info | Name | Yes | Display name (and Google/Apple-provided name) |
| User Content | Photos or Videos | Yes | Optional avatar |
| User Content | Other User Content | Yes | Submitted tracks, guesses, comments, reactions, favorites |
| Identifiers | Device ID | Yes | Expo push token (only if notifications are allowed) |
| Everything else | Location, Health, Financial, Contacts, Browsing/Search History, Usage Data, Diagnostics, Purchases, Sensitive Info | No | |

**VERIFY:** Search queries sent to the music search API. If the API logs or stores them tied to a user, add Search History. Also confirm no crash
reporting or analytics SDK is installed (`mobile/package.json` shows none that I saw, but check before answering "No" to Diagnostics/Usage Data).

"Tracking" question: **No**. Nothing is shared with data brokers or used for cross-app ads, so no App Tracking Transparency prompt is needed.

## 3. Play Data Safety form

- **Does the app collect or share required user data types?** Yes, collects. **Shares:** No. (Resend, Expo, Neon and Google Cloud act as service providers processing data on our behalf; Google doesn't count that as "sharing".)
- **Is all data encrypted in transit?** Yes (HTTPS to `api.mixtape-party.com`).
- **Can users request deletion?** Yes: in-app (My Account > Delete account) and at `https://mixtape-party.com/delete-account`.

| Play category | Data type | Collected | Optional? | Purpose |
| --- | --- | --- | --- | --- |
| Personal info | Email address | Yes | Required | App functionality, account management |
| Personal info | Name | Yes | Required (display name is part of the profile; **VERIFY** whether it can be blank) | App functionality |
| Photos and videos | Photos | Yes | Optional | App functionality (avatar) |
| Messages | Other in-app messages (comments, replies) | Yes | Optional | App functionality |
| App activity | Other user-generated content (tracks, guesses, reactions, favorites) | Yes | Required to play | App functionality |
| Device or other IDs | Device or other IDs (push token) | Yes | Optional | App functionality (notifications) |
| Everything else (location, financial, health, contacts, web history, app interactions/analytics, crash logs) | | No | | |

**Permissions flag, not a form answer:** `mobile/app.json` declares `android.permission.RECORD_AUDIO`. The app only plays previews (no recording),
and `expo-audio` adds that permission by default. Google will show it on the listing and may ask why. Safest fix is to block it (`blockedPermissions`
in `app.json`, or the `expo-audio` plugin's `microphonePermission: false`); I haven't changed it because it's outside this issue. Say if you want that done.

## 4. Content rating

**Apple age rating (App Store Connect questionnaire).** Answer honestly on the new questionnaire:
- In-app controls: none (no parental controls). Age assurance: none.
- Mature themes, violence, sexual content, profanity, horror, gambling, contests, medical: **None**.
- **User-generated content / unrestricted web access:** the app has UGC (comments, display names, photos) and the safety measures from #144.
  Say **Yes to UGC** and select report/block and the terms-of-use rule against harassment. No unrestricted web browsing.
- Expected result: roughly **12+** because of UGC (Apple sets the final number). Don't pick 4+ and then mention UGC; that mismatch is a rejection risk.

**Google Play IARC questionnaire.** Category: **Social / Communication or Music app** (pick whichever IARC offers closest to "social"; if unsure, choose the one that lets you declare user interaction).
- Violence, sex, language, controlled substance, gambling: **No**. (**VERIFY:** song titles and artwork come from third-party services and can contain explicit lyrics or art. Answer the "user-generated content / user interaction" question **Yes** and mention shared third-party content.)
- Users can interact or exchange content: **Yes** (comments, reactions, photo avatars).
- Shares user location: No. Allows purchases: No.
- Expected result: roughly **Teen / PEGI 12**.

**Store review notes to paste (both stores):**
```
Mixtape Party is a friends-only music guessing game. Users can interact only inside leagues they join by invite code.
Moderation: any comment or reply can be reported, and any player can be blocked from their profile or the results screen
(blocked players' content is hidden from the blocker; manage the list under My Account). Terms of Use prohibit harassment and hate.
Account deletion is in My Account > Delete account and at https://mixtape-party.com/delete-account.
```
**Needed from you:** a demo account (email + password) and a seeded league for the reviewers. Apple rejects apps whose sign-in they can't use, and a
brand-new account lands on an empty home screen.

## 5. Screenshot shot list

**Rules for every shot**
- Use a seeded demo league with invented players and songs (no real people, no real friends' avatars). PRODUCT.md says not to fabricate evidence, so these are a labeled demo account, not testimonials.
- Capture from a real build (#133), not a web export. Keep the status bar clean (full battery, 9:41 on iOS, no notifications).
- Anonymity: the Submit and Guess shots must not reveal who submitted a track.
- Light theme only (the app has no dark mode). The Sticker Pop look (sunshine yellow, ink borders) is the brand; screenshots should be plain captures, optionally with a short Bagel Fat One caption added afterwards.

**Sizes**
| Store | Size | Notes |
| --- | --- | --- |
| iPhone 6.9" | 1320 x 2868 (iPhone 16/17 Pro Max simulator) | Required. |
| iPhone 6.5" | 1284 x 2778 or 1242 x 2688 | Apple scales from 6.9" when 6.5" is missing, so only upload it if it asks. |
| Android phone | 1080 x 1920 or larger, 16:9 to 9:16, 2 to 8 images | Pixel 8 emulator (see `mobile/CLAUDE.md`) gives 1080 x 2400. |
| Play icon | 512 x 512 | Done: `mobile/assets/store/icon-512.png` |
| Play feature graphic | 1024 x 500 | Done: `mobile/assets/store/feature-graphic.png` |
| iPad | none | `supportsTablet: false`. |

**Shots, in order (first two matter most; they show in search results)**
| # | Screen | File | What to show | Caption idea |
| --- | --- | --- | --- | --- |
| 1 | Home | `mobile/app/home.tsx` | Two or three leagues, one with a live round | Everyone picks a song. |
| 2 | Submit | `mobile/app/round/[roundId]/submit.tsx` | A theme and a chosen track, submitter hidden | Pick one that fits the theme. |
| 3 | Guess | `mobile/app/round/[roundId]/guess.tsx` | A track playing with the player roster to guess from | You guess whose. |
| 4 | Results | `mobile/app/round/[roundId]/results.tsx` | Podium (top 3) with reactions | Find out who has taste. |
| 5 | League | `mobile/app/league/[leagueId]/index.tsx` | Standings and roster | Keep score all season. |
| 6 | Season final | `mobile/app/league/[leagueId]/final.tsx` | The finale | Crown a champion. |
| 7 | Join with a code | `mobile/app/join/[code].tsx` | Invite screen | Bring your friends. |

Skip sign-in, account and legal screens. Android gets the same set; reuse the shot list but capture on the emulator so the system chrome is Android's.

Captions are optional. If you add them, use the fonts and colors in `DESIGN.md`. I haven't designed caption frames.

## 6. Open questions for you

1. Support URL: is `https://mixtape-party.com/` enough, or do you want a `/support` page? Apple requires the support URL to be a real page with contact info.
2. Block `RECORD_AUDIO`? (Section 3.)
3. Demo account and seeded league for the reviewers.
4. Apple secondary category: Games > Music or Social Networking.
