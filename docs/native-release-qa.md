# Native release QA checklist

Run this against a TestFlight (iOS) and Play internal testing (Android) build before promoting a release.
Use a real device for each platform; note build number, device, and OS at the top of the run.

Emulator and push setup (FCM, Expo push tokens, sending a test push): see [`mobile/CLAUDE.md`](../mobile/CLAUDE.md).
Release build and submit steps: "Cutting a native release" in the same file (#146).
Issue/triage conventions: [`docs/agents/`](agents/issue-tracker.md).

Mark each item pass/fail; file a failure as its own issue and link it here.

## Install and first launch
- [ ] Installs from TestFlight / Play internal testing link
- [ ] Cold launch reaches the sign-in screen with no crash or blank screen
- [ ] App name, icon, and splash are correct
- [ ] Legal links (Terms, Privacy) open

## Sign-in
- [ ] Email + password: sign up, sign out, sign back in
- [ ] Wrong password shows an error, doesn't sign in
- [ ] Google sign-in (both platforms)
- [ ] Sign in with Apple (iOS only)
- [ ] Cancelling Google/Apple shows the "cancelled" message, no stuck spinner
- [ ] Session survives force-quit and relaunch

## Emails open the app
- [ ] Magic-link email: tapping on the device opens the app (not the browser) and signs in
- [ ] Password-reset email: tapping opens the app on the reset screen; new password works
- [ ] Both links also work when the app is already running in the background
- [ ] Expired/reused link shows a clear error

## Push notifications
- [ ] Permission prompt appears at the expected moment; granting registers a token
- [ ] Denying the permission doesn't break the app
- [ ] Push received with the app backgrounded and with it killed
- [ ] Tap routes to the right screen: **guess** round, **results**, **season final**
- [ ] Tap while the app is in the foreground/background/cold-started all route correctly
- [ ] Signing out stops pushes to that device

## Preview audio
- [ ] Preview plays and pauses on a submitted track
- [ ] Starting a second preview stops the first
- [ ] Audio stops when leaving the screen
- [ ] iOS silent switch on: note whether preview audio plays and confirm that is intended

## Link-out
- [ ] "Open in YouTube Music" opens the YouTube Music app (or web fallback if not installed)
- [ ] "Open in Bandcamp" opens Bandcamp (app or web fallback)

## Profile
- [ ] Avatar upload from photo library; permission prompt and denial both handled
- [ ] Avatar appears after upload and after relaunch
- [ ] Display name edit persists

## Safety and account
- [ ] Report a submission/user; confirmation shown
- [ ] Block a user; their content is hidden from you
- [ ] Account deletion: confirmation flow completes, signs out, can't sign back in, data gone

## Offline and errors
- [ ] Airplane mode on launch: friendly error, no crash
- [ ] Airplane mode mid-session: actions fail with an error and recover when back online
- [ ] Slow/flaky network doesn't leave permanent spinners
- [ ] Invalid join code / deleted league shows a not-found state

## Tablet layout
`supportsTablet` is currently `true` in `mobile/app.json`; if it changes to `false`, skip this section.
- [ ] iPad (and an Android tablet if available): every screen above is usable, nothing clipped or stretched
- [ ] Rotation doesn't break layout or lose state
