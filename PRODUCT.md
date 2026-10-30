# Product

<!-- impeccable:product-schema 1 -->

## Platform

ios

Native mobile (Expo/React Native, Expo Router), targeting iOS and Android with one shared design language — no per-OS (Cupertino vs. Material) divergence.

## Users

Friend groups playing a recurring music-guessing party game together, in casual/social settings (not a work or productivity context).

## Product Purpose

Friends join a shared "league." Each round has a theme; every player anonymously submits one track fitting the theme from any supported music service. Once submissions close, players guess who submitted which track. Results reveal the submitters, correct guessers, and round scores.

## Positioning

A social music-discovery game built around anonymous submission + guessing, rather than a straight playlist-sharing or listening-party tool — the mechanism is the guessing game, not the music library.

## Operating Context

- Rounds move through three phases: submission → guessing → results.
- Players search and submit from any supported music service (YouTube Music, Bandcamp) without linking an account; Bandcamp is embed/URL-only (no search API).
- Track playback during guessing depends on whether the guesser can play that track's service in-app (deep link) vs. web fallback.
- Leagues are joined via invite code/link.
- Cross-service playlist consolidation/export exists after rounds complete.
- Notifications cover reminders and phase-transition alerts.

## Capabilities and Constraints

- Two supported services, each with a distinct brand identity to surface per track: YouTube Music, Bandcamp.
- No official brand logo asset files are present in the repo yet — badges must be built from brand color + wordmark/monogram until real logo assets are supplied.
- The mobile app uses the Sticker Pop design system (`DESIGN.md`, `mobile/lib/theme.ts`, `mobile/lib/ui.tsx`): plain React Native styles, no NativeWind, one light theme, no dark mode.
- App icon, splash and Play store art (feature graphic, store icon) are done (#137).

## Brand Commitments

Product name: "Mixtape Party"

## Evidence on Hand

No real user testimonials, screenshots, or brand assets on hand. Do not fabricate any.

## Product Principles

1. Anonymity during submission/guessing is the core mechanic — the UI must never leak who submitted a track before guesses are locked in.
2. Casual and social over professional/productivity — visual tone should read as a party game, not a dashboard.
3. Service-neutral: no single music service should read as more "native" or favored than another in the UI.
4. Mobile-first, single shared design language across iOS and Android.

## Accessibility & Inclusion

No formal requirement. In practice: reel animation respects the OS reduce-motion setting, errors use an alert live region, and focus rings are drawn on web.
