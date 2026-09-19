# Live Tracking Map

## Overview

How parents and school administrators see the bus move: the marker graphic, the
interpolation between GPS fixes, the heading, the camera, and what the map is
allowed to claim about a position.

Scope: the **observer** side — `mobile/` parent and admin tracking screens and
the `web/` live-tracking console. The crew **Driver Trip** screen is unchanged
in this pass and is Session 2 work (see the end of this document).

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
| `mobile/src/features/map/BusMap.tsx`                                                                  | Native map: camera policy, status panel, follow control, stop pins, accuracy circle.                                                                                                                            |
| `web/src/features/map/bus-marker-icon.ts`                                                             | The top-view bus as inline SVG, plus the `divIcon` geometry as plain data. Runtime-free, so its geometry is directly testable (`leaflet` dereferences `window` at module scope).                                |
| `web/src/features/map/MapViewInner.tsx`                                                               | Web map: same policy over Leaflet.                                                                                                                                                                              |
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
`react-native-maps` or `leaflet`. That is also why `bus-marker-icon.ts` exports
`busIconOptions()` as plain data and leaves the one-line `L.divIcon(...)` call
to `MapViewInner.tsx`.

The **one genuinely shared** piece is the definition of "live":
`GPS_LIVE_WINDOW_MS` / `GPS_STALE_WINDOW_MS` live in
`@school-bus-tracking/shared-types`, imported by both clients.

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

Both platforms anchor at the centre: `anchor {0.5, 0.5}` on Google Maps and
`centerOffset {0, 0}` on Apple Maps (`AIRMapMarker.m`), `iconAnchor [13, 21]` on
Leaflet.

### Why the implementations differ per platform

`react-native-maps` 1.27.2 documents `Marker.icon` **and** `Marker.rotation` as
_"iOS: Google Maps only"_. This app ships Google Maps on **Android only** —
`mobile/app.config.js` injects `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` into
`android.config.googleMaps.apiKey` and nothing equivalent for iOS — so iOS runs
Apple Maps, where neither prop works. Therefore:

- **Android** — the child view stays static and `Marker.rotation` (which maps to
  `marker.setRotation(...)`, `MapMarker.java:247`) does the turning natively.
  `tracksViewChanges` is switched off after one frame, so the bitmap is
  snapshotted once instead of continuously.
- **iOS** — the child view is rotated with a `transform`, which works on Apple
  Maps _and_ on Google Maps if the provider is ever changed.
- **Web** — inline SVG in a `divIcon`; rotation is a `style.transform` on an
  inner `.bus-marker-rotor` element.

The graphic is drawn with views/SVG rather than shipped as an image so there is
**one** design, no asset pipeline, no network request and no new dependency
(`react-native-svg` is deliberately not added).

### Content-Security-Policy

No change to `web/security-headers.js` was required, and this was verified rather
than assumed. `buildContentSecurityPolicy()` emits
`style-src 'self' 'unsafe-inline'` and
`img-src 'self' data: blob: https://tile.openstreetmap.org`, which covers the
marker three ways over:

- The SVG is **markup inside the `divIcon` container**, not an `<img src>` or an
  external file, so `img-src` does not govern it at all.
- It contains no `<script>`, no `on*` handler, no `url(...)`, no `<image href>`,
  no `foreignObject` and no `xlink:href` — nothing `script-src` would block.
- Rotation is applied through the CSSOM (`rotor.style.transform = ...`), which
  CSP does not intercept. Inline `style` attributes are blocked by a strict
  `style-src`, so keep using the CSSOM here rather than `setAttribute('style', …)`.
  (`'unsafe-inline'` is present anyway, but the CSSOM route stays correct if that
  is ever tightened.)

**Watch this if the tile host ever changes.** `OSM_URL` is pinned to
`https://tile.openstreetmap.org/{z}/{x}/{y}.png` with **no `{s}` subdomain
placeholder** specifically so `img-src` can name one exact origin. Reintroducing
`{s}.tile.openstreetmap.org` for load spreading silently produces blank tiles
behind a CSP violation, because the subdomains are not in the allow-list. The two
must be changed together.

Stops keep the platform's default teardrop pin in slate, so a stop and the bus
are different species at a glance and in a screenshot.

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
  renders a single `<Marker>`. The screen, the `<MapView>`, the polyline and the
  stop markers never see it. `MapSurface` is `React.memo`'d so the 5 s status
  tick cannot reach the native map either.
- **Web** — there is no React state per frame at all: position and rotation are
  applied imperatively (`setLatLng`, one `style.transform`). The React
  `position` prop is fixed at the mount coordinate on purpose, because
  react-leaflet calls `setLatLng` whenever that prop _changes_, which would
  yank the marker to the tween's destination mid-flight.
- **Camera** — moved imperatively from the frame callback on both platforms, so
  following the bus re-renders nothing.

## Thresholds and why

All centralised in `MOTION_THRESHOLDS` and pinned by tests in both workspaces.

| Constant                                             | Value                | Rationale                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `headingMinSpeedKmh`                                 | 3                    | Below walking-pace-plus, a GPS course is Doppler noise inside the accuracy circle. Also neutralises a real data quirk: `expo-location` reports `heading: -1` when unavailable, and `buildLocationPayload` normalises that finite `-1` into `359`, so a _stationary_ bus can arrive with a heading that really means "unknown". The speed gate makes that harmless. |
| `headingMinDisplacementM`                            | 12                   | Below this, `atan2` over two points inside one accuracy circle can swing 180° between fixes — a parked bus visibly spinning.                                                                                                                                                                                                                                       |
| `jitterMinM` / `jitterMaxM` / `jitterAccuracyFactor` | 2 / 30 / 0.5         | Gate = half the reported accuracy radius, clamped. The floor lets a good fix move the bus; the **ceiling is the honesty bound** — a coarse fix must not freeze the bus for hundreds of metres.                                                                                                                                                                     |
| `animationCadenceFactor`                             | 0.8                  | Tween = 0.8 × observed cadence, leaving ~20 % headroom so a slightly late fix does not arrive mid-tween. The old hardcoded 900 ms against a 2.5–4 s cadence is what made the web bus lurch and then sit.                                                                                                                                                           |
| `animationMinMs` / `animationMaxMs`                  | 500 / 3000           | Floor: below a couple of frames a tween just flickers. Ceiling: bounds how far the marker can lag behind the newest real fix.                                                                                                                                                                                                                                      |
| `gapSnapMs`                                          | 45 000               | >10× the nominal cadence (device watch 4 s, server throttle floor 2.5 s), so a genuine cadence can never trip it.                                                                                                                                                                                                                                                  |
| `maxPlausibleSpeedMps`                               | 33                   | ≈120 km/h. A school bus does not exceed it, so a larger implied jump means the _fix_ moved (tunnel exit, urban-canyon multipath, coarse network fix), not the bus.                                                                                                                                                                                                 |
| `cadenceMinMs` / `cadenceMaxMs` / `cadenceSmoothing` | 1 000 / 30 000 / 0.4 | EWMA over accepted-fix intervals, bounded so one anomalous gap cannot distort the tween length.                                                                                                                                                                                                                                                                    |
| `FRAME_MIN_INTERVAL_MS`                              | 50                   | ~20 fps; see above.                                                                                                                                                                                                                                                                                                                                                |
| `FOLLOW_CAMERA_THROTTLE_MS`                          | 500                  | Decoupled from both the fix cadence and the frame rate: per-frame camera steps vibrate against the marker's own tween, per-fix steps lurch.                                                                                                                                                                                                                        |
| `FOLLOW_CAMERA_MIN_SHIFT_METERS`                     | 5                    | Below the size of a stop, so an idling bus does not vibrate the camera.                                                                                                                                                                                                                                                                                            |
| `ZOOM_GESTURE_TOLERANCE`                             | 0.02                 | Above platform region-report noise, below one zoom step.                                                                                                                                                                                                                                                                                                           |

Freshness (`tracking-presentation.ts`):

| Constant                      | Value   | Source                                                                                                                                                          |
| ----------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LIVE_WINDOW_MS`              | 30 000  | `GPS_LIVE_WINDOW_MS` from `shared-types`; mirrors the crew controller's `SERVER_ACK_LIVE_WINDOW_MS`. `tracking-presentation.spec.ts` asserts they cannot drift. |
| `STALE_WINDOW_MS`             | 120 000 | `GPS_STALE_WINDOW_MS`; mirrors `SERVER_ACK_STALE_WINDOW_MS`.                                                                                                    |
| `ACCURACY_APPROXIMATE_METERS` | 50      | The same line `gpsSignalTier` in `mobile/src/lib/geo.ts` already calls "weak".                                                                                  |
| `ACCURACY_CIRCLE_MAX_METERS`  | 500     | A 5 km circle on a 280 dp map is a solid orange screen, not information; past this the uncertainty is stated in words instead.                                  |

## Follow camera

The one rule: **the camera belongs to the person looking at the map, not to the
GPS stream.**

- **Fit** — once per trip, on the first moment stops or a fix exist, over the
  stops _and_ the bus. Never on a GPS update.
- **Pan** — while following, centre only. Zoom is never changed by a GPS update,
  on either platform (a partial camera is merged with the current one:
  `MKMapCameraWithDefaults:existingCamera:` on iOS,
  `CameraPosition.Builder(map.getCameraPosition())` on Android, and Leaflet's
  `panTo` does not touch zoom).
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

This is the part that is easy to get wrong, and the providers differ:

- **Android (Google Maps)** and **iOS with Google** populate `isGesture` on the
  region events (`MapView.java:670`, `AIRGoogleMap.mm:528`).
- **Apple Maps does not populate `isGesture` at all.** For it, two independent
  signals are used: `onPanDrag` (emitted only by user drags —
  `AIRMapManager.m:678`, `MapView.java:1766`), and a zoom-delta change, which is
  sound by construction because follow mode never zooms.
- **Leaflet** — `dragstart` and `boxzoomstart` come only from the user, and
  `panTo` fires neither. `zoomstart` needs care because `fitBounds` dispatches
  it from inside a `requestAnimFrame` (`Map.js` `_tryAnimatedZoom`), i.e. _after_
  the call returns, so gesture detection is suppressed for a short window after
  the one zoom change we make per trip.

**Known trade-off:** on web, a user who pinch-zooms within ~1.5 s of the initial
fit can be missed, because that window is open. Follow mode then keeps panning
for one fix until the next gesture is seen. Native has no equivalent window.

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
- Map controls sit top-left (status) and top-right (follow) so they cover
  neither the Google Maps attribution and logo (bottom-left) nor the Apple Maps
  legal button and Leaflet attribution (bottom-right).
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
5. **`heading: -1` → `359`.** `buildLocationPayload` normalises any finite
   heading, and `expo-location` uses `-1` for "unavailable", so a stationary
   device can upload `heading: 359`. This pass does not change crew upload
   behaviour; the presentation layer's speed gate makes it invisible. Worth
   fixing at the source in Session 2.
6. **Freshness uses `received_at` (server clock) against the device clock.**
   Significant client/server clock skew would shift the live/last-known boundary
   by that skew. The crew status module has the same property.
7. **`tracksViewChanges` on iOS Apple Maps is a no-op** (documented as
   Google-only), so the iOS marker view is re-rendered on rotation. At ~20 fps
   for one small view this is cheap, but it is a real per-frame cost on the
   oldest iPhones.
8. **OpenStreetMap tiles are free but not unlimited.** The web map uses
   `https://tile.openstreetmap.org` under OSM's tile-usage policy. Production
   console traffic is expected to move to a self-hosted or contracted tile
   provider; this change does not alter the tile source or its attribution.
9. **No paid routing, Directions, Roads, traffic, map-matching or tracking API
   was added**, and no new map provider. Attribution is preserved on both
   platforms.

## Manual verification checklist

Nothing below has been run on a physical device in this pass — see "What was
verified automatically".

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

**Reduced motion**

- [ ] With the OS setting on, the bus snaps between fixes (native and web).
- [ ] Flipping the setting while a trip is live takes effect immediately.

**Parent/admin, mobile and web consistency**

- [ ] The same bus shape and colours on all four surfaces.
- [ ] Status wording agrees; ETA and stop lists are unchanged.
- [ ] Hindi and Marathi labels fit their chips without clipping.

## Native rebuild requirements

**None for iOS/Android app binaries in the usual sense** — no new native
dependency, no new asset, no config plugin, no manifest entry. The marker is
drawn with views, and `react-native-maps` 1.27.2 was already installed.

What _is_ required:

- A new JS bundle (Expo Go / dev-client reload is enough).
- `npm run build:packages` before typechecking, because
  `GPS_LIVE_WINDOW_MS` / `GPS_STALE_WINDOW_MS` were added to
  `@school-bus-tracking/shared-types`.
- A native rebuild **is** needed if you want the Google Maps key or Firebase
  wiring described in `docs/mobile-expo-sdk.md` — but that is pre-existing and
  unrelated to this change.

## Session 2 — remaining work

1. **Driver Trip screen** (`mobile/app/(crew)/trip.tsx`): reuse `bus-motion.ts`,
   `follow-camera.ts`, `tracking-presentation.ts` and `BusMarkerGraphic` for a
   driver-facing map, with the crew freshness semantics from
   `tracking-status.ts` rather than the observer ones.
2. **Fix `heading: -1` at the source** in `buildLocationPayload`, so "no course"
   is omitted rather than uploaded as 359.
3. **Consolidate the freshness windows**: have
   `mobile/src/features/crew/tracking-status.ts` import
   `GPS_LIVE_WINDOW_MS` / `GPS_STALE_WINDOW_MS` directly instead of being
   pinned to them by a spec.
4. **Consider a shared client package** for `bus-motion` / `follow-camera` if a
   third consumer appears, replacing the mirrored copies.
5. **Device-focused UX validation**: run the checklist above on a physical
   low-end Android, an iPhone (Apple Maps) and a browser, and record what was
   actually observed.
6. **Evaluate `setNativeProps` / `animateMarkerToCoordinate`** for native marker
   updates. Both exist in 1.27.2, but `setNativeProps` is deprecated under
   Fabric and `animateMarkerToCoordinate` is Google-only, so neither was relied
   on here.
7. **Tile provider decision** for the web console before real traffic.
