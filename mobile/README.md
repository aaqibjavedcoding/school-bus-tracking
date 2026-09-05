# School Bus Tracking — Mobile App (Expo / React Native)

One React Native app for **drivers**, **conductors**, **parents** and **school
admins**. It talks to the existing API — now served by the `web` workspace as
Next.js route handlers under `/api/v1`, on the same port as the web UI — through
the shared `@school-bus-tracking/api-client` and the existing Socket.IO
namespaces. It contains **no backend logic of its own**.

## Roles & screens

| Role | Route group | Experience |
| --- | --- | --- |
| DRIVER / CONDUCTOR | `(crew)` | Today's trip (status `BOARDING → IN_PROGRESS → COMPLETED`), student manifest with board/drop, stops & live ETA, native GPS sharing incl. background |
| PARENT | `(parent)` | Dashboard & children, child detail, live bus map + ETA + stops, notification centre with unread badge |
| SCHOOL_ADMIN | `(admin)` | Today's operations board, trip cockpit (lifecycle incl. cancel, live map, ETA, arrivals, manifest), student directory, dispatch-from-assignment operations |
| SUPER_ADMIN | `/platform` | Notice screen — the platform console is a web workflow |

Driver and conductor deliberately share one crew implementation
(`src/features/crew`); `src/features/driver` and `src/features/conductor` only
re-export it.

## Running

```bash
# from the repo root
npm install
npm run build:packages

# start the server first — it serves BOTH the web UI and the API on port 3001,
# and the phone needs it running and reachable
npm --prefix web run dev

# then start the app
npm --prefix mobile start
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
npm --prefix mobile test            # node --test unit specs
cd mobile && npx expo export --platform android   # Metro bundle check
cd mobile && npx expo export --platform ios       # Metro bundle check
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
