# Product

<!-- impeccable:product-schema 1 -->

## Platform

ios

Native mobile (Expo/React Native, Expo Router), targeting iOS and Android with one shared design language — no per-OS (Cupertino vs. Material) divergence.

## Users

Friend groups playing a recurring music-guessing party game together, in casual/social settings (not a work or productivity context).

## Product Purpose

Friends join a shared "league." Each round has a theme; every player anonymously submits one track fitting the theme from their linked music service. Once submissions close, players guess who submitted which track. Results reveal the submitters, correct guessers, and round scores.

## Positioning

A social music-discovery game built around anonymous submission + guessing, rather than a straight playlist-sharing or listening-party tool — the mechanism is the guessing game, not the music library.

## Operating Context

- Rounds move through three phases: submission → guessing → results.
- Players link one or more music services (Apple Music, YouTube Music, Bandcamp) to search and submit tracks; Bandcamp is embed/URL-only (no search API).
- Track playback during guessing depends on whether the guesser can play that track's service in-app (deep link) vs. web fallback.
- Leagues are joined via invite code/link.
- Cross-service playlist consolidation/export exists after rounds complete.
- Notifications cover reminders and phase-transition alerts.

## Capabilities and Constraints

- Three supported services, each with a distinct brand identity to surface per track: Apple Music, YouTube Music, Bandcamp.
- No official brand logo asset files are present in the repo yet — badges must be built from brand color + wordmark/monogram until real logo assets are supplied.
- Mobile app currently has no design system, no NativeWind, and no dark/light theming — all screens use unstyled default React Native `Button`/`StyleSheet` primitives.

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

No product-specific accessibility requirement established yet.
