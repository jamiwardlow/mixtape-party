@AGENTS.md

## Testing Android locally (no Android Studio, no device)

Verified on an Apple Silicon Mac.

### Emulator

- `brew install openjdk@17` and `brew install --cask android-commandlinetools`
- `sdkmanager "platform-tools" "emulator" "system-images;android-35;google_apis_playstore;arm64-v8a"`, then `avdmanager create avd -n mixtape -k "system-images;android-35;google_apis_playstore;arm64-v8a" -d pixel_8`
- Use a **Google Play** image, not plain `google_apis`: FCM needs Play services.
- APK: the latest finished `development` build from `eas build:list --platform android`; install with `adb install -r`.
- The build is a dev client: run `npx expo start --dev-client`, `adb reverse tcp:8081 tcp:8081`, and open `mixtapeparty://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081`.

### Local API + scratch database

- `api/.env` points `DATABASE_URL` at Postgres.app's `mixtape_party`. Don't migrate that one. Create a scratch DB (`create database mixtape_push_test`) and run `DATABASE_URL=postgres://localhost:5432/mixtape_push_test npm run migrate` in `api`.
- Start with `DATABASE_URL=... SWEEP_SECRET=local-test RESEND_API_KEY= npm run dev` (shell env wins over `.env`; a blank key makes mail a no-op).
- `adb reverse tcp:3000 tcp:3000`. The app's default `API_URL` is `http://localhost:3000`, so no env change is needed.
- Fire reminders by hand: `curl -X POST -H "x-sweep-secret: local-test" localhost:3000/internal/sweep`.

### Gotchas

- **Zscaler (or any TLS-inspecting proxy) breaks FCM on the emulator.** Play services rejects the proxy certificate on `mtalk.google.com:5228`; the app logs `FirebaseMessaging: ... SERVICE_NOT_AVAILABLE` and no token registers. Check with `openssl s_client -connect mtalk.google.com:5228` and look at the issuer.
- `registerPushToken` swallows every error (`catch {}`), so the only symptom is an empty `push_tokens` table. Use `adb logcat | grep FirebaseMessaging` to see why.
- Needs FCM credentials uploaded to Expo for the project, or token fetch fails even on a good network.
