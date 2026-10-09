# Live Tracking Map

## Overview

How parents and school administrators see the bus move: the marker graphic, the
interpolation between GPS fixes, the heading, the camera, and what the map is
allowed to claim about a position.

Scope: the **observer** side — `mobile/` parent and admin tracking screens and
the `web/` live-tracking console — plus, since Session 2, the crew **Driver Trip**
screen (`mobile/app/(crew)/trip.tsx`). The driver's map reuses the same marker,
motion machine and follow-camera policy, with **crew** freshness semantics and a
device-local position instead of the observer's delivered one — see
[The Driver Trip map](#the-driver-trip-map), which also states what it is not
allowed to claim.

Nothing here changes how GPS is sampled, validated, delivered, stored or
authorised. `docs/mobile-tracking-reliability.md`, `docs/notifications.md`,
`docs/security.md` and the ETA/stop-arrival logic are untouched.

## Why this exists

Four things were untrue or unpleasant about the old map:

1. **Native had no smooth motion at all.** The marker jumped to each new fix,
   roughly every four seconds.
2. **Native re-fitted the whole route on every fix.** `BusMap` passed a
   _controlled_ `region` recomputed from `[stops, fix]`, so the camera was
   yanked back every few seconds and nobody could look at a stop.
3. **Web rotated an emoji.** The marker was `🚌` inside `transform: rotate(Ndeg)`.
   That glyph is a three-quarter front view, so the rotation was decoration —
   it never pointed anywhere.
4. **"Live" was ambiguous.** The connection chip describes the _socket_. A
   socket connected to a room that has not heard from the crew device in ten
   minutes is still "Live", and the map repeated that word next to a position
   that had gone quiet.

## Map provider policy

**Non-negotiable product rule: the map must never depend on an API key, a
credit card, billing or a metered tier.** Any provider whose map access
requires one of those is out — this is what rules out Google Maps, MapTiler,
Stadia, Geoapify and Mapbox, and what makes a tile URL that carries a `key=`
credential a metered provider in disguise. The map runs on open source over
OpenStreetMap data:

- **Engine** — mobile `@maplibre/maplibre-react-native` v11 (open source; the
  native MapLibre GL SDK is added to the generated projects by the config
  plugin in `mobile/app.config.js`) and web `maplibre-gl` v5
  (`web/package.json`), same vector engine on both surfaces.
- **Tiles** — **OpenFreeMap's public instance**, OpenStreetMap data:
  `https://tiles.openfreemap.org/styles/bright` (`DEFAULT_MAP_STYLE_URL` in
  `mobile/src/features/map/map-style.ts` and `web/src/features/map/map-style.ts`).
  No registration, no key, no card.
- **Attribution** — `OpenFreeMap © OpenMapTiles, Data from OpenStreetMap`,
  rendered by the engine itself: the `attribution` and `logo` props / control
  are on and stay on (OSM-derived tiles legally require both).

- **Labels** — the style has to show road names, area/place names and landmark
  labels, not just shapes, or a parent cannot tell which road the bus is on.
  Labels were never blocked by the provider: both public OpenFreeMap styles
  declare label layers and serve their `glyphs`
  (`https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`) and `sprite`
  from the **same host** as the tiles, so glyph PBFs arrive over `connect-src`,
  which already allows it, and **no CSP change was needed** — nothing is fetched
  through `font-src`. Two things were wrong in our own code, and both are fixed:

  1. **The camera.** `fitBounds` settles on the lowest zoom that contains every
     stop, which for a several-kilometre route is z10–z12 — where a street map
     omits minor roads and area names. The web map now floors its fit at
     `MIN_FIT_ZOOM` (`web/src/features/map/MapViewInner.tsx`).
  2. **The style.** The default moved from `liberty` to **`bright`**, the variant
     of the same free style family that keeps road, shield, neighbourhood, park
     and water labels across the mid zooms a tracking screen sits at. Same host,
     same attribution, still no key and no billing.

  The rule when choosing a style is unchanged: same free host, no key, no
  billing. A style that needs a token is not an option, label-rich or not.
- **Sprite** — the POI icons are **ours**, not a third party's:
  `scripts/generate-kidbus-sprite.mjs` renders `web/public/map-sprites/kidbus{.json,.png}`
  (+ the `@2x` twins) from vendored Maki v8.0.0 paths (Maki is CC0 — see
  `scripts/THIRD-PARTY-LICENSES.md`), and both styles name the same-origin path
  `/map-sprites/kidbus`. It is served from our own origin on web, and from the
  app's own API origin on native (Session 7 below), so the CSP's existing
  `'self'` covers it — **no header was widened** for it.
**The scale path changes ONE variable.** When traffic outgrows the public
instance, self-host OpenFreeMap
([hyperknot/openfreemap](https://github.com/hyperknot/openfreemap) serves the
same OSM-derived tiles from your own infrastructure) and set
`EXPO_PUBLIC_MAP_STYLE_URL` (mobile) and `NEXT_PUBLIC_MAP_STYLE_URL` (web) to
the self-hosted style URL. Those variables are https-only —
`map-style.ts` (pure, spec-pinned, `resolveMapStyleUrl(env)`) rejects anything
else with one warning and falls back to the public default — and **no app code
changes**: the engine, the markers, the camera policy and this document's rules
all work unchanged.

**Enforcement** — `mobile/scripts/map-provider-policy.spec.ts` (part of
`npm --prefix mobile test`) and `web/scripts/map-provider-policy.spec.ts`
(part of `npm --prefix web run test:web`) fail if a banned provider name
(`leaflet`, `react-leaflet`, `tile.openstreetmap.org`, Google Maps, Mapbox,
MapTiler, Stadia, Geoapify) or a keyed tile URL (`key=` / `api_key=`) reappears
in `package.json`, `next.config.js` / `app.config.js`, `security-headers.js` or
anywhere under `src/`. The scanner allows a casual "no Leaflet" comment in
pure modules and allows `maps.google.com` deep links (navigate) while banning
`maps.googleapis.com` / `google.maps`.

## Road routing

The dashed stop-to-stop line is the **fallback**, not the product. Behind
`GET /api/v1/routes/:id/geometry` sits a self-hosted routing engine that
computes the road-following polyline (plus turn-by-turn legs) for a route's
ordered stops, and both maps draw it when it exists (`status: 'ok'`). The
whole path is **free and keyless**, exactly like the map tiles:

- **Engine** — [OSRM](https://github.com/Project-OSRM/osrm-backend), the
  open-source routing engine (BSD-2), in its official Docker image
  `ghcr.io/project-osrm/osrm-backend` (pinned version tag). No account, no
  API key, no card, no metered tier — the same product rule as the map
  provider policy, and `web/src/server/config/routing.config.ts` refuses to
  boot on a `ROUTING_SERVICE_URL` that carries a `key=` credential.
- **Map data** — Geofabrik's free OpenStreetMap extracts
  (`download.geofabrik.de`), cut to the region the buses drive.
- **Graph build** — free, on a laptop (`scripts/osrm-graph.sh`: download →
  optional bbox cut with the free osmium-tool image → `osrm-extract` →
  `osrm-partition` → `osrm-customize`) **or** on the free GitHub-hosted
  runner (`.github/workflows/osrm-backfill.yml`, manual dispatch — this
  repository is public, so `ubuntu-latest` is free). No Docker is needed on
  the operator's machine for the runner path.
- **Cache forever, engine need not run 24/7** — the computed geometry is
  stored in `route_geometries`, keyed by `(route_id, stops_hash)` where the
  hash covers the ordered stop ids and coordinates. Reads are served from
  that cache with zero engine calls; the engine is only needed when a
  route's stop list changes (a save/reorder schedules a fire-and-forget
  recompute) or when a backfill runs. A deployment can therefore run the
  engine for an hour a month and serve road geometry all month.
- **Monthly extract refresh** — re-run the graph build and the backfill
  monthly (Geofabrik refreshes daily): new roads and closures change the
  routes drivers actually take. **The extract must cover every place the
  buses drive** — outside it OSRM answers `NoRoute` and the app falls back
  to the dashed line.
- **Honest fallback** — with `ROUTING_SERVICE_URL` blank/unset (the default),
  routing is disabled: the endpoint answers `{ status: 'unavailable' }` (HTTP
  200, not an error), no engine is ever contacted, and both maps draw the
  dashed stop-to-stop line with its "planned stop order, not the road
  route" caption. The app boots and behaves exactly as it did before.
- **Where it can run** — OSRM loads the graph into RAM (a city-sized graph
  is a few hundred MB; `infrastructure/docker-compose.yml` caps the service
  at 2 GB). A **512 MB Render free instance cannot host OSRM** — run the
  engine on a small VM / home server / a paid Render instance and point
  `ROUTING_SERVICE_URL` at it, or use the free GitHub runner for compute
  and keep only the cache in the app (the backfill writes rows to a
  deployment whose engine is off).

### Three ways rows get filled

Every route's geometry is filled by one of three paths. They write the same
cache rows, so they can be mixed freely.

| Path | Who runs it | Credential | Reach | Needs a live engine? |
| --- | --- | --- | --- | --- |
| **A. Lazy** | Automatic, on the first read of a route whose geometry is missing | None — any school user's read (SCHOOL_ADMIN, DRIVER, CONDUCTOR or PARENT) | One route, on demand | Yes — `ROUTING_SERVICE_URL` must point at a reachable engine; otherwise the read stays `unavailable` |
| **B. Per-school backfill** | `scripts/osrm-backfill.mjs` with `ADMIN_MODE=school` (default), or the workflow with `mode = school` | One **SCHOOL_ADMIN** sign-in | One school per run | No — the engine runs on the runner, not in the app |
| **C. Platform backfill** | `scripts/osrm-backfill.mjs` with `ADMIN_MODE=platform`, or the workflow with `mode = platform` (default) | One **SUPER_ADMIN** sign-in | **Every school, one run** | No — the engine runs on the runner, not in the app |

Path A needs no credential and no runner, but it only works where the engine
is reachable from the app. Paths B and C compute on the free runner and write
straight through the API, so the app's own deployment can keep its engine
switched off. **Path C is the one to use.** A SUPER_ADMIN sign-in is not tied
to a school, so one run covers every school, and the run prints a per-school
summary.

Path C's API surface (all SUPER_ADMIN only, audited with the route's own
school):

- `GET /api/v1/admin/routes/geometry/missing?page&limit` — the routes whose
  geometry is missing for their **current** stop list, across all schools
  (paginated, `limit` 1–100), with each route's located stops and per-school
  counts. A route with changed stops is missing; a route with a cached row
  for its current stops is not listed; a route with fewer than two located
  stops is counted as unlocated and not listed.
- `PUT /api/v1/admin/routes/:routeId/geometry` — stores the engine's road
  route. The server pins the cache key (`stops_hash`) from the route's
  **current** located stops; the client never sends it.
- `POST /api/v1/admin/routes/:routeId/geometry/recompute` — drops the cached
  rows for a route so the next read recomputes them.

The school endpoints (`/api/v1/routes/:id/geometry`) are unchanged: a
SCHOOL_ADMIN still sees only its own school's routes, and a SUPER_ADMIN gets
403 there by design.

### Install the platform backfill (operator recipe)

The workflow file is kept in the repository at
`infrastructure/github-workflows/osrm-backfill.yml`. It is installed at
`.github/workflows/osrm-backfill.yml` on `main` through the GitHub web UI
(the Arena GitHub App cannot push to `.github/workflows/`):

1. Open `infrastructure/github-workflows/osrm-backfill.yml` on `main`, click
   **Raw**, and copy everything.
2. Open `.github/workflows/osrm-backfill.yml` on `main`, click the pencil
   (**Edit this file**), select all, paste, and **commit directly to `main`**
   (or open a PR from your own account).
3. Under **Settings → Secrets and variables → Actions**, create
   `OSRM_PLATFORM_EMAIL` and `OSRM_PLATFORM_PASSWORD` (the SUPER_ADMIN
   account's sign-in).
4. **Actions → "OSRM route-geometry backfill" → Run workflow**, with
   `mode = platform`, `api_base = https://kidbus.onrender.com/api/v1`.
   Read the per-school summary in the run's step summary.

**New routes later = re-run platform mode; only missing routes are filled.**
Routes already cached are never touched, so the re-run is cheap and safe.
Re-run monthly as well, so the extract stays current.

The same run can be done locally (for example to test against a local API)
with `ADMIN_MODE=platform`; see `infrastructure/README.md` → "OSRM routing
engine".

Deployment and day-2 operations: `infrastructure/README.md` → "OSRM routing
engine". Workflow file and install notes: `infrastructure/github-workflows/README.md`.
Write path contracts: `PUT /api/v1/routes/:id/geometry` and
`POST /api/v1/routes/:id/geometry/recompute` (school) in
`web/src/server/api/routes.ts`; the `/api/v1/admin/routes/…` endpoints in
`web/src/server/api/admin.ts`.

## Style failure, retry and the offline fallback (deep-fix R3)

The style JSON is one small fetch, but it is the fetch a cold radio on mobile
data fails. Before R3 that one failure was a verdict: a permanent
`map.issue.styleLoad` line and a dead map until the app restarted. The policy
now, all of it in `mobile/src/features/map/`:

1. **Bounded retry, twice.** The JS style fetch (`use-map-style.ts`) runs
   under `runWithBackoff` with the shared schedule `[2 s, 5 s, 15 s]`
   (`map-style-recovery.ts`, pure — the sleeper and the attempt are injected
   ports, spec'd with `node --test` mock timers). If the style then fails on
   the **engine's** side (`onDidFailLoadingMap`), `planStyleLoadFailure`
   schedules a bounded sequence of style **re-sets** on the same schedule —
   `restyleForRetry` re-issues the inspected style with a root-level
   `metadata` nonce, because the engine bridge forwards
   `JSON.stringify(mapStyle)`, and an identical string is a prop-diff no-op:
   only a changed string actually reloads the style. One recovery runs at a
   time; in total a transient blip is recovered within ~22 s, worst case.
2. **Recovery clears the line.** A style that genuinely finishes loading
   (`onDidFinishLoadingMap`) clears `styleLoad` from the diagnostics store;
   a successful glyph probe (or a style that declares nothing to label)
   clears `glyphs` (`clearMapIssue`, `map-diagnostics.ts`). Lines say what is
   wrong **now**, not what once went wrong, and each rendered line ends with
   its machine-readable code — `(styleLoad)` — so a field screenshot names
   exactly what failed.
3. **The offline fallback.** When the bounded budget is spent on every front,
   the map swaps to `OFFLINE_FALLBACK_MAP_STYLE`: a bundled, frozen,
   version-8 style with **zero network references** — no sources, no glyphs,
   no sprite — painting one neutral background. It is deliberately a *base*,
   not a disguise: the stops, the bus marker, the accuracy circle and the
   status panel are all React Native overlays that keep working over it, and
   the `(styleLoad)` line stays up over it because the fallback loading is
   not the tiles coming back (`notifyStyleLoaded` refuses to clear while the
   fallback is showing). A later remount re-runs the whole pipeline, so the
   real style returns when the network does.

Nothing here changes the provider policy: the fallback is bundled with the
app, needs no account and no key, and introduces no provider.

## Architecture

One **pure state machine** decides what to draw; each platform only renders it.

| Module                                                                                                | Responsibility                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mobile/src/features/map/bus-motion.ts`<br>`web/src/features/map/bus-motion.ts`                       | The motion state machine: coordinate validation, jitter gate (floor 8 m, R4), heading resolution, shortest-angle rotation, cadence-derived tween length, gap/jump snapping, halt and reset. The mobile copy additionally takes the display-only `snapToRoute` port (below). **Pure, clock-injected, no React.** |
| `mobile/src/features/map/route-snap.ts`                                                             | R4 snap-to-route: nearest-segment great-circle projection of an accepted fix onto the drawn stop-to-stop polyline, bounded to `SNAP_TO_ROUTE_MAX_OFFSET_M` (45 m). **Display only; pure, spec'd with zig-zag fixtures.** Mobile-only for now — the web map has no route snapping yet (deliberate divergence, see below). |
| `mobile/src/features/map/follow-camera.ts`<br>`web/src/features/map/follow-camera.ts`                 | The follow-camera reducer: who owns the camera, when to fit, when to pan, when to stop following. Pure.                                                                                                         |
| `mobile/src/features/map/tracking-presentation.ts`<br>`web/src/features/map/tracking-presentation.ts` | Honest live / last-known / outdated / approximate derivation. Pure.                                                                                                                                             |
| `mobile/src/lib/geo.ts` (existing) <br> `web/src/features/map/geo.ts` (new mirror)                    | Haversine distance and compass bearing.                                                                                                                                                                         |
| `mobile/src/features/map/BusMarkerGraphic.tsx`                                                        | The top-view bus: the bundled `assets/bus-marker.png` sprite (@1x/@2x/@3x, hand-downsampled) inside the pinned 26×42 dp box.                                                                                     |
| `mobile/src/features/map/BusMarker.tsx`                                                               | The leaf marker component: the only thing that re-renders per frame.                                                                                                                                            |
| `mobile/src/features/map/useBusMarkerMotion.ts`                                                       | Frame loop, lifecycle, reduced motion, cleanup.                                                                                                                                                                 |
| `mobile/src/features/map/follow-camera-controller.ts`                                                 | The camera's imperative half: fit once per trip, centre-only follow pans, throttle, gesture attribution, resume. Pure, over a two-method port.                                                                  |
| `mobile/src/features/map/useFollowCamera.ts`                                                          | The React binding for that policy — **one** camera implementation, used by the observer map _and_ the driver map.                                                                                               |
| `mobile/src/features/map/BusMap.tsx`                                                                  | Native observer map: status panel, follow control, stop pins, accuracy circle.                                                                                                                                  |
| `mobile/src/features/crew/crew-map-presentation.ts`                                                   | What the driver's map may say about a device-local position, under crew freshness windows. Pure.                                                                                                                |
| `mobile/src/features/crew/DriverTripMap.tsx`<br>`…/DriverTripMap.web.tsx`                             | The Driver Trip card: stops, this device's own position, one honest status line. The `.web` file is the dependency-free `react-native-web` fallback.                                                            |
| `web/src/features/map/bus-marker-icon.ts`                                                             | The top-view bus as inline SVG, plus the icon geometry as plain data (`BUS_MARKER_WIDTH/HEIGHT`, `BUS_MARKER_SVG`). Runtime-free, so its geometry is directly testable; no `DivIconOptions` import.               |
| `web/src/features/map/MapViewInner.tsx`                                                               | Web map: same policy over MapLibre GL JS (`maplibre-gl` Marker, GeoJSON route + accuracy ring).                                                                                                                 |
| `mobile/src/hooks/useReducedMotion.ts`<br>`web/src/features/map/usePrefersReducedMotion.ts`           | OS reduce-motion preference, live.                                                                                                                                                                              |

`bus-motion.ts` and `follow-camera.ts` are **mirrored** between `mobile/` and
`web/` rather than shared through a package, because that is how this repository
already handles client libraries (`src/lib/format.ts`, `errors.ts`, `roles.ts`,
`api-cache.ts`, `socket-auth.ts` all exist in both apps). Both suites pin the
identical threshold values (including the R4 `jitterMinM = 8` floor) so a
one-sided edit fails a test rather than shipping two buses that move
differently. The **one deliberate divergence**: the mobile copy carries the
extra display-only `snapToRoute` port (R4 fixed the zig-zag there, where the
field report came from); the web copy has none yet, and gains it when the
console's map asks for it — the shared thresholds stay pinned either way.

The pure/adapter split is deliberate: everything that decides _what to draw_ is
runtime-free and unit-tested; only the thin platform adapters touch
MapLibre (`@maplibre/maplibre-react-native` on mobile, `maplibre-gl` on web).
That is also why `bus-marker-icon.ts` exports `busIconOptions()` as plain data
and leaves the one-line marker creation to `MapViewInner.tsx` (`maplibregl.Marker`).

The **one genuinely shared** piece is the definition of "live":
`GPS_LIVE_WINDOW_MS` / `GPS_STALE_WINDOW_MS` live in
`@school-bus-tracking/shared-types`, imported by both clients _and_ by the crew
controller (`SERVER_ACK_LIVE_WINDOW_MS` / `SERVER_ACK_STALE_WINDOW_MS` are
aliases of the same two constants, not copies). Sessions 1 and 2 kept those in
sync with a spec that compared the two modules; Session 2 removed the drift
instead of detecting it. What is deliberately **not** aliased is
`LOCAL_FIX_FRESH_WINDOW_MS` — same duration today, different question, and
collapsing it would make a change to the observer window silently change what
"my GPS is working" means on the driver's screen.

### Consumers touched

| Surface                                     | Change                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `mobile/app/(parent)/tracking.tsx`          | Passes `tripId` + `connection`; dropped the hardcoded `busTitle` so it localises.                                                 |
| `mobile/app/(admin)/tracking.tsx`           | Passes `tripId` + `connection`.                                                                                                   |
| `mobile/app/(admin)/trips/[id].tsx`         | Passes `tripId` + `connection`.                                                                                                   |
| `web/src/features/tracking/TripTracker.tsx` | Passes `connection`; status line now distinguishes live from last known and withholds speed on stale data; adds the route notice. |
| `web/src/features/map/types.ts`             | `connection` added to `MapViewProps`.                                                                                             |

`mobile/src/features/map/BusMap.web.tsx` (the dependency-free `react-native-web`
fallback, which lists stops instead of drawing a map) is unchanged.

## The vehicle in the 3D camera (web)

The 2D camera keeps the flat top-down marker described in "The marker". The
pitched **3D** camera does not: a `maplibregl.Marker` is an HTML element that
MapLibre keeps viewport-aligned (`pitchAlignment: 'auto'`), so in a tilted
scene it stands up facing the camera — a billboard, read on screen as a flat
sticker floating over the map — and the engine additionally drives its inline
`style.opacity` (`Marker._updateOpacity`, `opacityWhenCovered` defaults to
`0.2`), which is how it could also read as a ghost. No CSS can turn a DOM
element into a solid object inside the map's WebGL scene.

So in 3D the bus is drawn **in** the scene, by the engine we already ship:
`web/src/features/map/bus-3d.ts` builds a small extruded **mesh** — four
wheels, a chassis skirt, the amber lower body, a dark window band, the roof, a
nose block and bumpers, plus a roof beacon — as one GeoJSON `FeatureCollection`
rendered by one `fill-extrusion` layer (`sbt-bus-3d-body`) with per-feature
`base`, `height` and `color`. It is fully opaque (`fill-extrusion-opacity: 1`,
vertical gradient on) and depth-tested against the 3D buildings, so it is a
real volume, not an icon. The flat marker is hidden (`.is-hidden-by-3d-bus`)
only once that mesh actually exists, so "no bus at all" is never an outcome.

Cost: none. No three.js, no glTF asset, no model host, no extra tile or API
provider — the geometry is computed from the live fix and uploaded exactly
like the route line.

- **Anchoring.** Vertices are built in a metric bus-local frame (x = right,
  y = forward), rotated by the heading, then converted to degrees relative to
  the fix. The origin is the GPS coordinate at every heading and zoom.
- **Heading.** The mesh is rebuilt each animation frame from the same rendered
  position/heading `bus-motion.ts` gives the flat marker, so rotation follows
  the device course (or the derived bearing above the displacement/speed
  thresholds) and motion stays smooth between fixes without inventing any.
- **Size.** `busLengthMeters` converts a target on-screen length through the
  mercator metres-per-pixel at the current latitude/zoom, clamped between a
  real bus (12 m) and 260 m, so the vehicle stays readable when the camera
  pulls back without becoming a city block. The mesh is rebuilt on `zoom`.
- **Staleness** is a colour change (slate), never transparency.

App layers (`route`, `trail`, `accuracy`, `stops`, the bus) are moved back to
the top of the layer stack whenever the 3D building extrusion is inserted, so
the buildings can never bury the stops.

## The marker

A **top-view school bus**, nose up, school-bus yellow with a dark outline, a
windshield band on the nose end and a darker rear — so the facing direction
is unambiguous at rest, not only while moving.

The native graphic is the bundled sprite `mobile/assets/bus-marker.png`
(with `@2x` and `@3x` files, so a cheap mdpi phone decodes a crisp 26 px
file instead of resampling a big one). The master was AI-generated with the
image tool, cut out onto a real alpha channel, and hand-downsampled per
density by `scripts/make-bus-marker.py`; the three tiny files are committed
(plus the master in `mobile/assets/gen/`), so no pipeline runs at build time
and nothing is fetched. The web marker remains inline SVG. Deep-fix R4
replaced the earlier drawn-views bus: at 26 px a few 5 px strips never read
as a vehicle, and the sprite fixes exactly that — while keeping the geometry
below, which is what made heading meaningful in the first place.

Two properties matter:

- **nose-up means heading 0° is north with no rotation applied**, so a heading
  reading on this marker actually means something;
- **it is symmetric about its own centre**, so rotating it about its centre
  keeps the vehicle centre on the GPS coordinate.

Both map surfaces anchor at the vehicle centre: `anchor="center"` on the
MapLibre `ViewAnnotation` (native), `anchor: 'center'` / CSS translate on the
MapLibre `Marker` (web, `maplibregl.Marker` with centred element). The box is
still 26 × 42 dp inside its circumscribing rotation square
(`BUS_MARKER_ROTATION_BOX`), pinned in `bus-marker-invariants.spec.ts`,
which also parses the PNG IHDRs so a mangled or dropped asset fails the
suite instead of shipping blurry.

### One implementation on both platforms

The old platform-provider library split the implementation: its `Marker.icon`
**and** `Marker.rotation` were documented _"iOS: Google Maps only"_, so this app
once shipped Google Maps on Android (key injected by `app.config.js`) and Apple
Maps on iOS, with a rotation strategy per platform. MapLibre ends that split:
the bus is a **`ViewAnnotation` carrying the same child view on Android and
iOS** — one code path, and the turning is a `transform: rotate(heading deg)` on
the graphic's root view, which is ordinary view layout the engine applies
identically on both platforms.

The rotation is still driven by the pure motion machine (heading resolution,
shortest-angle path, the 3 km/h gate), and the annotation is committed through
`refresh()` **only when the heading actually changes** (the
committed-refresh guard in `BusMarker.tsx`, spec-pinned) — the per-frame value
is presentation state, and re-committing the annotation layer on every frame
would buy nothing.

Two runtime boundaries remain, and both are handled the same way as before:

- **Expo Go** — the map engine is a custom native module (MapLibre), which the
  Expo Go shell does not carry **on any platform**. The mobile map surfaces
  decide at runtime (`mapSurfaceMode`, `src/features/map/map-surface-mode.ts`)
  between rendering the map and showing a labelled "needs a development build"
  panel instead of a blank canvas. Nothing is misconfigured — there is simply
  no engine in the Go app — and a development build renders the map everywhere
  (see [Map provider policy](#map-provider-policy): no key is involved).
- **Web** — MapLibre `Marker` carrying inline SVG (`BUS_MARKER_SVG`); rotation
  is a `style.transform` on an inner `.bus-marker-rotor` element, applied via
  `setBusIconHeading(host, heading)` which accepts the marker host or its
  element (guarded for `HTMLElement` absence in tests).

The native graphic is the bundled `assets/bus-marker.png` sprite (a
generated top-down 3D-style school bus, hand-downsampled to @1x/@2x/@3x by
`scripts/make-bus-marker.py`, committed so there is no pipeline at build time),
inside the same pinned 26×42 dp box and circumscribing rotation square as
before. The web marker stays inline SVG - one design language, no network
request and no new native dependency (`react-native-svg` is deliberately not
added).

### Content-Security-Policy

`web/security-headers.js` now pins **OpenFreeMap** — `https://tiles.openfreemap.org`
in both `img-src` and `connect-src` (the MapLibre engine fetches style JSON,
vector tiles, glyphs and sprites via `connect-src`) and `worker-src blob:` for
the MapLibre worker. `buildContentSecurityPolicy()` emits
`style-src 'self' 'unsafe-inline'` (required by `maplibre-gl.css`) and
`img-src 'self' data: blob: https://tiles.openfreemap.org` plus
`connect-src ... https://tiles.openfreemap.org`. `tile.openstreetmap.org` is
no longer allowed — OSMF's policy forbids heavy production use and the console
now uses vector tiles. This covers the marker three ways over:

- The SVG is **markup inside the MapLibre Marker container**, not an `<img src>`
  or an external file, so `img-src` does not govern it at all.
- It contains no `<script>`, no `on*` handler, no `url(...)`, no `<image href>`,
  no `foreignObject` and no `xlink:href` — nothing `script-src` would block.
- Rotation is applied through the CSSOM (`rotor.style.transform = ...`), which
  CSP does not intercept. Inline `style` attributes are blocked by a strict
  `style-src`, so keep using the CSSOM here rather than `setAttribute('style', …)`.
  (`'unsafe-inline'` is present anyway, but the CSSOM route stays correct if that
  is ever tightened.)

**If the tile host ever changes** (self-host), `NEXT_PUBLIC_MAP_STYLE_URL` and
the CSP pin must change together: `CSP_EXTRA_IMG_SRC` / `CSP_EXTRA_CONNECT_SRC`
can add a self-hosted origin without a wildcard, but the default
`tiles.openfreemap.org` entry stays as the documented public fallback.
`resolveMapStyleUrl(env)` in `map-style.ts` is the single place that reads the
style URL and enforces https-only with a warn-once fallback.

Stops are a deliberately different species from the bus: MapLibre has no
teardrop pin of its own, so a stop is a **flat, slate, un-rotating dot**
(a `ViewAnnotation` carrying a small `View` — `StopMarker.tsx`), rendered
_before_ the bus so it draws beneath it. A stop and the bus are different at a
glance and in a screenshot.

## Animation

`createBusMotion()` holds one rendered position, one heading and **exactly one
tween slot**. There is no queue, by design: a fix arriving mid-tween discards
the running tween and starts a new one **from wherever the marker currently is
on screen**, so the bus can never fall several updates behind or replay a burst.

Ordering of decisions inside `push(fix, now)`:

1. Invalid coordinate → ignored. `(0, 0)` is rejected as the null-island
   sentinel an uninitialised GPS stack reports.
2. `recorded_at` at or before the newest accepted fix → ignored. This is the
   existing timestamp semantics, and it is what stops a late REST snapshot from
   dragging the marker backwards past a newer socket push (both are loaded in
   parallel in `useLiveTripTracking`).
3. First fix → **snapped immediately**. A parent waiting for the bus sees it the
   instant it exists.
4. Displacement inside the accuracy-derived jitter gate → **held**. The anchor
   does not move, so a slow creep still accumulates until it clears the gate;
   real movement is never hidden.
5. Gap over `gapSnapMs`, or an implied speed over `maxPlausibleSpeedMps` →
   **snapped**. Animating either would show the bus racing across town.
6. Halted (stale/offline) → **snapped**. Creating a tween here would be worse
   than a jump: `sample()` refuses to advance a tween while halted, so the frame
   loop would spin on a position that never moves.
7. Reduced motion → snapped.
8. Otherwise → tween from the current rendered position.

`sample(now)` is the only thing that produces an interpolated coordinate, and
that value is used for **one purpose**: where to draw the marker. It is never
written into tracking history, ETA, attendance, notifications or any payload —
`RenderedBusPosition.source` carries the raw, unmodified values for anything
that reports speed, accuracy or "last updated".

### Lateral damp and snap-to-route (deep-fix R4)

GPS at its ordinary precision wanders a few metres sideways between fixes, and
drawing that faithfully was the field-visible zig-zag. Two layers now stop it:

1. **Damping floor 8 m** — an accepted fix inside
   `max(8 m, accuracy × 0.5)` of the anchor is noise: the marker holds still
   (a parked bus stays parked; the freshness clock still advances, so "last
   updated" keeps telling the truth).
2. **Snap-to-route for display** — a fix that clears the gate is projected
   onto the **drawn route polyline** (nearest segment, great-circle
   cross-track math, `route-snap.ts`) and the tween targets the *projected*
   point, so lateral noise on a straight road disappears into the line the
   bus is visibly following. The derived heading reads between *projected*
   positions, so the nose points along the road, not along the wobble.

The honesty rules are the same as interpolation's, stated once:

- **projected coordinates are presentation only** — never written into
  history, ETA, arrivals, attendance or notifications (the tween and the
  projection both live inside the marker; `source` keeps the raw fix);
- **bounded** — a fix farther than `SNAP_TO_ROUTE_MAX_OFFSET_M` (45 m) from
  the route is drawn **raw**: a bus genuinely off the planned legs (detour,
  depot) must not be glued to the line;
- **the line is the drawn line, not a road claim** — the polyline connects
  the stops in planned order and is already labelled "planned stop order —
  not the road route"; snapping the marker to it does not turn it into one.

Frames are capped at `FRAME_MIN_INTERVAL_MS = 50` (~20 fps), shared by both
platforms. A bus at 40 km/h covers about half a metre in 50 ms, which is
sub-pixel at tracking-card zoom.

### Per-frame cost

- **Native** — the frame state lives in `BusMarker`, a leaf component that
  renders a single `ViewAnnotation`. The screen, the `<Map>`, the route line and
  the stop markers never see it. `MapSurface` is `React.memo`'d so the 5 s
  status tick cannot reach the native map either.
- **Web** — there is no React state per frame at all: position and rotation are
  applied imperatively (`marker.setLngLat`, one `style.transform` via
  `setBusIconHeading`). The marker is created once (`new maplibregl.Marker`) and
  moved via `setLngLat` from the frame callback, so no React prop change yanks it
  mid-flight.
- **Camera** — moved imperatively from the frame callback on both platforms, so
  following the bus re-renders nothing.

### Native marker updates we did not adopt

The old library exposed imperative shortcuts for moving a marker without a
React render. MapLibre's annotation API does not — and that is the right
shape for this app, because the motion machine owns the rendered position and
a second, imperative path to the same marker would be a second answer to
"where is the bus". The update path is therefore exactly one: the leaf
re-render, bounded as follows.

| API                                    | what it actually is                                                                                                                               | why it is (not) used                                                                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ViewAnnotation#refresh()`             | The one imperative handle on the annotation: forces the annotation layer to re-commit.                                                            | **Used, guarded.** Called only when the committed heading changes (the committed-refresh guard in `BusMarker.tsx`, spec-pinned), never on every frame — re-committing the annotation layer 20×/s would buy nothing the transform does not already do. |
| `setNativeProps`                       | Still exposed by RN 0.86.3; a direct-manipulation escape hatch that "will not participate in future diff process" (the type's own doc).           | Not used: it would move the marker outside the React tree, i.e. outside the motion machine's rendered position — the exact bug class this document exists to prevent.                                                                                 |
| an imperative "set coordinate" command | **Does not exist** in `@maplibre/maplibre-react-native`'s annotation API (the old library's `setCoordinates` command has no MapLibre equivalent). | Nothing to hold in reserve: the React re-render of the leaf **is** the imperative surface, and the per-frame cost table above is what it costs.                                                                                                       |

**What would change the answer:** a profile showing dropped frames _inside the
map_ on the low-end Android the checklist targets — evidence that the ~20 fps
leaf re-render is a real cost. At `FRAME_MIN_INTERVAL_MS = 50` for a single
`ViewAnnotation` that has not been observed, and it cannot be observed on this
machine (see "What was verified automatically"). Any future shortcut would
have to keep reduced motion, the freshness halt, the heading rules and the
per-trip reset intact — it is not a drop-in swap.

## Thresholds and why

All centralised in `MOTION_THRESHOLDS` and pinned by tests in both workspaces.

| Constant                                             | Value                | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `headingMinSpeedKmh`                                 | 3                    | Below walking-pace-plus, a GPS course is Doppler noise inside the accuracy circle. It also covers the one unavailable-heading case that cannot be fixed at the source: Android's `Location.getBearing()` returns `0.0` when the fix has no bearing, and expo-location does not export `hasBearing()`, so that `0` is indistinguishable in JS from a true north course. Session 2 removed the _other_ case — iOS's `-1` is now omitted instead of uploaded as `359` (see limitations). |
| `headingMinDisplacementM`                            | 12                   | Below this, `atan2` over two points inside one accuracy circle can swing 180° between fixes — a parked bus visibly spinning.                                                                                                                                                                                                                                                                                                                                                          |
| `jitterMinM` / `jitterMaxM` / `jitterAccuracyFactor` | 8 / 30 / 0.5         | Gate = half the reported accuracy radius, clamped to `max(8, accuracy × 0.5)`. The floor is the R4 damping bound: GPS wander of a few metres between fixes is noise and must not move the marker (a bus at 20 km/h covers ~22 m per fix, safely outside). The **ceiling is the honesty bound** — a coarse fix must not freeze the bus for hundreds of metres.                                                                                                                                                                                                                                                                                                   |
| `animationCadenceFactor`                             | 0.8                  | Tween = 0.8 × observed cadence, leaving ~20 % headroom so a slightly late fix does not arrive mid-tween. The old hardcoded 900 ms against a 2.5–4 s cadence is what made the web bus lurch and then sit.                                                                                                                                                                                                                                                                              |
| `animationMinMs` / `animationMaxMs`                  | 500 / 3000           | Floor: below a couple of frames a tween just flickers. Ceiling: bounds how far the marker can lag behind the newest real fix.                                                                                                                                                                                                                                                                                                                                                         |
| `gapSnapMs`                                          | 45 000               | >10× the nominal cadence (device watch 4 s, server throttle floor 2.5 s), so a genuine cadence can never trip it.                                                                                                                                                                                                                                                                                                                                                                     |
| `maxPlausibleSpeedMps`                               | 33                   | ≈120 km/h. A school bus does not exceed it, so a larger implied jump means the _fix_ moved (tunnel exit, urban-canyon multipath, coarse network fix), not the bus.                                                                                                                                                                                                                                                                                                                    |
| `cadenceMinMs` / `cadenceMaxMs` / `cadenceSmoothing` | 1 000 / 30 000 / 0.4 | EWMA over accepted-fix intervals, bounded so one anomalous gap cannot distort the tween length.                                                                                                                                                                                                                                                                                                                                                                                       |
| `FRAME_MIN_INTERVAL_MS`                              | 50                   | ~20 fps; see above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `FOLLOW_CAMERA_THROTTLE_MS`                          | 500                  | Decoupled from both the fix cadence and the frame rate: per-frame camera steps vibrate against the marker's own tween, per-fix steps lurch.                                                                                                                                                                                                                                                                                                                                           |
| `FOLLOW_CAMERA_MIN_SHIFT_METERS`                     | 5                    | Below the size of a stop, so an idling bus does not vibrate the camera.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ZOOM_GESTURE_TOLERANCE`                             | 0.02                 | Above platform region-report noise, below one zoom step.                                                                                                                                                                                                                                                                                                                                                                                                                              |

Freshness (`tracking-presentation.ts`):

| Constant                      | Value   | Source                                                                                                                                                 |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LIVE_WINDOW_MS`              | 30 000  | `GPS_LIVE_WINDOW_MS` from `shared-types`; the crew controller's `SERVER_ACK_LIVE_WINDOW_MS` is an alias of the same constant, so the two cannot drift. |
| `STALE_WINDOW_MS`             | 120 000 | `GPS_STALE_WINDOW_MS`; `SERVER_ACK_STALE_WINDOW_MS` aliases it.                                                                                        |
| `ACCURACY_APPROXIMATE_METERS` | 50      | The same line `gpsSignalTier` in `mobile/src/lib/geo.ts` already calls "weak".                                                                         |
| `ACCURACY_CIRCLE_MAX_METERS`  | 500     | A 5 km circle on a 280 dp map is a solid orange screen, not information; past this the uncertainty is stated in words instead.                         |

## Follow camera

The one rule: **the camera belongs to the person looking at the map, not to the
GPS stream.**

- **Fit** — once per trip, on the first moment stops or a fix exist, over the
  stops _and_ the bus. Never on a GPS update.
- **Pan** — while following, centre only. Zoom is never changed by a GPS update,
  on either platform (a partial camera is merged with the current one:
  `MKMapCameraWithDefaults:existingCamera:` on iOS,
  `CameraPosition.Builder(map.getCameraPosition())` on Android, and MapLibre's
  `panTo` / `easeTo({center})` on web does not touch zoom unless asked).
- **Explore** — any genuine user gesture suspends following immediately, and it
  stays suspended until the user presses **Follow bus**. It never snaps back on
  its own.
- **Recenter** — restores follow mode and centres on the bus, _preserving the
  zoom the user chose_. Changing zoom there would be a second surprise.
- **Trip switch** — resets to following with the fit dropped, so the new route
  is framed and the new bus does not tween in from the old one's position.
- **Foreground resume** — reconciles with the position that is current now. It
  never replays the movement that happened while backgrounded.

### Telling a user gesture from our own camera move

This is the part that is easy to get wrong:

- **MapLibre (native)** — the region events report a `userInteraction` flag on
  **both platforms** (Android and iOS), which the binding reads as
  `isGesture: view.userInteraction === true`. A missing or false flag is read
  as "not a gesture", never as "probably a gesture". The pure controller keeps
  its zoom-delta fallback as the provider-independent second signal (sound by
  construction because follow mode never zooms); because MapLibre reports zoom
  rather than a latitude delta, the binding feeds it a latitude-span proxy —
  `360 / 2^zoom`, the world's latitude span at that zoom — which is monotonic
  in zoom, so its relative change is exactly the relative zoom change the
  fallback compares.
- **MapLibre GL JS (web)** — gesture detection uses `originalEvent` on
  `movestart` / `zoomstart` / `rotatestart` / `pitchstart` / `dragstart`:
  a truthy `originalEvent` is a genuine user gesture, a falsy one is our own
  `fitBounds` / `panTo` / `easeTo`. `fitBounds` still animates, so the check is
  synchronous (no `requestAnimFrame` window). While following, the camera is
  moved via `easeTo({center, duration})` with `isInternalCameraUpdate` guard
  so our own pans do not suspend follow. Pinch-zoom, drag, rotate and pitch all
  suspend follow immediately.

**Previous Leaflet trade-off removed:** the old ~1.5 s suppression window
  after `fitBounds` (Leaflet dispatches `zoomstart` from `requestAnimFrame`)
is gone — MapLibre reports `originalEvent` synchronously.

## Honest status

The map reports **two independent facts** and never merges them:

1. **Socket state** — `live` / `reconnecting` / `offline`, from the existing
   `ConnectionState` and `ConnectionIndicator`.
2. **GPS freshness** — `live` (≤30 s) / `stale` (≤120 s) / `outdated`, from the
   age of the newest fix the server actually delivered (`received_at`).

Consequences, all enforced by `deriveTrackingPresentation`:

- A connected socket with a four-minute-old fix reads "Live" on the chip and
  "Last known" on the map. Neither is wrong, and together they are the truth.
- The socket state never softens or sharpens the freshness verdict.
- When the position is not live, **travel animation stops** and the marker is
  frozen and labelled. A marker that keeps sliding while the label says "last
  known" is the exact lie this exists to prevent.
- **Speed and heading are never described as current on non-live data.**
- Coarse accuracy is drawn as a circle _and_ stated in words, rather than
  implying a precise road position.

Freshness ages without new data via a 5 s tick (`useNow` on native, an interval
on web) — otherwise "Live position" would stay on screen forever over a position
that went quiet.

## The Driver Trip map

`mobile/app/(crew)/trip.tsx` renders one supplementary card above the existing
next-stop card: the trip's stops and **this device's own position**. It is not
turn-by-turn navigation, nothing about a trip depends on it, and it never needs
interaction while the vehicle is moving. The next-stop card and its external
**Navigate** hand-off, attendance, trip-status and SOS controls are unchanged.

### The marker's data source, stated once

| candidate source                               | what it would prove                | used    |
| ---------------------------------------------- | ---------------------------------- | ------- |
| **local device fix** — `sharing.stats.lastFix` | this phone has a position          | **yes** |
| server-acknowledged position                   | the school received a position     | no      |
| the observer socket (`useLiveTripTracking`)    | what other screens are being shown | no      |

The driver's question on this screen is "where am I on my run". The newest,
most accurate answer available on the device — and the only one that still works
with no network — is the fix the phone itself just produced. The server's copy is
at least one throttled round trip older (2.5–4 s), and the crew lifecycle does
not retain the acknowledged coordinates at all, so drawing it would show the
driver where the server _thinks_ they are.

Neither source is allowed to stand for the other:

- the local fix is **not** evidence of delivery. `deriveDriverMapPresentation`
  **copies** `schoolSeesLive` from `tracking-status.ts` instead of deriving its
  own, so the GPS strip above the map stays the single authority for "the school
  can see the bus", and no string on the card is worded as "the school sees you";
- the panel has **two lines, and the split is the point.** The _position_ line
  always answers "how current is what you are looking at" (`Updated {time}`, or
  the same `gps.noFix` the strip shows). The _delivery_ line exists only to deny
  a possible misreading, and it is absent exactly when the school can see the
  drawn position. Collapsing the two — the obvious first design — is how "not
  delivered yet" ends up hiding whether the phone's GPS is alive at all, which
  is the moment that number matters most;
- when the position has not been delivered the delivery line says so in words
  (`driverMap.note.notDelivered`), says the link is down when that is the reason
  (`driverMap.note.offline`), says sharing is off when _that_ is the reason (a
  frozen marker must say why it is frozen: `driverMap.note.notSharing`), and says
  the school's copy is **older** — not missing — when the last acknowledgement is
  merely stale (`driverMap.note.schoolStale`). A two-minute-old acknowledgement
  is not the same fact as no acknowledgement, so it does not get the same
  sentence;
- the source is labelled at all times (`driverMap.source`, "Your device"), so the
  chip can never be mistaken for the server's copy of the position.

### Crew semantics, not observer semantics

| question                                       | constant                                                                  | module                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| is this device producing fixes right now?      | `LOCAL_FIX_FRESH_WINDOW_MS` (30 s)                                        | `crew/tracking-status.ts`                                   |
| has the server acknowledged anything?          | `SERVER_ACK_LIVE_WINDOW_MS` (30 s) / `SERVER_ACK_STALE_WINDOW_MS` (120 s) | `crew/tracking-status.ts` (aliases of the shared constants) |
| how old is a position _someone else_ is shown? | `LIVE_WINDOW_MS` / `STALE_WINDOW_MS`                                      | `map/tracking-presentation.ts`                              |

Three different questions that currently share two durations, kept as three
separate constants on purpose. `LOCAL_FIX_FRESH_WINDOW_MS` is deliberately _not_
an alias of the shared window: a change to how long a delivered position stays
live for a parent must not silently change what "this phone's GPS is working"
means for a driver.

Travel animation follows the same rule as the observer map, with the crew's
definition of current: the marker glides only while a fix inside
`LOCAL_FIX_FRESH_WINDOW_MS` exists **and** tracking is still running. `stopped`,
`services-off`, `permission-blocked` and `revoked` freeze it, because nothing is
being produced any more, and a frozen marker is never left unlabelled. When the
local fix is only old — not stopped — the note falls back to the same
`gps.lastUpdate` ("Updated {time}") line the strip uses, so one number never has
two spellings on one screen.

### What it reuses, and what it does not add

- **Camera** — `useFollowCamera`, the same binding the observer map uses, over
  the same pure `follow-camera.ts` policy: fit once per trip over stops _and_ the
  bus, centre-only pan while following, any user gesture suspends following until
  **Follow bus** is pressed, and returning to the foreground reconciles with the
  current position instead of replaying missed movement.
- **Marker** — the same `BusMarker` / `BusMarkerGraphic` / `useBusMarkerMotion`
  leaf, so there is one bus shape, one heading rule and one frame cap in the app.
  `BusMarker` now takes the motion machine's own `BusMotionFix` rather than the
  observer's `LiveFix`: the observer fix carries a server `received_at`, and a
  device-local fix has no such field and must not pretend to have one.
- **No new plumbing** — no GPS watcher and no socket subscription. The
  position is `useCrewLocationSharing().stats.lastFix`, published by the existing
  crew lifecycle, which now also keeps the `heading`/`speed` of the payload it
  just built so the marker can point along the direction of travel without a
  second watch. The stops come from the `listRouteStops` call the next-stop card
  already made.
- `DriverTripMap` is imported **by path**, never through the crew barrel, so
  the headless entry points (`location-task.ts`) cannot pull the map engine
  (`@maplibre/maplibre-react-native`) into the background-task graph;
  `DriverTripMap.web.tsx` is the dependency-free `react-native-web` fallback,
  mirroring `BusMap.web.tsx`.
- **The next stop's arrival zone** (deep-fix R1) — the map draws one more
  shape, and only one: a **dashed amber ring** around the *next* stop, sized
  by the stop's **effective** radius (`max(stored radius, 50 m)` —
  `crew/arrival-zone.ts` mirrors the server's
  `ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS` floor). It is the same circle the
  arrival engine evaluates, so a driver standing inside the ring is standing
  inside the zone that records the stop — the field defect this fixes was a
  zone nobody could see and no phone could hit. Styled apart from the GPS
  accuracy circle on purpose: the zone is a dashed darker-amber ring centred
  on the **stop**; the accuracy circle is a solid light-amber ring centred on
  the **bus**. Next stop only, so a ten-stop route stays readable; the
  caption under the map (`map.arrivalZoneNotice`) names what the ring means.
  The next-stop card adds the textual twin: an "inside arrival zone"
  indicator (pure client math over the server's own `eta.latest` fix) plus,
  when the bus is inside and the stop is held, the reason from
  `GET /trips/:id/progress` `arrival_diagnostics` (departure gate / cooldown
  / confirming evidence `1/2`). Both are display only — the engine decides
  arrivals, the screen never feeds back.

Interpolated coordinates are presentation only here too: the tween is never
written into history, ETA, attendance or notifications.

The one thing the card does persist is the **last fix itself** — see
[The last fix survives a restart](./mobile-tracking-reliability.md#the-last-fix-survives-a-restart-and-stays-honest-about-its-age).
It is stored by the lifecycle, not by the map, scoped to the same trip and
account as the resumable context, and restored with its original timestamp so
it can only ever be drawn as a *last known* position.

### On-map controls (field-defect batch)

A real run produced four presentation defects on this card: the fullscreen
modal opened 0 dp tall, there was no way to zoom with one hand, an Android
pinch scrolled the screen instead of the map, and the primary **Follow bus**
button turned following *off*. They are fixed in `map-controls.ts` (zoom step
and bounds, the three follow-control states), `GestureIsland` +
`scroll-lock.ts` (Android gesture ownership inside the `Screen` ScrollView)
and `DriverTripMap`'s `wrapFull` style. The camera policy in
`follow-camera.ts` was **not** changed — it was deciding correctly; the screen
was describing it badly.

Full rationale, the reused GPS-strip CTA for the no-fix state, and what still
needs a physical phone: [`crew-map-field-fixes-handoff.md`](./crew-map-field-fixes-handoff.md).

### Navigation is a hand-off, not a routing engine (PR 3)

The map in the app **never routes**. Road routing needs a directions service,
and every free-to-start one is metered — so the driver's turn-by-turn comes
from the map application the phone already has, opened with a link:
`src/lib/navigation.ts` builds
`https://www.google.com/maps/dir/?api=1&destination=…&waypoints=a|b|c&travelmode=driving&dir_action=navigate`
(no `origin`, so the map app uses the live position) and, on Android, the free
`google.navigation:q=lat,lng` intent for a single stop. `app.config.js`
declares only the *visibility* entries that make those links openable from a
release build (Android 11+ `<queries>`, iOS `LSApplicationQueriesSchemes`) —
no URL, no key, no account. The vendor's `comgoogle…` scheme stays banned.

The driver now also gets a compact local **next maneuver strip** immediately
above those buttons. It reads the nearest upcoming maneuver from the cached
route leg that ends at the authoritative next stop, using the engine's
`distance_meters` and showing the following maneuver as a small preview. It
does not calculate a route, estimate distance from GPS, or fall back to a
straight line: if the legs, the current position, or the route identity are
not usable, the strip is absent. The external deep link stays because it is
still the correct owner of live turn-by-turn guidance: it can recalculate
around traffic, obey the device's map preferences, and provide voice guidance
without adding a directions SDK, a second routing service, or a new backend
cost. The strip is orientation at a glance; **Navigate** remains the explicit
hand-off for full guidance.

This is why the planned amber line on the driving card is still labelled as
**stop order, not the road route**: the only live guidance session lives in the
map app, one tap away. Pinned by `src/lib/navigation-directions.spec.ts` (order,
chunking, the 2048-character ceiling, invalid coordinates, the Android intent
format) and by the provider policy spec.

### The two lines, the badge and the driving card (next-stop pass)

The card is now the map a driver reads at a stop, and every new element obeys
the same honesty rule the panel already had:

- **The next stop is an input, never an opinion.** `nextStopId` arrives from the
  screen's `deriveTripProgressForTrip(...).nextStop?.id` — the same derivation
  the navigation card, the kids card and the voice read (T1). The map cannot
  develop a second opinion about progress: `crew-map-presentation.ts`
  `driverStopMarkerKind(stopId, nextStopId)` returns `'next'` for exactly that
  one stop (`'plain'` otherwise, and everywhere when there is no next stop), and
  `StopMarker` renders the `'next'` variant as a near-double amber pin with a
  **NEXT** badge chip (`map.nextBadge`), mirroring the web map's
  `'plain' | 'next' | 'current'` kinds.
- **The trail (dotted green) is the only "driven" line.** It is built by
  `trip-map-geometry.ts` `buildTrailLine` from the fixes the server recorded
  (`GET /trips/:id/location/history`, up to 200), scoped to the trip on screen
  by `historyFixesForTrip` — a history payload naming another trip draws
  nothing, exactly like `etaForTrip` for ETAs. Fewer than two valid fixes, no
  line.
- **The planned legs (solid amber) are the order, not the road.**
  `buildPlannedLegsLine` draws stop-to-stop straight segments from the next stop
  to the end of the route, skipping stops without usable coordinates (the same
  rule the ETA service applies to arrivals). The caption under the map
  (`map.plannedNotice`) states it in words: planned stop order, not the road
  route. There is **no** routing engine behind this line (see Backlog in
  `docs/crew-navigation-audit.md`); the caption exists so the eye cannot assume
  one. The whole-route context line stays, dimmed to neutral.
- **Captions only describe lines that are on the map** — each of
  `map.plannedNotice` / `map.trailNotice` / `map.routeNotice` renders only while
  its line exists, so the legend can never describe a drawing that is not there.
- **The driving line sits on the card**: `Next: {stop} · {distance} · ~{eta}`
  (`driverMap.nextSummary`, all three the server's numbers, `—` when one is
  absent) renders above the map box, so the fact survives tile failure. A
  **Full screen** control opens the same map in a modal (re-mounting the engine,
  which also re-reads the trail at that moment).
- **Follow is explicit.** A `Follow: on/off` pill toggles the frame stream to
  the camera off entirely (the gate is a ref read in the frame callback, so
  turning it off re-renders nothing native); turning it back on re-centers. The
  existing **Follow bus** pill still appears only when a user gesture suspended
  following.

`trip-map-geometry.ts` is pure and React-free (`trip-map-geometry.spec.ts`,
registered in `mobile/package.json`); the map components decide colours and dash
patterns only. The same facts render in the `.web` fallback as text (next-stop
line, NEXT marker on the stop rows, planned-order caption) — no map engine.

## Reduced motion

`AccessibilityInfo.isReduceMotionEnabled()` + `reduceMotionChanged` on native and
`matchMedia('(prefers-reduced-motion: reduce)')` on web — both built in, no new
dependency. When on, every fix snaps to its true position. Toggling it while a
tween is running cancels the tween immediately rather than letting it play out.

## Localisation

New keys, in all three dictionaries (`en` / `hi` / `mr`): `map.followBus`,
`map.followingA11y`, `map.exploringA11y`, `map.status.live`,
`map.status.lastKnown`, `map.status.noLocation`, `map.status.approximate`,
`map.updatedAt`, `map.staleNote`, `map.offlineNote`, `map.routeNotice`,
`map.noCoordinates`, `map.busA11y`, `map.stopA11y`.

`i18n-parity.spec.ts` (0 missing, 0 extra, no empty values, identical
placeholders) and `i18n-clipping.spec.ts` (per-key budgets for the five chip
labels, plus the global growth ceiling) both pass. All map text uses
`typography.fontSizes.sm` (14 px) because `legibility.spec.ts` enforces a 13 px
app-wide floor.

## Accessibility and small screens

- Touch target for **Follow bus** is ≥44 dp native and 40 px web.
- The marker view is hidden from screen readers; its information is carried by
  the callout and by real text in the status panel.
- The follow state is announced through an `aria-live` / `accessibilityLiveRegion`
  element, because "the camera is following" is otherwise invisible.
- Map controls sit top-left (status) and top-right (follow) on native because
  MapLibre renders the OSM attribution line and its logo in the bottom corners
  (legally required for OSM-derived tiles, always on via the `attribution` and
  `logo` props); the web console keeps its MapLibre attribution bottom-right
  (`attributionControl: {compact:false}`) with the same legal requirement.
- The route notice renders **below** the map, not over it, for the same reason.

## Known limitations

1. **There is no road matching, and none is planned for this scope.** Two
   sparse GPS points are joined by a straight line in the tween, so on a
   hairpin the bus can still briefly appear to cut a corner. The R4
   snap-to-route is a *display damp onto the drawn planned line*, not road
   matching: it bounds itself to 45 m of that line, leaves off-route fixes
   raw, and its coordinates never reach tracking data (see "Lateral damp and
   snap-to-route").
2. **The dashed line between stops is not a route.** It connects stop
   coordinates in sequence. It is not road-calculated and not the path the bus
   drove. The map says so (`map.routeNotice`).
3. **Sparse GPS bounds everything.** With a 4 s watch and a 2.5 s server
   throttle, the marker is interpolating across 2.5–4 s of unobserved motion.
   Smoother motion would require a shorter sampling interval, which trades
   directly against battery and network — deliberately **not** changed here.
4. **The heading is only as good as its input.** A device that never reports a
   usable course falls back to a bearing between fixes, which is unavailable
   while stopped; the marker then holds its last heading rather than inventing
   one.
5. **Unavailable headings are omitted, not normalised** (fixed in Session 2).
   `buildLocationPayload` used to wrap _every_ finite heading into `[0, 360)`,
   and `expo-location` reads iOS's `CLLocation.course`, which is `-1` when the
   course is invalid — so a stationary device could upload `heading: 359`, a
   confident claim of due north. Headings that are negative, non-finite or
   absent are now **omitted** from the payload, and a real `0°` (due north) is
   preserved. The regression tests cover the sentinel, other negatives, `NaN`,
   `Infinity`, `0`, and the `450 → 90` wrap.
   **Known residual, Android only:** `Location.getBearing()` returns `0.0` for a
   fix with no bearing and expo-location does not export `hasBearing()`, so that
   value is indistinguishable in JS from true north. It is kept rather than
   guessed at (suppressing `0` would delete real headings), and the marker's
   ≥3 km/h speed gate is what keeps it out of the presentation. Stated here
   rather than papered over.
6. **Freshness uses `received_at` (server clock) against the device clock.**
   Significant client/server clock skew would shift the live/last-known boundary
   by that skew. The crew status module has the same property.
7. **The attribution line and the logo are legally required and cannot be
   removed** to gain corner space — which is why the map's own controls live
   top-corner on native and the route notice renders below the map.
8. **Web console tile host — now resolved.** The web console previously used
   `https://tile.openstreetmap.org` (raster, OSMF low-volume only). It now uses
   the same OpenFreeMap public instance as mobile (`maplibre-gl` v5 +
   `https://tiles.openfreemap.org/styles/bright`, no key, no billing), with
   `img-src` + `connect-src` + `worker-src blob:` pinned in
   `web/security-headers.js` and `resolveMapStyleUrl(env)` reading
   `NEXT_PUBLIC_MAP_STYLE_URL` (https-only). No wildcard, no billing anywhere.
9. **No paid routing, Directions, Roads, traffic, map-matching or tracking API
   was added.** The engine swap to MapLibre + OpenFreeMap on both surfaces
   introduced no account, key or billing — the policy section above pins that —
   and attribution is rendered by the engine on both mobile and web.

## Manual verification checklist

**Device acceptance is pending.** The automated checks pass (see "What was
verified automatically"), but the checks below need hardware, and none of them
has been run in this pass.

What was available in the environment this change was prepared in: Node 22 and
npm, and nothing else that can render or run the app. There is **no** Android
SDK, no `adb`, no emulator, no Xcode or simulator, no browser engine and no
Playwright — and the sandbox's network reaches the npm registry but not
`tiles.openfreemap.org`, so even a headless browser could not have drawn the
web tiles without extra config. Nothing here is being reported from a device,
an emulator or a browser, and **an `expo export` bundle is not a device test**:
it exercises the bundler, not background location, the MapLibre tile renderer,
a low-end GPU or an OS permission dialog.

Run it in a **development build** (Expo Go has no map engine on any platform —
the map surfaces show the labelled panel instead), on a low-end Android and on
an iPhone, and in a browser on the web console. Record what you actually see;
if a step cannot be reproduced, say so rather than ticking it.

**Map engine (development build, parent Track screen)**

- [ ] Tiles load; the attribution line ("OpenFreeMap © OpenMapTiles, Data from
      OpenStreetMap") and the logo are visible in the bottom corners.
- [ ] The bus marker and the stop dots draw over the tiles; the map's own
      controls (top corners) cover nothing that is required to be visible.
- [ ] **Cartography at z13–16** (Session 7): a colony/suburb/neighbourhood name
      is visible, at least one road under the bus is named, and a school /
      place-of-worship / hospital icon draws with a label beside it. On web,
      the sprite request is `/map-sprites/kidbus.json` + `.png` on our own
      origin (Network tab, no third-party sprite host); on a development build
      it is the API origin's own copy.

**Straight road**

- [ ] Bus glides between fixes instead of teleporting.
- [ ] No lateral zig-zag between fixes: the marker tracks the drawn route
      line instead of redrawing the GPS wander (R4).
- [ ] Nose points along the direction of travel.
- [ ] Marker stays the same screen size while zooming.

**Turns**

- [ ] Marker rotates through the short way (north-crossing turns included).
- [ ] On a bend the rendered path hugs the drawn route line; a sharp corner
      may be cut tightly mid-tween — this is expected, not a bug.

**Bus stopped at a pickup**

- [ ] Marker does not drift or creep.
- [ ] Marker does **not** rotate while stationary.

**Poor GPS (tunnel, urban canyon, indoors)**

- [ ] "Approximate" appears and an accuracy circle is drawn for coarse fixes.
- [ ] An implausible jump snaps rather than racing across the map.
- [ ] No accuracy circle when the radius exceeds 500 m; the uncertainty is
      stated in words.

**Internet off / on**

- [ ] Socket chip says offline; the map says "Last known".
- [ ] Animation stops while offline; the marker stays put and labelled.
- [ ] Airplane mode (no network at all): the tiles simply do not load, but the
      stops, the marker and the freshness text still render — graceful, not
      blank.
- [ ] On reconnect, the next fix animates normally from the last known point.

**Background / foreground**

- [ ] No frames run while backgrounded (profiler or battery).
- [ ] On return, the marker is at the current position, not replaying.

**User pans the map while updates arrive**

- [ ] The map does **not** snap back while the user is dragging.
- [ ] "Follow bus" appears; tapping it recentres and keeps the user's zoom.
- [ ] Pinch/scroll zoom also suspends following.
- [ ] (Web, known) a pinch within ~1.5 s of the initial fit may not suspend it.

**Trip switch and logout**

- [ ] Switching trips refits the new route; the bus does not tween in from the
      old bus's position.
- [ ] After logout, no frames keep running and no stale marker survives.

**Low-end Android**

- [ ] Steady frame rate with the map visible; no jank on the parent screen.
- [ ] Battery draw while the screen is open for 10 minutes.

**Expo Go (any platform)**

- [ ] The map surfaces show the labelled "needs a development build" panel —
      no blank canvas, nothing that looks misconfigured.
- [ ] GPS sharing still works as usual (foreground); the trip flow is
      unchanged.

**Reduced motion**

- [ ] With the OS setting on, the bus snaps between fixes (native and web).
- [ ] Flipping the setting while a trip is live takes effect immediately.

**Parent/admin, mobile and web consistency**

- [ ] The same bus shape and colours on all four surfaces.
- [ ] Status wording agrees; ETA and stop lists are unchanged.
- [ ] Hindi and Marathi labels fit their chips without clipping.

**Driver Trip screen**

- [ ] The driver starts boarding: the card shows tiles and this device's own
      marker at the device's position.
- [ ] The map card sits above the next-stop card, and neither pushes the other
      off screen on a small phone.
- [ ] The chip reads "Your device" — the driver can tell whose position it is.
- [ ] With the socket connected and acknowledging, the note is the same
      "Updated {time}" line the GPS strip shows.
- [ ] Turn mobile data off mid-trip: the strip says the link is down, the card
      says the school cannot see the position, and the marker keeps moving —
      the device still knows where it is, and that difference is intended.
- [ ] Stop sharing: the marker freezes and the note says sharing is off.
- [ ] Pan the map: **Follow bus** appears; tapping it recentres without changing
      the zoom the driver chose.
- [ ] Drive a straight road, then a turn: the nose follows the direction of
      travel, and there is no spinning while waiting at a stop.
- [ ] The card is readable at a glance while parked; nothing on it requires
      interaction while moving.
- [ ] Hindi and Marathi: the chip and the note fit the panel without clipping.

## What was verified automatically

Run on the branch this change was prepared on, with no device attached:

| command                                                | result                                                                                                                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build:packages`                               | pass                                                                                                                                                                                                    |
| `npm run typecheck`                                    | pass — all packages, `web`, `mobile`                                                                                                                                                                    |
| `npm run lint`                                         | pass (`eslint . --max-warnings 0`)                                                                                                                                                                      |
| `npm test`                                             | pass — 1 871 server tests, 338 web tests, 829 mobile tests                                                                                                                                              |
| `npx next build`                                       | pass **after** `npm run build:server`; the raw command fails on a checkout without `web/dist`, because every App Router handler `require()`s the compiled server tree (see `web/server-build-check.js`) |
| `npx expo export --platform android`                   | pass — bundle only, no device                                                                                                                                                                           |
| `npm run test:sim` (`mobile/`)                         | pass — offline, push, feedback and tracking simulations, including the two new driver-map cases in `tracking-recovery.sim.spec.ts`                                                                      |
| `node scripts/mutation-check-live-tracking-guards.mjs` | 8/8 structural guards caught the mutation they exist to catch, and each mutated file was restored and re-verified green                                                                                 |

New behavioural coverage added by this change:

- `mobile/src/features/crew/crew-map-presentation.spec.ts` (14) — the driver
  map's honesty contract: the source is always the device, `schoolSeesLive` is
  copied and never invented, the position age survives every degraded case,
  animation stops when the fix is old or sharing is off, a stale acknowledgement
  is worded as "older" rather than "never delivered", and every line resolves
  through the real translations.
- `mobile/src/features/crew/tracking-recovery.sim.spec.ts` (28, +2) — drives the
  real crew lifecycle against a fake socket: with GPS working and the server
  never acknowledging, the map still draws the device's fix while
  `schoolSeesLive` stays false and the note never says "delivered"; and a `-1`
  heading never reaches the wire or the marker.
- `mobile/src/features/map/follow-camera-controller.spec.ts` (13) — the camera
  policy both maps now share: fit once per trip, centre-only pans with no `zoom`
  key on the call, throttling and the 5 m shift guard, gesture attribution and
  the zoom-tolerance fallback, resume, and the trip-change reset.
- `mobile/src/lib/geo.spec.ts` (18) — heading omission, and that `0°` survives.
- `mobile/src/features/crew/tracking-status.spec.ts` (22) — the three freshness
  concepts stay separate, and the delivery windows are the shared constants.
- `mobile/src/features/map/bus-marker-invariants.spec.ts` (17) — both native maps
  call the shared camera hook and neither rolls its own.

Session 7 (cartography) adds, and all of it is green as of this pass:

- `web/scripts/kidbus-cartography.spec.ts` (15) — the shipped style JSON **is**
  the built style object; sprite-id integrity (every `icon-image` output of both
  shipped styles resolves into the shipped atlas, every cell reachable, PNG
  headers and index cells agree, the PNG bytes are exactly what the generator
  renders); `transportation_name` line placement; the class-wise `place` ladder
  and the live z13–16 band; the `poi` rank gate; the single-source rule.
- `web/src/features/map/style-variant.spec.ts` (+3) — night recolours **every**
  painted layer by rule, layouts are identical, every road keeps the day style's
  own width expression, and the casing is its fill + a constant at every stop.
- `mobile/src/features/map/map-style.spec.ts` (+6) — sprite resolution on native:
  origin extraction (credentials stripped, non-https rejected), root-relative →
  API origin, unresolvable → field dropped with one warning naming
  `EXPO_PUBLIC_API_URL`, and the bundled constant never mutated.
- both `map-provider-policy.spec.ts` files (+2 suites) — positive assertions
  beside the banned-token scan: one keyless OpenFreeMap source, glyphs from the
  allowed host, a same-origin sprite this repository actually ships, and no CSP
  wildcard (the sprite needs none).
- `node scripts/generate-kidbus-sprite.mjs --check` — "sprite up to date
  (4 files, 12 icons)", exit 0.

## Native rebuild requirements

The map engine swap to **MapLibre does require a native rebuild** — it is a
new native module (the MapLibre GL SDK), added to the generated projects by
the config plugin in `mobile/app.config.js`, plus `@types/geojson` for the
source types. After the swap:

- A **development build** (`npx expo run:android` / `npx expo run:ios`) or an
  EAS build is required to see the map. **Expo Go cannot render it on any
  platform** — the Expo Go shell does not carry the custom MapLibre module — so
  the map surfaces show the labelled "needs a development build" panel there
  (`src/features/map/map-surface-mode.ts`).
- No key, no account, no billing is involved ([Map provider
  policy](#map-provider-policy)); the only build-time fact this map adds is the
  config plugin itself.
- A plain JS reload (dev-client / Expo Go) is enough for everything _inside_
  the map once the native shell has it: the Driver Trip card adds no module
  beyond the engine, and `GPS_LIVE_WINDOW_MS` / `GPS_STALE_WINDOW_MS` were
  added to `@school-bus-tracking/shared-types` (run `npm run build:packages`
  before typechecking).

The marker graphic is a bundled PNG (`mobile/assets/bus-marker.png` +
`@2x`/`@3x`; Metro ships assets in the JS bundle, resolved from the single
`require` in `BusMarkerGraphic.tsx`), so it ships in
the same bundle as everything else once the engine is present; no
`react-native-svg`, no native dependency.

## Session 2 — status of the follow-ups

Recorded here rather than deleted, because each line is either a decision that
still binds or a task someone still has to do.

1. **Driver Trip screen** — **done**. One supplementary card
   (`mobile/src/features/crew/DriverTripMap.tsx`) reusing the marker, motion
   machine and shared `useFollowCamera` binding, with crew freshness semantics
   and a device-local marker. See [The Driver Trip map](#the-driver-trip-map).
2. **`heading: -1` at the source** — **done**. Omitted, `0°` preserved,
   regression-tested; the Android `0.0` residual is documented under Known
   limitations and remains the speed gate's job.
3. **Consolidate the freshness windows** — **done, without merging concepts**.
   `tracking-status.ts` aliases the shared constants; the spec no longer pins one
   module to the other's literals because there is only one definition to drift
   from. `LOCAL_FIX_FRESH_WINDOW_MS` stays its own number on purpose.
4. **Shared client package for `bus-motion` / `follow-camera`** — **not done,
   still not needed**. The driver map became a third _consumer_ without becoming
   a third _copy_, because the camera policy was extracted into
   `follow-camera-controller.ts` + `useFollowCamera.ts` inside `mobile/`. The
   `mobile/` ↔ `web/` mirror is unchanged; if the web driver view is ever built,
   that is the point to revisit a package.
5. **Device-focused UX validation** — **pending, and honestly so**. See the
   checklist above: it has not been run, this environment has no device,
   emulator or browser, and no result is being reported as if it had been.
6. **`setNativeProps` / `animateMarkerToCoordinate`** — **evaluated and not
   adopted**, with the platform matrix corrected in
   [Native marker updates we did not adopt](#native-marker-updates-we-did-not-adopt).
   `setCoordinates` (the one cross-platform imperative command) is held in
   reserve pending measured evidence.
7. **Tile provider decision** — **mobile + web: resolved by the engine swap**.
   Both surfaces now run on MapLibre (mobile v11, web v5) over OpenFreeMap —
   no key, no account, no billing, and a self-host path that changes one
   variable (`EXPO_PUBLIC_MAP_STYLE_URL` / `NEXT_PUBLIC_MAP_STYLE_URL`) ([Map
   provider policy](#map-provider-policy)). See Known limitations #8 (now
   resolved).

The map style is now our same-origin `kidbus-day` style (`/map-styles/kidbus-day.json`); vector tiles and glyphs remain OpenFreeMap/OpenMapTiles with no key, account, or billing. POI sprite artwork is Maki, CC0, generated by `scripts/generate-kidbus-sprite.mjs`.

## Session 6 — Google-like interactions (web)

Four additions on top of the Session 5 cartography, all free and client-side:
no new data source, no network call, no per-frame React re-render, and the
marker-motion / follow-camera modules untouched. Every decision with a rule
behind it is a pure exported function with a spec; the component only applies.

### 3D buildings — one pure visibility rule

The tile-driven building volumes are the Session 5 fill-extrusion
(`sbt-3d-buildings`, heights from the tiles' own `render_height`/`height`
attributes, the style's existing vector source — nothing else is fetched).
Session 6 makes the *decision* explicit:
`buildingsLayerVisible(dimension)` / `buildingsLayerForDimension(style, dimension)`
in `web/src/features/map/bus-3d.ts`, pinned by `bus-3d-buildings.spec.ts`.
The rule is one line — **building volumes exist only while the 3D camera is
on** — because every other guard (reduced motion, the dropped-frame fallback)
is already folded into the effective dimension by `useMapCameraMode`. The 2D
camera keeps the base style's flat building footprint fill and looks exactly
as before.

### POI tap sheet

Tapping a POI icon opens a compact sheet with the place's **name and
category**, read from the already-rendered vector-tile feature via
`queryRenderedFeatures` — the OpenMapTiles `poi` layer in our style carries
`name` and `class` on every feature, so nothing is fetched. The sheet is
dismissed by an outside tap, Escape or its close button. The precedence rule
lives in `resolveMapTap(features)` in `web/src/features/map/poi-sheet.ts`
(pinned by `poi-sheet.spec.ts`) and is absolute and order-independent:
**stops win** — a stop dot/number/label, the 3D bus mesh, or the flat 2D DOM
marker (surfaced as the synthetic `sbt-bus-dom-marker` entry, since
`queryRenderedFeatures` cannot see DOM elements) anywhere in the hit list
beats every POI, so the stop's existing popup opens and the sheet does not.
A POI feature with no usable `class` opens no sheet at all, and a nameless
place falls back to its category as the title. The sheet is tap-driven React
state only — it never re-renders per frame.

### Night style

`KIDBUS_NIGHT_STYLE` in `packages/map-assets` is the Session 5 style under a
Google-night palette (land `#202124`, water `#17263c`, roads `#3c4043` with
`#202124` casing, labels `#9aa0a6`, muted vegetation and motorway amber),
produced by the pure transform `kidbusNightStyle(day)`: **only paint
changes** — sources, sprite and glyphs pass through by reference, so night
uses the same free tiles, our sprite and the same glyph host, and the
map-provider policy needs no revision. The build ships
`web/public/map-styles/kidbus-night.json` (the copy script now also
generates the day JSON from the compiled styles, fixing a broken path that
failed every `npm install` postinstall since Session 5).

Selection is a pure function of the app's **existing** theme signal — the OS
`prefers-color-scheme` media query, read live by `usePrefersColorScheme`
(sibling of `usePrefersReducedMotion`; no new user setting).
`resolveThemedMapStyleUrl(env, scheme)` in `style-variant.ts` keeps one
precedence: **a valid `NEXT_PUBLIC_MAP_STYLE_URL` override always wins**
verbatim through the existing https-only validation (the self-host escape
hatch is never rethemed); an unset/blank override defers to the signal
(`kidbus-day` vs `/map-styles/kidbus-night.json`). A scheme flip while the
map is running swaps styles via `map.setStyle` on the same map instance; the
`styledata` re-application path resurrects every app overlay plus the 2D/3D
presentation against the new style's baseline. Pinned by
`style-variant.spec.ts`.

### Controls

- **Compass** — appears *only while the map is rotated*
  (`shouldShowCompass`, half-degree epsilon so fit/ease settling cannot flash
  it); the needle counter-rotates the bearing, and a tap resets north through
  the engine's own `easeTo` — instantly when reduced motion is on
  (`resetNorthDurationMs`). The engine's always-on navigation compass is off
  (`showCompass: false`); zoom and fullscreen are unchanged. Rotate events
  update the needle imperatively, so a rotation gesture re-renders nothing.
- **Scale bar** — the engine's `ScaleControl` (metric), bottom-left above the
  logo; the bottom-right stays the attribution's legally required corner.
- **Recentre** — a target-style button that exists only while the user owns
  the camera (`shouldShowRecentreControl` over the follow-camera mode) and
  routes every tap through the existing follow-camera `recenter` dispatch —
  the same path the Follow bus pill uses, so there is still exactly one
  camera system. Follow pans and the recentre now also honour
  `usePrefersReducedMotion` (same target, reached instantly), mirroring the
  existing zero-duration 2D/3D pitch ease. Pinned by `map-controls.spec.ts`.

## Session 7 — Cartography: the labels and icons that were missing

**Goal.** The same free OpenFreeMap tiles should read the way Google Maps reads
at the zooms a parent actually uses (z13–16): the colony/suburb name, the road
the bus is on, the school, the gurdwara, the hospital. No new provider, no key,
no billing, no routing change, no UI redesign — the routing engine stays Phase 1
(OSRM) work, and the dashed straight line keeps its "planned stop order — not
the road route" caption everywhere.

### Three defects, all structural

Each one was invisible in review because every file involved was *valid*:

1. **POIs never drew.** The style asked for `poi-school`, `poi-hospital`, … while
   the shipped atlas contained `school`, `hospital`, … — and MapLibre **drops the
   whole symbol** when its `icon-image` is missing, so there was no icon *and* no
   label, web or native, at any zoom.
2. **Road names never drew.** `transportation_name` had no `symbol-placement`, so
   a name was laid out at one point on the line instead of along it, and lost the
   collision race to every other label.
3. **Area names below city level never drew.** One unfiltered `place` layer meant
   the renderer placed symbols in layer order within that layer, city first, so
   `suburb`/`quarter`/`neighbourhood` lost every collision — exactly the labels
   the z13–16 band needs.

### What the style does now

`packages/map-assets` is the single source (`KIDBUS_DAY_STYLE`, 39 layers, was
14); `web/public/map-styles/kidbus-{day,night}.json` are its build output, and a
spec fails if the two ever disagree (see "Single source of truth"). The layer
array *is* the collision priority — a symbol placed by an earlier layer wins
against a later one — so the order below is a decision, not an accident:

| band | layers | rule |
| --- | --- | --- |
| ground | `background, landcover, landuse, water, waterway, building(z13) ` | flat Google-like fills, buildings from street zoom |
| rail | `rail(z10)` | dashed `#d6d6d6`, 2/2 |
| roads | 18 layers: {tunnel, surface, bridge} × {major, secondary, minor} × {casing, fill} | tunnels first, bridges last, each class group a casing under a fill |
| boundaries | `boundary(z1)` | dashed, subordinate |
| names | `water_name(z11, line)`, `water_name-point(z14)`, `transportation_name(z12, line)`, `transportation_name-minor(z14, line)` | names ride the line they belong to |
| places | `place-city(z2), place-town(z6), place-village(z9), place-suburb(z11), place-quarter(z12), place-hamlet(z13), place-neighbourhood(z13), place-state(z4)` | one layer per class, biggest first, each with its own size/halo ladder |
| POIs | `poi(z14)` | rank-gated by zoom, `symbol-sort-key`-ordered, label optional |

### Road hierarchy: why three width *groups*, not one `match`

A MapLibre expression may contain **one** zoom-based `interpolate`, and a `match`
whose branches each carry a zoom ramp is rejected outright:

```
Only one zoom-based "step" or "interpolate" subexpression may be used in an expression.
```

So the class width ladder is expressed the standard way — separate layers per
group, matched by class *colour* inside a group (colour needs no zoom). Both
styles are validated against `@maplibre/maplibre-gl-style-spec` in review; the
day style's error count is zero.

| group | classes | minzoom | fill width @z12 / z14 / z16 / z18 |
| --- | --- | --- | --- |
| major | motorway, trunk, primary (+ links) | 6 | 2.6 / 4.6 / 4.6 / 9.6 |
| secondary | secondary, tertiary (+ links) | 11 | 0.6 / 2.6 / 2.6 / 7 |
| minor | residential(`minor`), unclassified, living_street, service, track, path | 12 | 0 / 1.2 / 1.2 / 4.2 |

Colours: motorway/trunk `#fdd663`, primary `#f8c14a`, secondary/tertiary
`#fff2a8`, residential white — each with a darker casing (`#e8b95f` / `#daa93f`
/ `#e2d495` / `#d5d7db`) derived as *fill + a constant* (+1.4 px arterials,
+1.2 px the rest), asserted stop-by-stop by `style-variant.spec.ts`. A tunnel's
casing is lighter than the surface road's (`#dfe1e5`, it is in a hole), a
bridge's darker (`#c8ccd1`, the deck is on top), and the fills keep the class
colour in all three passes, so a street is recognisable on a flyover.

### Labels

- **Road names** — `symbol-placement: 'line'` with
  `text-rotation-alignment: 'map'` (the name follows and rotates with the road),
  `text-pitch-alignment: 'viewport'` (stays readable in the 3D camera),
  `symbol-spacing` 400 (major) / 300 (minor) so a long road is named, not
  stuttered, zoom-interpolated `text-size` (11.5→14 / 10.5→11.5), a halo, and
  `minzoom` 12 / 14 so minor names wait for street zoom.
- **Place names** — one layer per class (table above). `symbol-sort-key` orders
  within a layer, layer order orders between classes; the suburb/quarter/hamlet/
  neighbourhood ladder is live from z13, which is what makes the colony names —
  the complaint this pass exists to fix — appear at z13–16. Night recolours every
  one of them (a daylight halo on a black map is as invisible as no label).
- **POIs** — `icon-image` is a class `match` over the atlas's real ids with a
  neutral `poi-default` fallback (an unmapped class draws a marker rather than
  nothing), `text-variable-anchor: ['top','bottom','left','right']` with
  `text-radial-offset` so a label hops around its icon, `text-optional: true` so
  an icon still draws when its label cannot, an OpenMapTiles `rank` gate that
  relaxes with zoom, and `symbol-sort-key` 5/10/20 (school/worship/health →
  police/park/transit → shops).

### The sprite, and where the phone gets it from

`scripts/generate-kidbus-sprite.mjs` is dependency-free (its own SVG path
parser, 4×4 supersampling rasteriser and PNG encoder) and writes four files for
12 icons: `poi-school, poi-hospital, poi-place_of_worship, poi-fuel, poi-police,
poi-park, poi-restaurant, poi-pharmacy, poi-bank, poi-bus, poi-shop,
poi-default` at 32 px cells, RGBA, plus the `@2x` twins. `node
scripts/generate-kidbus-sprite.mjs --check` re-renders in memory and exits 1 on
byte drift; `kidbus-cartography.spec.ts` makes the same comparison as a test.

Native MapLibre has **no document origin**, so a root-relative
`/map-sprites/kidbus` can never resolve on a phone — and the engine fetches
`<sprite>.json` *and* `<sprite>.png` by appending extensions, so a Metro-bundled
single image could not work either. The decision, pinned by
`mobile/src/features/map/map-style.spec.ts`:

> the pipeline resolves the style's sprite against the **API origin** — the one
> origin the app already trusts, which serves the byte-identical sprite files to
> web — and never against a third-party host. If it cannot resolve one, it drops
> the field and says so once, naming `EXPO_PUBLIC_API_URL`, rather than handing
> MapLibre a path it could only fail on.

`apiOriginFromBaseUrl` keeps scheme+authority only (credentials stripped) and is
deliberately a regex rather than `new URL`, because React Native's `URL.origin`
is an unreliable partial polyfill; `withNativeSprite` returns the *same object*
when there is nothing to resolve and never mutates the shared bundled constant.
Web serves the same files same-origin (`'self'` in `img-src`/`connect-src`), so
`web/security-headers.js` needed **no change** — asserted, not assumed.

### Single source of truth, and the drift checks

The style exists twice by necessity: as a typed object (`packages/map-assets`,
what the mobile app imports) and as committed JSON (`web/public/map-styles`,
what the web app fetches). Regenerate, never hand-edit: `npm run build:packages`
runs `tsc` and the copy script that writes both JSON files. Four cheap checks
keep the two honest, all in `web/scripts/kidbus-cartography.spec.ts` unless
noted:

- `kidbus-day.json` / `kidbus-night.json` are **deep-equal** to the built
  objects (this is the drift check);
- both variants ship the same layer ids and types in the same order, one
  OpenFreeMap source, no third-party tile/sprite/glyph host, no `key=`;
- **sprite-id integrity**: every `icon-image` output of every shipped style
  resolves into the shipped atlas, every atlas cell is reachable, the PNG
  headers match the index cells, and the shipped PNG bytes are exactly what the
  generator renders (stale-atlas guard);
- **transportation_name** really is line-placed with map rotation, spacing,
  zoom sizes, a halo and a sane `minzoom`; **place** layers are class-filtered
  with the expected minima, the z13–16 band is live, the layer order is the
  hierarchy, and `poi` is rank-gated with sort keys and optional labels;
- **night** (`web/src/features/map/style-variant.spec.ts`): every painted layer
  is recoloured by the rule `nightPaintFor` (no layer silently keeps its day
  paint), layouts are identical, every road keeps the day style's width
  expression, and the night palette is pinned.

### Previewing it locally

```bash
npm install
npm run build:packages          # tsc + writes both style JSONs from the object
npm --prefix web run dev        # http://localhost:3000
```

Open a trip/bus map and zoom to a school catchment (roughly z13–16). The style
JSON is fetched from `/map-styles/kidbus-day.json` (`kidbus-night.json` under
`prefers-color-scheme: dark`; `NEXT_PUBLIC_MAP_STYLE_URL` overrides both, and is
honoured verbatim). To re-render the style after an edit: `npm run
build:packages`, then reload — the dev server serves `web/public` directly. For
the sprite: `node scripts/generate-kidbus-sprite.mjs` (or `--check` to see
whether the committed files are stale).

### Before / after at z13–16

| what a parent looks for | before | after |
| --- | --- | --- |
| colony / mohalla / suburb name | never drawn (collision-lost in one unfiltered layer) | `place-suburb` from z11, `place-quarter` z12, `place-hamlet` / `place-neighbourhood` z13, own sizes |
| the road the bus is on | no name (point-placed, collision-lost) | line-placed name on the road itself, majors z12, residential/service z14 |
| school / gurdwara / mandir / hospital icon | nothing — every POI symbol dropped | `poi-school` / `poi-place_of_worship` / `poi-pharmacy` … from the shipped atlas, icons from z14, labels optional |
| park, bus stop, bank, fuel | nothing | `poi-park` / `poi-bus` / `poi-bank` / `poi-fuel` |
| a street and a highway look alike | one white fill, one width | yellow arterials, near-white secondary/tertiary, thinner residential/service, each with a casing |
| night mode | the same gaps, in grey | the same labels/icons, recoloured (every painted layer proven to be recoloured) |
