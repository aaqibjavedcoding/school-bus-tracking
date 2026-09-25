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

## Architecture

One **pure state machine** decides what to draw; each platform only renders it.

| Module                                                                                                | Responsibility                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mobile/src/features/map/bus-motion.ts`<br>`web/src/features/map/bus-motion.ts`                       | The motion state machine: coordinate validation, jitter gate, heading resolution, shortest-angle rotation, cadence-derived tween length, gap/jump snapping, halt and reset. **Pure, clock-injected, no React.** |
| `mobile/src/features/map/follow-camera.ts`<br>`web/src/features/map/follow-camera.ts`                 | The follow-camera reducer: who owns the camera, when to fit, when to pan, when to stop following. Pure.                                                                                                         |
| `mobile/src/features/map/tracking-presentation.ts`<br>`web/src/features/map/tracking-presentation.ts` | Honest live / last-known / outdated / approximate derivation. Pure.                                                                                                                                             |
| `mobile/src/lib/geo.ts` (existing) <br> `web/src/features/map/geo.ts` (new mirror)                    | Haversine distance and compass bearing.                                                                                                                                                                         |
| `mobile/src/features/map/BusMarkerGraphic.tsx`                                                        | The top-view bus, drawn with React Native views.                                                                                                                                                                |
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
`api-cache.ts`, `socket-auth.ts` all exist in both apps). The two copies differ
only in their geodesy import, and both suites pin the identical threshold values
so a one-sided edit fails a test rather than shipping two buses that move
differently.

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

## The marker

A **top-view school bus**, nose up, amber (`colors.primary[500]`, `#f59e0b`)
with a near-black outline (`colors.neutral[900]`), a light windscreen at the
front, two window strips and a darker rear.

Two properties matter:

- **nose-up means heading 0° is north with no rotation applied**, so a heading
  reading on this marker actually means something;
- **it is symmetric about its own centre**, so rotating it about its centre
  keeps the vehicle centre on the GPS coordinate.

Both map surfaces anchor at the vehicle centre: `anchor="center"` on the
MapLibre `ViewAnnotation` (native), `anchor: 'center'` / CSS translate on the
MapLibre `Marker` (web, `maplibregl.Marker` with centred element).

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

The graphic is drawn with views/SVG rather than shipped as an image so there is
**one** design, no asset pipeline, no network request and no new dependency
(`react-native-svg` is deliberately not added).

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
| `jitterMinM` / `jitterMaxM` / `jitterAccuracyFactor` | 2 / 30 / 0.5         | Gate = half the reported accuracy radius, clamped. The floor lets a good fix move the bus; the **ceiling is the honesty bound** — a coarse fix must not freeze the bus for hundreds of metres.                                                                                                                                                                                                                                                                                        |
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
- **No new plumbing** — no GPS watcher, no socket subscription, no storage. The
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

Interpolated coordinates are presentation only here too: the tween is never
written into history, ETA, attendance or notifications.

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

1. **There is no road matching, and none is planned for this scope.** Two sparse
   GPS points are joined by a straight line, so on a bend the bus visibly cuts
   the corner, and on a hairpin it can briefly appear to drive through
   buildings. That is a property of the data.
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

**Straight road**

- [ ] Bus glides between fixes instead of teleporting.
- [ ] Nose points along the direction of travel.
- [ ] Marker stays the same screen size while zooming.

**Turns**

- [ ] Marker rotates through the short way (north-crossing turns included).
- [ ] Marker visibly cuts the corner on a bend — this is expected, not a bug.

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

The marker graphic is drawn with views (no image asset, no `react-native-svg`),
so it ships in the same bundle as everything else once the engine is present.

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
