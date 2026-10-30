# Design: Sticker Pop

Source of truth for visuals: the design artifact, https://claude.ai/artifact/9irfEfpf9EUNDNak7apF3c
(read it with the Artifact tool, `action: "read"`). It holds the full design system, every component
specimen as SVG/CSS, the cassette and sticker-badge logo artwork, and the **approved landing page
copy**. Where this file and the artifact disagree, the artifact wins. Ignore Directions B and C in it.

Product intent: `PRODUCT.md`. Tone is a party game, never a dashboard.

## Tokens

Already implemented in `mobile/lib/theme.ts` (one static light theme, no dark mode).

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

## Not built yet

Store art (#137): the Play Store feature graphic and 512px store icon. The splash is built: a Sunshine
`#FFD93D` background with the pink badge (`mobile/assets/splash-icon.png`), configured in `app.json`; Android
uses a smaller `imageWidth` so the 12+ circular crop doesn't clip the badge.
