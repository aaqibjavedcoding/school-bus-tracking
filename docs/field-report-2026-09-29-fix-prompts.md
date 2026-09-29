# Fix prompts — 29 Sep 2026 field report

Yeh 7 ready-to-paste prompts hain. **Ek baar me ek** chalao (order me), taaki
har PR chhota, reviewable aur revert-able rahe. Har prompt self-contained hai —
file paths, root cause, acceptance criteria sab andar hai.

Background aur root-cause analysis: [`field-report-2026-09-29-analysis.md`](./field-report-2026-09-29-analysis.md)

### Decisions — locked (30 Sep 2026)

Ye teen sawaal poochhe gaye the aur jawab prompts me bake kar diye gaye hain.
Inhe dobara poochhne ki zarurat nahi:

| Sawaal                            | Faisla                                                                                 | Kahan laga  |
| --------------------------------- | -------------------------------------------------------------------------------------- | ----------- |
| Arrival circle kitna bada?        | **Detection 25 m + display patli ring** — dono. Plus live distance + manual "mark arrived" | PR-4        |
| Admin ko status override chahiye? | **Haan, par chhupa hua** — read-only timeline + collapsed override + confirm + audit    | PR-3        |
| Conductor ko map dikhe?           | **Haan, read-only** — position dikhe, GPS sharing sirf driver ke phone se               | PR-5        |

---

## PR-1 — P0 · Bus map pe dikhti hi nahi

> **Hinglish:** Web pe bus marker banta hi nahi kyunki uska effect map banne se
> pehle chal jata hai aur dobara nahi chalta. Aur mobile web pe map ki jagah
> list hai.

```
Fix the "bus does not appear on the map" defect. Root cause is already located —
do not re-diagnose, verify then fix.

WEB (primary bug)
File: web/src/features/map/MapViewInner.tsx

The bus-marker effect at line ~680 starts with `if (!mapRef.current) return;`
but its dependency array (line ~735) is `[fix, presentation.animate, applyFrame,
startLoop]` — it has no dependency on map readiness. The map itself is created in
a different effect gated on `[webglSupported, hasAnything]`, and `webglSupported`
is `null` on the first render. So this sequence loses the bus permanently:

  1. first render -> webglSupported null -> no map
  2. REST snapshot resolves -> `fix` set -> marker effect runs -> mapRef null -> returns
  3. WebGL check completes -> map is created
  4. marker effect never re-runs (fix unchanged) -> no bus marker, forever

Stop markers survive only because `mappedStops` happens to arrive later.

Required fix:
- Introduce an explicit readiness signal (e.g. `const [mapReady, setMapReady] =
  useState(false)`, set to true inside `map.on('load')`, reset to false in the
  init effect cleanup).
- Add `mapReady` to the dependency array of EVERY effect that touches the map
  imperatively: bus marker, stop markers, route line, trail line, accuracy circle.
- Preferred shape: extract one `syncOverlays()` routine called both from
  `map.on('load')` and from the data effects, so ordering can never regress again.
- Also guarantee the initial camera actually frames the bus: after the marker is
  created for the first time, dispatch `{ type: 'data-available' }` if no fit has
  happened yet.

MOBILE
Files: mobile/src/features/map/BusMap.web.tsx, mobile/src/features/crew/DriverTripMap.web.tsx
These render a text/list fallback instead of a map, so `npm run web` shows no bus
at all. Replace the fallback with a real `maplibre-gl` (GL JS) map for the web
platform, reusing the same style policy as native (`mobile/src/features/map/map-style.ts`)
and the same bus marker. Keep the list as the degraded state only when WebGL is
unavailable.

File: mobile/src/features/map/map-surface-mode.ts + needs-dev-build-panel.tsx
The `needs-dev-build` panel must state plainly, in one sentence, that Expo Go
carries no map engine and a development build is required — currently the wording
is easy to read as a generic error. i18n keys already exist
(`map.needsDevBuildTitle`, `map.needsDevBuildBody`); update the copy only.

ACCEPTANCE
- A trip whose only fix arrives from the REST snapshot (no live socket traffic)
  shows the bus marker on the web admin map within one render.
- Reloading /tracking with a completed trip still shows the last-known bus.
- `npm run web` in mobile/ shows a real map with the bus, not a list.
- Add a regression test that pins the ordering contract: a fake map created after
  the first fix must still end up with a bus marker.

CONSTRAINTS
- No new runtime dependency on web (maplibre-gl is already a dependency).
- Keep the existing pure policy modules (bus-motion, follow-camera,
  tracking-presentation) untouched — this is a wiring bug, not a policy bug.
- `npm run typecheck && npm run lint && npm --prefix web test && npm --prefix mobile test`
  must pass.
```

---

## PR-2 — P0 · Jhoota "Map failed to load — check your network connection"

> **Hinglish:** Har MapLibre warning ko failure maan liya jata hai, aur wo line
> kabhi khud clear nahi hoti. Net ON hone par bhi error dikhta rehta hai.

```
Kill the false "Map failed to load — check your network connection and map tiles"
error. It fires with a perfectly working network. Two independent causes, both
already located.

MOBILE
File: mobile/src/features/map/use-map-style.ts

(a) `classifyMapLog` (line ~93) classifies ANY MapLibre log at level warn/error
    whose text merely contains the substring 'style', 'maplibre' or 'mbgl' as a
    `styleLoad` failure. MapLibre-native emits such warnings routinely
    (unsupported style property, sprite miss, a single 404 tile, a request
    cancelled during a fast pan). Replace the substring heuristic with a strict
    allow-list of genuinely fatal patterns, e.g.:
      - "failed to load style"
      - "unable to fetch style"
      - "style is not done loading"
      - style-URL requests returning HTTP 4xx/5xx
    Anything else must return null. Keep `glyphs` classification but apply the
    same strictness (a single missing glyph range is not "labels unavailable").

(b) The `LogManager.onLog` subscription (line ~331) calls `reportMapIssue`
    unconditionally. Gate it: log lines may only RAISE an issue that the style
    pipeline has already independently concluded, never raise one on their own.

(c) `onStyleLoadFailed` (line ~247) calls `reportMapIssue('styleLoad')` BEFORE
    any retry is attempted, which contradicts the bounded-backoff design in
    map-style-recovery.ts. Move the report so it only happens when
    `planStyleLoadFailure` returns `{ kind: 'fallback' }` (budget spent) or when
    the offline fallback style is actually being shown. Stay silent during
    retries.

(d) Add auto-recovery: clear `styleLoad` on the next successful style/tile
    render, and re-run the pipeline when the network comes back
    (mobile/src/hooks/useNetworkStatus.ts already exists — subscribe to it).

(e) Copy: while the bundled offline fallback style is rendering, the map WORKS.
    Stop calling that a failure. Replace the red `map.issue.styleLoad` line with
    a neutral chip plus a Retry affordance, e.g. en/hi/mr:
      "Offline map — tap to retry"
    Keep a real red line only for the terminal state (no style, no fallback).
    Update i18n.en.ts / i18n.hi.ts / i18n.mr.ts together; i18n parity + clipping
    specs must stay green.

WEB
File: web/src/features/map/MapViewInner.tsx line ~394-402

`map.on('error', ...)` calls `onMapError('Map failed to load')` for EVERY error
event, including per-tile 404s and aborted requests during a pan. And
web/src/features/tracking/TripTracker.tsx never clears `mapError` except on a
manual "Retry map" click.

Required:
- Inspect the event: only surface errors that are style-level (no `sourceId`,
  or a style-URL request failure), not per-tile source errors.
- Require N consecutive failures (N=3) inside a short window before surfacing.
- Clear the error automatically on `map.on('idle')` / a successful `styledata`
  event, and expose that reset to TripTracker.
- Soften the copy to "Map tiles unavailable — retrying…" while retrying, and only
  "Map failed to load" when it has genuinely given up.

ACCEPTANCE
- On a good network, opening any tracking screen (driver, admin, parent; web and
  mobile) produces zero map-error lines.
- Toggling airplane mode raises the notice; turning the network back on clears it
  without an app restart and without a manual tap.
- A single 404 tile never produces a user-visible error.
- Diagnostics (Help screen, crew-diagnostics.ts) still records the raw codes, so a
  field screenshot can still name what happened.
- Unit tests: extend map-style-recovery.spec.ts / map-diagnostics.spec.ts with
  cases for "warn log that mentions maplibre does not raise an issue" and
  "issue clears when the network returns".
```

---

## PR-3 — P1 · Admin ko trip banate hi driver ke Boarding/Start buttons dikhte hain

> **Hinglish:** Admin ko crew ke lifecycle buttons nahi dikhne chahiye. Yeh UI
> gating ka bug hai — API jaan-boojh ke admin override allow karta hai.

```
Stop showing the crew's trip-lifecycle controls to school admins.

THE DEFECT
web/src/app/(authenticated)/trips/[id]/page.tsx line ~71-75 renders
`<TripStatusActions>` inside a "Lifecycle" card for every role, with no role
gate. `TRIP_STATUS_TRANSITIONS[SCHEDULED]` is
`[BOARDING, IN_PROGRESS, CANCELLED]` (packages/validation/src/index.ts:1245), so
the moment an admin schedules a trip, "Boarding" / "In progress" / "Cancelled"
appear as the first thing on the page. Same on mobile:
mobile/app/(admin)/trips/[id].tsx line ~177 renders the crew `TripStatusActions`.

Note: the API deliberately allows SCHOOL_ADMIN to PATCH /trips/:id/status
(web/src/server/api/trips.ts:114, trips.service.ts:412) as a dispatcher override.
Do NOT change the API contract in this PR.

DECISION (locked by the product owner, 30 Sep 2026): the admin KEEPS an emergency
override, but it must be hidden behind a disclosure + confirm dialog and recorded
in the audit log. Do not remove SCHOOL_ADMIN from the endpoint's roles.

REQUIRED
1. Driver / conductor surfaces (web /crew page, mobile (crew)/trip.tsx) keep the
   large forward-only crew buttons exactly as they are.
2. Admin trip detail (web and mobile) replaces them with a READ-ONLY lifecycle
   timeline: Scheduled -> Boarding -> In progress -> Completed, with the actual
   timestamps the trip carries and the current step highlighted. Cancelled shown
   as a terminal branch with its reason.
3. Below the timeline, a collapsed "Dispatcher override" disclosure (closed by
   default) containing the transition buttons, an explanatory sentence
   ("Use only when the crew device cannot act — this is recorded in the audit
   log"), and a confirm dialog before applying. Cancel keeps its existing
   reason-capture flow.
4. Make the role gate explicit and reusable rather than inline: a single
   `canActAsCrewOnTrip(user, trip)` helper used by every surface, unit-tested.
5. Mobile parity: mobile/app/(admin)/trips/[id].tsx gets the same timeline +
   collapsed override.

ACCEPTANCE
- A school admin creating a trip sees a status timeline, no crew buttons, unless
  they deliberately open "Dispatcher override".
- A driver/conductor sees no change at all.
- Audit log still records every transition with {from, to} and the actor.
- Tests cover: admin sees no crew buttons by default; admin can still override
  after confirming; crew path unchanged.
```

---

## PR-4 — P1 · Arrival zone circle bahut bada hai (5 m ka sawaal)

> **Hinglish:** 5 m physically possible nahi hai (phone GPS 10–30 m hoti hai) —
> to detection 25 m karo, aur dikhne wali cheez patli ring + exact distance kar
> do. Dono cheezein alag ho jayengi.

```
Fix the arrival zone: it currently draws a 100-150 m blob, and the requested 5 m
is not achievable with consumer GPS. Decouple DETECTION from DISPLAY.

CURRENT STATE (verified)
- web/src/server/config/eta.config.ts:150 -> ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS
  default 50 (runtime floor on every stop)
- web/src/server/modules/eta/stop-arrivals.service.ts:135 -> same default
- packages/validation/src/index.ts:747 -> stops cannot be saved below 30 m
- seeders (20260827120800) create stops at 100/120/150 m
- The driver map draws exactly max(stored, 50) via
  mobile/src/features/crew/arrival-zone.ts:42,70 -> trip-map-geometry.ts:126

DECISION (locked by the product owner, 30 Sep 2026): do BOTH halves below —
lower the detection floor to 25 m AND change the drawing to a thin ring plus a
live numeric distance. 5 m as a detection radius is explicitly rejected.

Why 5 m cannot be the detection radius: a fix only counts toward a stop when
`accuracy <= min(ARRIVAL_MAX_ACCURACY_METERS, effectiveRadius)`. Phone accuracy is
typically 5-30 m, so at 5 m essentially no fix qualifies and the original
"bus parked, manifest never opens" defect returns. Add a short note explaining
this in the eta.config.ts docblock so the number is never silently lowered again.

REQUIRED
1. DETECTION: lower the default floor from 50 m to 25 m
   (ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS), keeping it env-overridable. Lower the
   stop-create/edit minimum from 30 m to 15 m in packages/validation so an admin
   can tighten a well-surveyed stop. Re-tune nothing else — the anti-cascade work
   is carried by the departure/dwell/cooldown gates, which stay as they are.
2. ONE SOURCE OF TRUTH: the server must return `effective_radius_meters` on the
   stop/progress payloads. Delete the hardcoded mirror constant in
   mobile/src/features/crew/arrival-zone.ts and read the server value; keep a
   clearly-labelled fallback only for offline rendering.
3. DISPLAY: replace the heavy filled circle with
   - a thin dashed ring at the effective radius (low opacity, no heavy fill),
   - a small solid dot at the stop's exact surveyed coordinate,
   - a live distance readout on the next-stop card: "12 m from stop — inside
     zone" / "48 m from stop", using the same haversine the engine uses.
   The driver must be able to see real precision even when the tolerance circle
   is generous.
4. ADMIN UX: on the stop create/edit form (web and mobile), show a live preview
   of the geofence circle on a small map as the radius is typed, plus a helper
   line: "Smaller than ~20 m may never trigger on a phone".
5. ESCAPE HATCH: the crew manual stop-marking path already exists (migration
   20260926120000-add-crew-stop-marking-to-trip-stop-arrivals). Surface it on the
   next-stop card as a visible, one-tap "I'm at this stop — mark arrived" action
   with a hold-to-confirm, using the existing HoldToConfirmButton.

ACCEPTANCE
- A stop stored at 25 m draws a 25 m ring, not a 50 m one.
- The next-stop card always shows a numeric distance to the stop.
- A driver parked at a stop records arrival with a typical 15 m accuracy fix.
- The mobile constant is gone; changing the server env changes what the app draws.
- Existing arrival specs (stop-arrivals.service.spec.ts, arrival-zone.spec.ts)
  updated, not deleted, and green.
```

---

## PR-5 — P1 · Admin aur parent ka map bilkul driver jaisa (zoom / follow / fullscreen)

> **Hinglish:** Driver map ke saare controls admin aur parent ko bhi milenge —
> web aur mobile dono me. Code duplicate nahi hoga, ek shared shell banega.

```
Give the admin and parent maps the same capabilities the driver map already has,
by SHARING the implementation rather than copying it.

GAP (verified)
mobile/src/features/map/BusMap.tsx (used by mobile/app/(admin)/tracking.tsx and
mobile/app/(parent)/tracking.tsx) is missing everything DriverTripMap.tsx has:
  - fullscreen Modal            (DriverTripMap.tsx:878; i18n keys map.expand /
                                 map.exitFullscreen already exist and are unused here)
  - zoom +/- buttons            (DriverTripMap.tsx:771; policy already exists in
                                 mobile/src/features/map/map-controls.ts)
  - follow primary + follow switch + "waiting for fix" state
                                (driverFollowControls() in map-controls.ts)
  - <GestureIsland>             (DriverTripMap.tsx:841) -> without it, on Android
                                 the surrounding ScrollView steals pan and pinch.
                                 This is the exact P1-5 defect fixed for the driver
                                 in PR #186 and still live for admin/parent.
  - explicit dragPan / touchZoom / doubleTapZoom props (DriverTripMap.tsx:311-313),
    which maplibre-runtime.spec.ts pins as required on Android
  - next-stop highlight and arrival zone

DECISION (locked by the product owner, 30 Sep 2026): the CONDUCTOR must also get
this map, READ-ONLY. Today mobile/app/(crew)/trip.tsx gates the map and the GPS
strip behind `const isDriver = user?.role === UserRole.DRIVER` (line 133; blocks at
502, 513, 536), so a conductor sees no map at all. Split that single gate into two:
  - the map surface -> visible to DRIVER and CONDUCTOR,
  - the GPS sharing strip, the location watcher, and every "start/stop sharing"
    control -> DRIVER only, unchanged.
A conductor therefore sees the bus, the stops, the next stop and the arrival ring,
fed from the observer socket (useLiveTripTracking), and never starts a second GPS
stream from their own phone. Make the conductor's map variant read-only: no no-fix
CTA, no "your device" honesty line (it is not their device) — use the observer
copy instead.

On web, web/src/features/tracking/TripTracker.tsx forwards `mapControls` only from
the crew console; web/src/app/(authenticated)/tracking/page.tsx and
.../parent/tracking/page.tsx pass nothing, and web/src/features/map/MapViewInner.tsx
never adds a maplibregl NavigationControl / FullscreenControl / ScaleControl — so
NO web role gets zoom buttons or fullscreen.

REQUIRED
0. Implement the conductor read-only map described in the DECISION above, using
   the same shared surface as everything else in this PR (variant `'observer'`).
   A conductor's phone must still never start a location watcher — assert this
   with a test.
1. MOBILE: extract one `LiveMapSurface` component that owns the map body, the
   overlays and the controls, with a `variant: 'driver' | 'observer'` prop.
   Rewrite DriverTripMap and BusMap as thin wrappers over it. Do not fork the
   controls: both variants use map-controls.ts and useFollowCamera.
   Observer variant must get: GestureIsland, explicit gesture props, +/- zoom,
   follow primary + switch, fullscreen modal, next-stop highlight, and the arrival
   zone ring from PR-4. Driver variant keeps its extra panels (GPS honesty line,
   no-fix CTA, trail, planned legs).
2. WEB: add maplibregl NavigationControl (zoom + compass), ScaleControl and
   FullscreenControl to MapViewInner, and make the camera controls
   ("Fit route" / "Follow bus") default-on rather than opt-in. `controls` stays as
   an override for custom labels only. Ensure the buttons sit clear of the
   attribution/logo in the bottom corners.
3. Make admin and parent pages pass proper labels; parent labels should be
   parent-facing ("Show whole route" / "Follow the bus").
4. Keep accessibility parity with the driver map: accessibilityRole, live region
   announcing the follow state, 44 dp touch targets, prefers-reduced-motion.

ACCEPTANCE
- On an Android phone, pinch-zoom works inside the embedded admin and parent maps
  while the page still scrolls above and below them.
- Admin and parent can zoom with buttons, follow the bus, stop following, and go
  fullscreen — on web and on mobile.
- Zooming never knocks the camera out of follow mode (same guarantee as the driver
  map; follow-camera-controller.spec.ts already pins this).
- A conductor logging in sees the live map with the bus, and a test proves their
  device never starts a location watcher.
- No duplicated control policy: grep shows one definition of zoom step/bounds and
  one of the follow-control state machine.
```

---

## PR-6 — P1 · 3D, unique bus + better map UI/UX

> **Hinglish:** Ek hi bus design web aur mobile dono me — 3/4 isometric, gradient,
> shadow, live pulse, heading cone. Aur map pe optional 3D tilt + buildings.

```
Replace both bus markers with ONE shared, distinctly 3D-looking school bus, and
add an optional 3D map camera.

CURRENT STATE
- web/src/features/map/bus-marker-icon.ts:50 -> BUS_MARKER_SVG is five <rect>
  elements. This is the "very basic 2D" the user is reporting.
- mobile/src/features/map/BusMarkerGraphic.tsx -> a flat top-down 26x42 PNG
  (@1x/@2x/@3x) generated by scripts/make-bus-marker.py.
- The two are different buses despite comments claiming parity.
- Nothing in the codebase ever sets pitch / bearing / fill-extrusion / sky, so the
  map itself is completely flat.

PART A — ONE SHARED 3D-LOOKING BUS (required)
1. Create a small workspace package `packages/map-assets` exporting:
   - `BUS_MARKER_SVG` — a 3/4 isometric school bus, nose-up at heading 0, drawn
     with: gradient body (amber -> deeper amber), darker chassis and wheel wells,
     a glass windscreen with a specular highlight, a subtle roof line, and a
     soft elliptical ground shadow that is OUTSIDE the rotating group so it never
     spins with the bus;
   - `BUS_MARKER_BOX` geometry constants (width, height, rotation box) so the
     existing anchor math keeps working;
   - the same for the stop marker (a soft-lifted pin with a ring), keeping stops a
     visibly different species from the bus.
2. Web inlines the SVG once via <defs>/<use> so creating a marker is not an
   innerHTML parse.
3. Mobile keeps the PNG pipeline but generates it FROM this SVG — update
   scripts/make-bus-marker.py (or replace it with an SVG->PNG rasteriser) so both
   platforms are provably the same artwork. Keep the existing
   bus-marker-invariants.spec.ts guarantees (exact px box, RGBA, densities).
4. Marker states, driven by data that already exists:
   - live + moving  -> full colour, gentle pulse halo, heading cone ahead of the
     bus (only above the 3 km/h heading gate that bus-motion.ts already enforces);
   - live + stopped -> full colour, no cone;
   - last known / stale -> desaturated, no pulse (today only the text says stale);
   - reduced motion -> no pulse, no tween (useReducedMotion / prefers-reduced-motion).
5. Marker must stay decorative for screen readers; the callout and status card
   keep carrying the information.

PART B — 3D MAP CAMERA (required, behind a toggle)
1. Add a "2D / 3D" toggle to the map controls.
   - 3D = pitch 45 (maxPitch 60), plus a building `fill-extrusion` layer at
     zoom >= 15 and a sky layer, using the existing OpenFreeMap vector source —
     no new tile provider, no key, no billing (the provider policy in
     docs/live-tracking-map.md must not change).
   - 2D = today's behaviour exactly.
2. Defaults: admin and parent default to 3D; the DRIVER defaults to 2D and keeps
   touchRotate/touchPitch disabled. The driver decision is documented in
   DriverTripMap.tsx:314-317 for safety reasons — honour it, do not silently flip it.
3. Persist the toggle per user (the same storage the app already uses for
   preferences) so it is not re-chosen every screen.
4. Performance guard: if the device reports reduced motion, or the frame budget is
   missed repeatedly, fall back to 2D and say so once.

PART C — MAP UI/UX POLISH (required)
- Give the status panel, the controls and the notices one consistent visual
  language across driver / admin / parent (they currently drift).
- Bottom corners stay reserved for attribution and logo; controls stay in the top
  and right edges.
- Add a compact legend (bus / next stop / stop / driven path / planned order)
  behind an info affordance rather than as permanent text below the map.

ACCEPTANCE
- One bus artwork, one source file; grep finds no second bus definition.
- Web and mobile screenshots show the same vehicle.
- The 3D toggle works on web and mobile and never changes the driver default.
- Marker rotation still keeps the vehicle centre exactly on the GPS coordinate at
  every heading (existing invariant specs stay green).
- No new runtime dependency heavier than ~20 KB gzipped; explicitly NO three.js /
  deck.gl in this PR.
```

---

## PR-7 — P2 · Reuse, dedupe, speed

> **Hinglish:** ~2,500 lines ka duplicate map logic ek shared package me. Aur N
> stop markers ki jagah ek layer — Android pe sabse bada speed win.

```
Remove the web/mobile map-code duplication and make the maps measurably faster.
This is a refactor PR: behaviour must not change, and every moved spec must keep
passing.

DUPLICATION (verified, near-identical copies with duplicated specs)
  bus-motion.ts            web 581 + spec 673   |  mobile 646 + spec 790
  follow-camera.ts         web 154 + spec 178   |  mobile 156 + spec 178
  tracking-presentation.ts web 153 + spec 174   |  mobile 154 + spec 199
  accuracy-circle.ts       web 67               |  mobile 95 + spec 107
  map-style.ts             web 83 + spec 111    |  mobile 315 + spec 263
  geo                      web/features/map/geo.ts | mobile/src/lib/geo.ts

PART A — packages/map-core (new workspace package, pure TS, zero React/native)
Move and de-duplicate: bus-motion, follow-camera, follow-camera-controller,
map-controls, tracking-presentation, accuracy-circle, fit-camera, route-snap,
geo (haversine/bearing), map-style policy, arrival-zone math. Move the spec files
with them so there is ONE suite. Web and mobile import from the package; keep thin
platform adapters where a genuine platform difference exists, and document each
one in a short comment.

PART B — speed
1. Stops as ONE layer, not N markers.
   - mobile: replace the per-stop <StopMarker> ViewAnnotations with a single
     ShapeSource + SymbolLayer (+ a text layer for the label). On Android each
     ViewAnnotation is an offscreen bitmap rasterisation; a 30-stop route is 30 of
     them. This is the single biggest win.
   - web: replace the per-stop maplibregl.Marker DOM nodes with a GeoJSON symbol
     layer. Keep the popup behaviour via a click handler on the layer.
2. web/src/features/map/MapViewInner.tsx (855 lines) currently re-creates the whole
   map when `hasAnything` flips. Create the map once and only update sources.
   Split the file into useMapInstance / useBusMarker / useStopLayer /
   useCameraControls hooks.
3. Decimate the trail line (Douglas-Peucker, tolerance ~5 m) before writing it to
   the source. A two-hour trip at one fix per 4 s is ~1,800 points being re-set on
   every fix today.
4. Keep the rAF loop throttled as it is (FRAME_MIN_INTERVAL_MS) and keep marker
   movement transform-only.
5. Ensure maplibre-gl stays in its own lazily-loaded chunk on web (MapView is
   already next/dynamic ssr:false — verify the CSS rides the same chunk).

PART C — guardrails
- Add a lint rule or a test that fails if a module is duplicated between
  web/src/features/map and mobile/src/features/map.
- Record the before/after numbers in docs/live-tracking-map.md: bundle size of the
  map chunk, number of native annotations for a 30-stop route, and frame time on a
  mid-range Android device.

ACCEPTANCE
- `npm run typecheck && npm run lint && npm test` green.
- No behaviour change: every existing map spec passes unmodified (moved, not
  rewritten).
- A 30-stop route creates 1 stop layer, not 30 markers, on both platforms.
- Duplicate-module guard fails if someone re-forks a map module.
```

---

## Ek chhota reminder

Har PR ke baad ye chalana:

```bash
npm run typecheck && npm run lint
npm --prefix web test
npm --prefix mobile test && npm --prefix mobile run test:sim
```

Aur teen cheezein sirf **asli phone** pe prove hongi (Node test nahi kar sakta):

1. Android pe pinch/pan gesture ownership (PR-5),
2. MapLibre ke asli native log lines (PR-2 ka allow-list),
3. 3D pitch ka performance low-end Android pe (PR-6).
