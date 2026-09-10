# School Bus Tracking — Mobile App (Expo / React Native)

One React Native app for **drivers**, **conductors**, **parents** and **school
admins**. It talks to the existing API — now served by the `web` workspace as
Next.js route handlers under `/api/v1`, on the same port as the web UI — through
the shared `@school-bus-tracking/api-client` and the existing Socket.IO
namespaces. It contains **no backend logic of its own**.

## Roles & screens

| Role               | Route group | Experience                                                                                                                                                 |
| ------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DRIVER / CONDUCTOR | `(crew)`    | Today's trip (status `BOARDING → IN_PROGRESS → COMPLETED`), student manifest with board/drop, stops & live ETA, native GPS sharing incl. background        |
| PARENT             | `(parent)`  | Dashboard & children, child detail, live bus map + ETA + stops, notification centre with unread badge                                                      |
| SCHOOL_ADMIN       | `(admin)`   | Today's operations board, trip cockpit (lifecycle incl. cancel, live map, ETA, arrivals, manifest), student directory, dispatch-from-assignment operations |
| SUPER_ADMIN        | `/platform` | Notice screen — the platform console is a web workflow                                                                                                     |

Driver and conductor deliberately share one crew implementation
(`src/features/crew`); `src/features/driver` and `src/features/conductor` only
re-export it.

## Running

This app is on **Expo SDK 57** (`expo ~57.0.21`, React Native 0.86.3,
React 19.2.3), the same SDK line the Expo Go app in the Play Store / App Store
ships — so the plain QR-code workflow works with no extra setup. See
`docs/mobile-expo-sdk.md` for the version policy and the verified package
matrix.

```bash
# from the repo root
npm install
npm run build:packages

# start the server first — it serves BOTH the web UI and the API on port 3001,
# and the phone needs it running and reachable
npm --prefix web run dev

# then start the app and scan the QR code with Expo Go
npm --prefix mobile start
```

`npm --prefix mobile start` runs `scripts/expo-start.mjs`, which execs
`expo start --go` with `EXPO_NO_REDIRECT_PAGE=1`. **Both** parts are needed,
because this workspace installs `expo-dev-client` and that changes what the QR
code contains:

- Plain `expo start` auto-detects `expo-dev-client` and switches to
  **development-build mode**, whose QR is an
  `exp+school-bus-tracking://expo-development-client/…` deep link the Expo Go
  app **cannot open**.
- `--go` alone is _not_ enough either. The CLI keeps a web "interstitial"
  enabled whenever `expo-dev-client` is resolvable **and** the target is not a
  dev client — which is exactly the `--go` case — and then encodes _that page_
  into the QR:

  ```text
  › Choose an app to open your project at http://<lan-ip>:8081/_expo/loading
  › Metro: exp://<lan-ip>:8081
  ```

  Scanned with the phone camera, that URL has to load in the phone's browser
  before it can deep-link into Expo Go; scanned with Expo Go's own scanner,
  Expo Go is handed a web page instead of an `exp://` project URL. Either way
  it reads as "the link does not open".

`EXPO_NO_REDIRECT_PAGE=1` is the only switch that turns the interstitial off
(the CLI has no flag for it, and a `.env` file cannot carry it — `.env` is
gitignored), so the launcher sets it before the CLI boots. With it, the QR
encodes `exp://<lan-ip>:8081` and Expo Go opens the project directly:

```text
› Metro: exp://<lan-ip>:8081
Scan the QR code above to open in Expo Go.
```

`scripts/expo-start.spec.ts` (part of `npm test`) asserts the scripts keep
going through the launcher and that it keeps pinning `--go` +
`EXPO_NO_REDIRECT_PAGE=1`.

If the phone cannot reach your machine on the local network (guest WiFi, AP
isolation, different networks), use the tunnel instead and scan that QR:

```bash
npm --prefix mobile run start:tunnel   # launcher + --tunnel
```

A **development build** (`expo-dev-client`, still installed) is only needed for
things Expo Go cannot do — chiefly remote push notifications:

```bash
# ONE-TIME per device/emulator (see docs/mobile-expo-sdk.md)
cd mobile && npx expo run:android   # or: npx expo run:ios
npm run start:dev-client            # expo start --dev-client
```

The app auto-detects the API host from the Metro dev server, so a physical
phone on the same WiFi as your machine works out of the box (it uses the
machine's LAN IP, not `localhost`). Only override it when the API is not on
the same machine/network as Metro:

```bash
# cross-env keeps this working in Windows CMD/PowerShell as well as bash
npx cross-env EXPO_PUBLIC_API_URL=http://<your-lan-ip>:3001/api/v1 \
              EXPO_PUBLIC_API_PORT=3001 \
              npm --prefix mobile start
```

Requirements for a physical device: the phone and the machine running the server
must be on the same network, the API must be reachable from the phone
(`http://<your-lan-ip>:3001/api/v1/health` in a phone browser should answer),
and the OS firewall must allow inbound connections to port 3001.

Sign in with a school account (school tenant **code** or UUID + email +
password). The access token is kept in memory only; the refresh cookie lives
in the platform cookie jar, so the session survives app restarts.

## Driver/Conductor GPS

- Foreground sharing uses `expo-location`'s `watchPositionAsync`
  (`BestForNavigation`, 4 s / 10 m — above the API's 2.5 s throttle floor).
- Opt-in background sharing uses `startLocationUpdatesAsync` with an
  `expo-task-manager` task (Android foreground-service notification / iOS
  background location indicator). The active trip id is persisted so the task
  survives an OS headless relaunch.
- Every fix is validated against the shared `tripLocationUpdateSchema` before
  being emitted over `trip:location:update`. Fixes are never queued, replayed
  or synthesized — if the socket is down, the fix is dropped and counted.
- Sharing stops automatically when the trip completes/is cancelled and on
  sign-out.

## Quality gates

```bash
npm --prefix mobile run typecheck   # tsc --noEmit
npm --prefix mobile run verify:sdk  # confirms the project is still on the locked Expo SDK
                                    # and every Expo dep matches that SDK (offline)
npm --prefix mobile test            # node --test unit specs
cd mobile && npx expo export --platform android   # Metro bundle check
cd mobile && npx expo export --platform ios       # Metro bundle check
```

## Troubleshooting

### QR scan does nothing / Expo Go goes back to its project screen

The project and the Expo Go app on the phone are on **different SDK lines**.
Expo Go only opens a project whose `sdkVersion` matches its own, so a mismatch
looks like "nothing happened" rather than an error. Check both sides:

```bash
# what the dev server tells Expo Go:
curl -sS -H 'expo-platform: android' \
     -H 'Accept: application/expo+json,application/json' \
     http://127.0.0.1:8081/ | grep sdkVersion
# must equal the SDK of the Expo Go build installed on the phone (currently 57)
```

If it does not, the project drifted off the pinned line — run
`npm --prefix mobile run verify:sdk` (it fails with the exact offending
package) and reinstall from the repo root. Do **not** "fix" it by clearing
caches: the versions have to actually match. Full background in
`docs/mobile-expo-sdk.md`.

### QR scans but Expo Go does nothing — SDKs already match

Three causes, all independent of the SDK versions. **First check what the QR
actually contains** — the terminal tells you, on the line above the hint:

```text
› Choose an app to open your project at http://<lan-ip>:8081/_expo/loading   ← interstitial (bad)
› Metro: exp://<lan-ip>:8081                                                 ← what Expo Go wants
Scan the QR code above to open in Expo Go.
```

1. **The QR is the `_expo/loading` interstitial page, not an `exp://` link.**
   This is the one that `--go` does _not_ fix. The CLI enables that page
   whenever `expo-dev-client` is resolvable and the target is not a dev client,
   so with `expo start --go` in this workspace the QR encodes
   `http://<lan-ip>:8081/_expo/loading`. The phone then has to load a web page
   before it can hand the project to Expo Go — and if the browser cannot reach
   the dev server, or Expo Go's scanner is what read the code, nothing opens.
   Fix: use `npm --prefix mobile start` (it sets `EXPO_NO_REDIRECT_PAGE=1`, the
   only switch for this). If you type an `expo` command by hand, do the same —
   on Windows that means `set EXPO_NO_REDIRECT_PAGE=1` (CMD) /
   `$env:EXPO_NO_REDIRECT_PAGE=1` (PowerShell) before the command.
2. **The QR is a development-build link.** The Expo CLI's plain `expo start`
   auto-detects `expo-dev-client` and serves a QR of the form
   `exp+school-bus-tracking://expo-development-client/?url=…` — only a custom
   development build installed on the phone can open it, Expo Go ignores it
   (Android: "no app found" / nothing happens, iOS: an error toast). All Expo
   Go scripts here pin `--go`; if you ever type an `expo` command by hand, add
   `--go` too, or press `s` in the running CLI to switch targets.
3. **The phone cannot reach the machine over the LAN.** Expo Go scanned the
   `exp://<lan-ip>:8081` URL but the network keeps the two apart (guest WiFi
   with AP isolation, phone on mobile data, corporate network, host firewall
   blocking inbound 8081, …) — the scan succeeds and the load never finishes.
   Fix: `npm --prefix mobile run start:tunnel` (uses `@expo/ngrok`, already a
   devDependency here) and scan the `https://…ngrok…` QR instead. On Windows
   also allow Node.js through the firewall for **private** networks, and keep
   phone and machine on the same subnet (a router "guest" SSID isolates
   clients from each other).

### `TypeError: Cannot read property 'useId' of null` at startup

The app builds but crashes the moment it opens, with a stack that ends in
`useKeepAwake` → `expo/src/launch/withDevTools.tsx`:

```
ERROR  [TypeError: Cannot read property 'useId' of null]
  useId (node_modules/react/cjs/react.development.js)
  useKeepAwake (node_modules/expo-keep-awake/src/index.ts)
  WithDevTools (node_modules/expo/src/launch/withDevTools.tsx)
```

This means **two copies of React ended up in one bundle**. The workspace
installs two on purpose: `web` pins React 18.3.1 (Next 14) and npm hoists it to
`<root>/node_modules/react`, while mobile needs React 19.2.3 (what
`react-native` 0.86 peers on) so npm nests that copy in `mobile/node_modules`.
Metro resolves bare imports hierarchically first, so `require('react')` from a
hoisted package (`expo`, `expo-router`, `expo-keep-awake`, …) picks up React 18
while `react-native` and `mobile/app/**` pick up React 19. The renderer installs
its dispatcher on one copy and the hook reads it from the other — hence `null`.

`metro.config.js` pins a single copy via `resolver.resolveRequest`, which is the
only hook Metro consults before the hierarchical lookup. Check it is present,
then restart with a cleared cache — a stale Metro cache keeps serving the
two-React bundle:

```bash
npm --prefix mobile start -- -c
```

To confirm the fix, grep the dev bundle for React's runtime. Exactly **one**
path must appear (the `../node_modules/react` copy is the web app's React 18):

```bash
cd mobile && npx expo export --platform android --dev
grep -o '[.a-zA-Z0-9_/\-]*node_modules/react/cjs/react\.development\.js' \
  dist/_expo/static/js/android/entry-*.js | sort -u
# expected: node_modules/react/cjs/react.development.js
```

## Layout

```
app/                    expo-router routes (role groups + login + gate)
  (crew)/               shared driver+conductor tabs
  (parent)/             parent tabs + child detail
  (admin)/              school-admin tabs + trip cockpit
src/
  components/           UI kit (buttons, cards, badges, states)
  features/
    auth/               AuthProvider (cookie-backed refresh) + RoleGate
    crew/               today-trip loader, manifest, status actions, GPS
    parent/             notifications provider + pure state machine
    tracking/           live-trip observer hook, ETA views, connection chip
    map/                react-native-maps bus map
  hooks/                useLoad, useNetworkStatus
  lib/                  errors, format, geo (GPS mapping), roles
  services/             api client + base-URL/env resolution, session, socket
                       options/singletons
scripts/generate-assets.mjs   deterministic icon/splash generator
```
