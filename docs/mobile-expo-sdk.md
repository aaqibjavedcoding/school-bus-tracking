# Mobile — Expo SDK Version Policy (READ BEFORE TOUCHING `mobile/package.json`)

## The rule

**This project is permanently locked to Expo SDK 54** (`expo ~54.0.37`,
React Native 0.81.5, React 19.1.0). Do not upgrade `expo` (or any
`expo-*` / `react-native*` package) to a SDK 55/56/57+ line to "fix" an Expo
Go version-mismatch error. That upgrade is unnecessary, churns every native
dependency in the app, and the mismatch comes back the next time Expo Go
updates — because Expo Go always ships whatever the *newest* SDK is, not a
fixed one.

The actual, permanent fix — already implemented in this repo — is to stop
depending on Expo Go for development entirely and use a **development
build** instead (see below). Do that first; only upgrade the SDK as a
deliberate, separate, reviewed decision.

## Root cause of "Project is incompatible with this version of Expo Go"

- Expo Go on your phone is a generic app **published once per Expo SDK
  release** and updated by the Play Store / App Store independently of this
  repo. Every store update moves Expo Go to the *latest* SDK (57 as of this
  writing; it will be 58, 59, … later — Expo does not keep old SDKs
  installable via a normal store update).
- This project is pinned to SDK 54 on purpose (see "Why we don't upgrade"
  below).
- Expo Go refuses to load a project whose SDK doesn't exactly match its own
  bundled SDK — hence the incompatibility banner. **This is not a bug in the
  app or a broken install; it is Expo Go being newer than the project.**
- Because Expo Go's SDK keeps moving forward on its own schedule, pinning the
  *project* to SDK 54 and expecting the *generic Play/App Store Expo Go* to
  keep working is not sustainable — the mismatch will recur after every Expo
  Go update, indefinitely. The fix has to remove the dependency on the
  generic Expo Go build, not chase its version.

## Why we don't upgrade the project's SDK

- SDK 54 is the deliberate, stable baseline for this app. Bumping to
  55/56/57+ is explicitly out of scope per project policy — it would force a
  large, unnecessary set of native dependency and native-config changes
  across the whole mobile app for a problem that a development build solves
  without touching a single dependency version.
- Every future Expo Go release will again be newer than whatever SDK this
  project pins. Chasing it by upgrading the SDK every time Expo Go updates is
  not "fixing" anything — it is signing up for a perpetual, unnecessary
  upgrade treadmill. That's exactly what this document exists to stop.

## The permanent fix: a development build (`expo-dev-client`)

`expo-dev-client` is already installed
(`mobile/package.json` → `"expo-dev-client": "~6.0.21"`, the exact version
Expo publishes for SDK 54 — see `sdk-54` npm dist-tag). A development build
is **your own build of the app** — compiled once with your native
dependencies (same ones the production APK uses) — instead of the generic
Expo Go app. Once installed on a device/emulator, it:

- Never mismatches, because its SDK is whatever this project uses — not
  whatever the Play/App Store happens to be serving that week.
- Keeps Fast Refresh, the dev menu, and `npx expo start` exactly as before.
- Is unaffected by any future Expo Go store update, forever — the whole
  class of bug this ticket is about cannot recur once you're on a dev build.

### One-time setup per device/emulator

```bash
# from the repo root
npm install
npm run build:packages

# build & install a development build (Android; needs Android Studio/SDK)
cd mobile
npx expo run:android            # emulator, or add --device for a USB phone

# iOS (needs Xcode, macOS only)
npx expo run:ios                # simulator, or add --device for an iPhone
```

This compiles the native app once (a couple of minutes) and installs it.
`npx expo run:android|ios` also starts the Metro dev server for you.

### Everyday development after that

```bash
# start the API + web (serves the API too, see mobile/README.md)
npm --prefix web run dev

# start Metro — same command as before, no flags needed
cd mobile && npm start
```

`npx expo start` auto-detects the installed dev client and launches into it
directly (no more picking Expo Go vs. dev build — the dev client is already
on the device). If both a dev build and Expo Go happen to be installed on
the same device, force the dev build explicitly with:

```bash
npm run start:dev-client   # same as: expo start --dev-client
```

You only need to repeat `expo run:android` / `expo run:ios` (rebuild the
native shell) when:

- a **new native dependency** is added (anything with native code, not a
  pure-JS package),
- `mobile/app.json` config that affects native code changes (permissions,
  plugins, icons, bundle id, etc.), or
- Google/Apple push credentials (`google-services.json` /
  `GoogleService-Info.plist`) are added or changed.

Everyday JS/TS changes (screens, business logic, styling) hot-reload through
Metro exactly like before — no rebuild needed.

### Falling back to Expo Go (optional, limited)

Expo Go still works for **quick, no-native-change UI iteration** as long as
your Expo Go build happens to match SDK 54 (e.g. an older cached install, or
a version pinned via `expo.dev/go` — see
[Expo's version-mismatch guide](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/)
for how to install a specific SDK's Expo Go build on Android/simulators).
Remote push notifications never work in Expo Go regardless of SDK
(`docs/notifications.md`), so crew/parent push testing already required a
dev build before this fix. Force Expo Go explicitly when you have a matching
build with:

```bash
npm run start:go   # same as: expo start --go
```

This path is not required for normal development — the dev build above is
the supported, permanent workflow.

## Guardrail: `npm run verify:sdk`

`mobile/scripts/verify-expo-sdk.mjs` runs automatically before `npm start`,
`npm run android` and `npm run ios` (via `pre*` npm lifecycle hooks) and
fails loudly, before Metro even starts, if:

- `mobile/package.json`'s `expo` dependency drifts off the SDK-54 line, or
- the installed `node_modules/expo` isn't actually SDK 54 (e.g. a stale
  `npm install` picked up a different version), or
- `expo-dev-client` is removed from dependencies.

Run it directly any time with:

```bash
cd mobile && npm run verify:sdk
```

If it ever fails after `npm install`, the lockfile and `node_modules` have
drifted from the pinned versions — reinstall from the repo root
(`npm install`) rather than upgrading. Deliberately changing the pinned SDK
requires updating `PINNED_SDK_MAJOR` in that script **and** this document as
one reviewed change — not incidentally through a dependency bump.

## Dependency versions locked to SDK 54

All Expo/React Native packages in `mobile/package.json` are pinned to the
exact versions Expo publishes for SDK 54
(`https://raw.githubusercontent.com/expo/expo/sdk-54/packages/expo/bundledNativeModules.json`
is the source of truth Expo itself uses). Verify alignment any time with:

```bash
cd mobile && npx expo-doctor
```

(The "Check Expo config schema" and "React Native Directory" checks require
network access to `api.expo.dev` / the RN directory API and may show a
network error in sandboxed/offline environments — that's a connectivity
limitation of the check itself, not a project problem. The dependency
version checks run fully offline against the installed `node_modules`.)

Do **not** run `npx expo install --fix` or `npx expo upgrade` casually —
both can silently move packages to whatever the *latest* SDK's expected
versions are if run without `--fix`'s dependency-check context, or if a
future Expo CLI version changes defaults. Always check the diff of
`mobile/package.json` (major version numbers, especially `expo` itself)
before committing after running either command, and re-run
`npm run verify:sdk` immediately after.

## Production APK / app-bundle builds are unaffected

`expo-dev-client` only affects **debug/development builds** — EAS's
`preview` and `production` profiles in `mobile/eas.json` do not set
`developmentClient: true`, so `eas build --profile preview` and
`eas build --profile production` keep producing the same APK / app-bundle as
before, with no dev-client code, launcher screen, or dev-only permissions.
The only new profile is `development` (`developmentClient: true`), used
solely for `eas build --profile development` when you want an EAS-built dev
client instead of a locally-built one (`npx expo run:android`) — for example
to hand a dev build to a teammate without Android Studio/Xcode installed.

## Mobile ↔ backend connectivity (Next.js migration)

The mobile app's API base URL auto-resolves from the Metro dev server host
(`mobile/src/services/api.ts`, `api-env.ts`) — it needs no changes for the
web app's Next.js migration, because it always points at
`http://<host>:<API_PORT>/api/v1` where `<host>` is Metro's own dev-server
host and `<API_PORT>` defaults to `3001` (overridable via
`EXPO_PUBLIC_API_PORT`). The unified Next.js server in `web/` serves both the
web UI and the `/api/v1` REST routes plus the Socket.IO namespaces on that
same port, exactly as the previous backend did — verified working end to end
(auth, live tracking sockets, notifications) against `web`'s dev server
during this fix; see `mobile/README.md` → "Running" for the exact commands.
