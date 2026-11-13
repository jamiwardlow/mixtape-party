# Design: Sticker Pop

Source of truth for visuals: the design artifact, https://claude.ai/artifact/9irfEfpf9EUNDNak7apF3c
(read it with the Artifact tool, `action: "read"`). It holds the full design system, every component
specimen as SVG/CSS, the cassette and sticker-badge logo artwork, and the **approved landing page
copy**. Where this file and the artifact disagree, the artifact wins. Ignore Directions B and C in it.

Product intent: `PRODUCT.md`. Tone is a party game, never a dashboard.

## Tokens

Light theme is implemented in `mobile/lib/theme.ts`. The dark variant below is designed (#187) but not yet built.

| Token | Value |
| --- | --- |
| Sunshine (page bg) | `#FFD93D` |
| Ink (text, borders, shadows) | `#1A1033` |
| Bubblegum (primary accent) | `#FF4F9A` |
| Cobalt | `#3D5AFE` |
| Mint | `#5EEAD4` |
| Tangerine | `#FF8A3D` |
| Border | 3px ink |
| Radius | 20px cards, pill buttons |
| Shadow | hard offset 4px, solid ink, no blur (the `Sticker` helper in `mobile/lib/ui.tsx`) |
| Titles | Bagel Fat One, tilted -2deg |
| Body / labels | Courier Prime (typewriter) |

Custom fonts: never use `fontWeight`; use the explicit bold family.

## Decisions

- Typewriter body font is a hard requirement. No handwriting fonts in the UI (a logo may).
- Cassettes have spinning reels and should look like a real cassette. No marker font, no "cassette buddy" mascot.
- Logo is the sticker badge. Keep the cassette mark away from the badge.
- App icons: options 3 and 4 in the artifact.
- Service badges are built from brand color + wordmark, never logos (PRODUCT.md).
- Anonymity: nothing may reveal a submitter before guesses lock.

## Built

Components live in `mobile/lib/ui.tsx`: `PhaseSteps`, `Chip`, `Toast`, `LeaderboardRow`, `StickerBadge`
(the logo), `Cassette` (spinning reels; still under reduced motion), `TapeButton`, `TapeInput`,
`ServiceBadge`, `InitialDisc`. All screens were restyled on Sticker Pop (#155), and the web client adapts
to desktop/tablet widths (#156). The marketing page is `mobile/landing.html`.

## Store art and splash

Store art (#137) is in `mobile/assets/store/`: `feature-graphic.png` (1024x500, Sunshine with the headline and a
cassette) and `icon-512.png` (the app icon downscaled; Play rounds it). The splash is a Sunshine
`#FFD93D` background with the pink badge (`mobile/assets/splash-icon.png`), configured in `app.json`; Android
uses a smaller `imageWidth` so the 12+ circular crop doesn't clip the badge.

## Dark mode (designed in #187, not yet implemented)

Direction D, "Die-cut Blue-Teal". Prototype: `docs/design/dark-mode-prototype.html` (A and C are rejected alternatives).

**Rule:** the outline, the hard shadow and the text all flip to near-white, like the die-cut edge of a sticker. The 3px border,
4px offset, no-blur shadow, radii, fonts and tilt are unchanged. Accents keep their saturated colors, and text sitting on an accent
stays dark.

| Token | Light | Dark |
| --- | --- | --- |
| `bg` | `#FFD93D` | `#052A3D` |
| `shell` (cards, inputs) | `#FFFFFF` | `#0C3D55` |
| `shellPressed` | `#FFF3B8` | `#165069` |
| `ink`, `hairline`, `reel` | `#1A1033` | `#FFFDF5` |
| `inkMuted` | `#4A3F6B` | `#A8D3E0` |
| shadow color (new key; ink in light) | `#1A1033` | `#FFFDF5` |
| `accent` (Bubblegum) | `#FF4F9A` | `#FF4F9A` |
| `accentInk` | `#1A1033` | `#1A1033` |
| `cobalt` | `#3D5AFE` | `#8C9EFF`, text on it `#052A3D` |
| `danger` | `#B3124F` | `#FF7AA8` |
| `mint`, `tangerine`, Sunshine | as is | as is, with dark text on them |
| YouTube badge | `#FF0000` | `#FF8080` |
| Bandcamp badge | `#1DA0C3` | `#3FC0E3` |
| Album-art placeholder, reaction pill | `#FFF3B8` | `#165069`, near-white outline |

Contrast (WCAG AA, all verified): near-white on `shell` 11.4:1, `inkMuted` 7.2:1, `cobalt` 4.7:1, `danger` 4.7:1, YouTube 4.8:1,
Bandcamp 5.4:1, dark ink on Bubblegum 5.9:1. Bubblegum on `shell` is only 3.8:1: use it for fills, never as small text.
Leaderboard `InitialDisc` colors and the `Sticker` outline stay as they are, with dark initials.

Decisions:
- The app follows the system setting only; there is no manual toggle (revisit if players ask). Remove `userInterfaceStyle: "light"`
  from `app.json` and the forced `colorScheme: 'light'` in `ui.tsx`.
- The landing page follows the system setting via `prefers-color-scheme` on its existing CSS variables.
- Store art, the splash and the app icon stay Sunshine.
