# Mobile — Expo SDK Version Policy (READ BEFORE TOUCHING `mobile/package.json`)

## The rule

**This project is pinned to one Expo SDK line at a time. Right now that is
Expo SDK 57** (`expo ~57.0.21`, React Native 0.86.3, React 19.2.3,
`expo-router ~57.0.20`).

Expo Go — the app you scan the QR code with — is published **once per Expo SDK
release** and is updated by the Play Store / App Store independently of this
repo. **It only opens a project whose `sdkVersion` matches its own.** So the
project's SDK line is what decides whether `npx expo start` → QR → Expo Go
works at all:

| Project SDK | Expo Go SDK | QR scan result                                                    |
| ----------- | ----------- | ----------------------------------------------------------------- |
| same        | same        | app opens and runs                                                |
| different   | newer       | Expo Go refuses the project and drops back to its project screen  |

That mismatch is the reason a QR scan "does nothing / goes back a screen"
*when the two sides are on different SDK lines*, and it is fixed by moving the
project onto the SDK line Expo Go ships — **not** by clearing caches,
re-installing node modules, or any other workaround that leaves the versions
mismatched. (With matching SDK lines, a dead scan has three other causes — the
QR encoding the `/_expo/loading` interstitial page, a development-build QR being
scanned with Expo Go, and the phone being unable to reach the machine over the
LAN — all covered in `mobile/README.md` → Troubleshooting. The first is handled
automatically by `mobile/scripts/start-expo.mjs`, which every `npm start` script
here goes through.)

Keep the SDK pinned (one deliberate major at a time), and when Expo Go moves to
a new SDK, upgrade the whole mobile workspace to that SDK line in one reviewed
change — every `expo-*`, `react-native*` and `react*` package together, plus the
lockfile. A partial upgrade (e.g. `expo` on 57 while `react-native` or
`expo-router` is still on 54) is worse than no upgrade: it produces a bundle
whose runtime and native modules disagree, which fails at startup with errors
that look nothing like a version problem.

## Current, verified version matrix (SDK 57)

Every version below is the exact one Expo publishes for SDK 57 — the source of
truth is `expo/bundledNativeModules.json`, which ships inside the installed
`expo` package and is what `npx expo install --check` compares against:

| Package                                  | Version        |
| ---------------------------------------- | -------------- |
| `expo`                                   | `~57.0.21`     |
| `expo-router`                            | `~57.0.20`     |
| `expo-constants`                         | `~57.0.17`     |
| `expo-dev-client`                        | `~57.0.18`     |
| `expo-linking`                           | `~57.0.9`      |
| `expo-location`                          | `~57.0.16`     |
| `expo-notifications`                     | `~57.0.17`     |
| `expo-status-bar`                        | `~57.0.1`      |
| `expo-task-manager`                      | `~57.0.16`     |
| `@expo/metro-runtime`                    | `~57.0.15`     |
| `@expo/vector-icons`                     | `^15.0.2`      |
| `react` / `react-dom`                    | `19.2.3`       |
| `react-native`                           | `0.86.3`       |
| `react-native-web`                       | `~0.21.0`      |
| `react-native-maps`                      | `1.27.2`       |
| `react-native-safe-area-context`         | `~5.7.0`       |
| `react-native-screens`                   | `~4.26.0`      |
| `@react-native-async-storage/async-storage` | `2.2.0`     |
| `@react-native-community/netinfo`        | `12.0.1`       |
| `@react-native/virtualized-lists` (dev)  | `0.86.3`       |
| `babel-preset-expo` (dev)                | `~57.0.11`     |
| `metro-runtime` (dev)                    | `~0.84.5`      |

## Guardrail: `npm run verify:sdk`

`mobile/scripts/verify-expo-sdk.mjs` runs automatically before `npm start`,
`npm run android` and `npm run ios` (via `pre*` npm lifecycle hooks) and fails
loudly, before Metro even starts, if:

- `mobile/package.json`'s `expo` dependency drifts off the pinned SDK line, or
- the installed `node_modules/expo` is not on that line (stale install), or
- **any** Expo/React Native dependency — declared range *or* installed version —
  is not the one this SDK ships. This check runs fully offline against
  `expo/bundledNativeModules.json`, so it is the same comparison
  `npx expo install --check` makes, without needing the Expo API, or
- `@react-native/virtualized-lists` no longer matches the installed React
  Native (it is published in lockstep with RN), or
- `expo-dev-client` is removed from dependencies.

Run it directly any time with:

```bash
cd mobile && npm run verify:sdk
```

Deliberately changing the pinned SDK requires updating `PINNED_SDK_MAJOR` in
that script **and** this document as one reviewed change — not incidentally
through a dependency bump.

## Verifying an SDK upgrade end to end

```bash
# from the repo root
npm install                       # regenerates/resolves the lockfile
npm --prefix mobile run verify:sdk   # SDK line + every Expo dependency (offline)
cd mobile
npx expo-doctor                   # project health (needs network for 2 checks)
npx expo install --check          # optional: same alignment, via the Expo API
npm run typecheck                 # tsc --noEmit against the new RN/React types
npm test                          # node --test unit suites
npx expo export --platform android  # Metro bundles every route (no device needed)
npx expo export --platform ios
npm run start:clear               # clean cache, then scan the QR code with Expo Go
                                  # (use the npm script, not a bare `expo start -c --go`:
                                  # the launcher also sets EXPO_NO_REDIRECT_PAGE=1, without
                                  # which the QR encodes the /_expo/loading interstitial
                                  # page that Expo Go cannot open — see mobile/README.md)
```

The QR/manifest check, without a phone:

```bash
curl -sS -H 'expo-platform: android' \
     -H 'Accept: application/expo+json,application/json' \
     http://127.0.0.1:8081/ | grep sdkVersion
# expected: "sdkVersion":"57.0.0"   ← must match the Expo Go build on the phone
```

`npx expo-doctor`'s "Check Expo config schema" and "React Native Directory"
checks call `api.expo.dev` / `reactnative.directory`; they report a network
error in sandboxed or offline environments. That is a limitation of those two
checks, not a project problem — every other check (including all dependency
version checks) runs locally.

## Developer workflows

### Expo Go (default, zero setup)

```bash
npm --prefix web run dev          # API + web UI on :3001 (the app auto-discovers it)
cd mobile && npm start            # or: npx expo start -c to clear the Metro cache
```

Scan the QR code with the **Expo Go** app from the Play Store / App Store. It
opens the project directly because the project and Expo Go are on the same SDK
line.

One gotcha: because this workspace installs `expo-dev-client`, the Expo CLI's
plain `expo start` **auto-detects it and serves a development-build QR**
(`exp+school-bus-tracking://expo-development-client/…`), which the Expo Go app
cannot open — scanning it looks like "nothing happens". That is why every npm
script in `mobile/package.json` pins the Expo Go target explicitly
(`expo start --go`, including the derived `android` / `ios` scripts);
`npm run start:go` is the same command. If the phone cannot reach the machine
on the LAN, `npm run start:tunnel` (`expo start --go --tunnel`, backed by the
`@expo/ngrok` devDependency) serves a scannable tunnel URL instead.

### Development build (`expo-dev-client`)

`expo-dev-client` is still installed (`~57.0.18`). Use a development build when
you need something Expo Go cannot provide — most importantly **remote push
notifications** (they need your own FCM/APNs credentials, see
`docs/notifications.md`), or a native module that is not part of Expo Go:

```bash
cd mobile
npx expo run:android            # emulator, or add --device for a USB phone
npx expo run:ios                # simulator, or add --device for an iPhone
npm run start:dev-client        # expo start --dev-client
```

You only need to rebuild the native shell when a native dependency,
`app.json` config that affects native code, or push credentials change.
Everyday JS/TS changes hot-reload through Metro either way.

## SDK 54 → 57 migration notes (what actually changed)

Recorded because each item is a real API/config change, not a version bump:

- **React Native 0.86 removed `StyleSheet.absoluteFillObject`.** The frozen
  `StyleSheet.absoluteFill` object is the single replacement
  (`src/components/forms.tsx`, `src/features/map/BusMap.tsx`).
- **`newArchEnabled` is gone from the Expo config schema.** The new architecture
  is the only architecture now, so the key was removed from `mobile/app.json`.
- **React Native no longer installs `whatwg-url-without-unicode`.** RN 0.86
  ships its own `URLSearchParams` (which does implement `size`), so the mobile
  regression test that simulated the size-less polyfill now simulates it
  locally instead of importing a package the app no longer has
  (`src/services/list-query.spec.ts`). The API client's `querySuffix` still
  never reads `.size`.
- **Metro's single-React pin is still required.** The workspace installs two
  Reacts on purpose — `web` pins React 18.3.1 (Next 14) and is hoisted to
  `<root>/node_modules`, while mobile needs React 19.2.3 and npm nests it in
  `mobile/node_modules`. `metro.config.js` pins the mobile bundle to one copy
  through `resolver.resolveRequest`; `expo-doctor`'s "duplicate dependencies"
  check reports this (`react`/`react-dom` 19.2.3 + 18.3.1) and it is expected
  until the web app moves off React 18. Verify the bundle has exactly one copy
  with the grep in `mobile/README.md` → Troubleshooting.
- **The lockfile carried stale `apps/*` workspace entries** from the old
  directory layout. They were removed; the mobile subtree was re-resolved so
  `package.json` and `package-lock.json` agree (previously the lockfile still
  resolved `react-native` 0.81.5 while `package.json` asked for 0.86.3, which
  npm reported as `invalid` and never repaired on its own).

## Production APK / app-bundle builds are unaffected

`expo-dev-client` only affects **debug/development builds** — EAS's `preview`
and `production` profiles in `mobile/eas.json` do not set
`developmentClient: true`, so `eas build --profile preview|production` keep
producing the same APK / app-bundle as before.

## Mobile ↔ backend connectivity

The mobile app's API base URL auto-resolves from the Metro dev-server host
(`mobile/src/services/api.ts`, `api-env.ts`) — it always points at
`http://<host>:<API_PORT>/api/v1` where `<host>` is Metro's own dev-server host
and `<API_PORT>` defaults to `3001` (overridable via `EXPO_PUBLIC_API_PORT`).
The unified Next.js server in `web/` serves the web UI, the `/api/v1` REST
routes and the Socket.IO namespaces on that one port, so a physical phone on
the same WiFi reaches everything with no configuration.
