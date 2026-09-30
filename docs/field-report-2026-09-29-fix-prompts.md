# Fix prompts — 29 Sep 2026 field report

**4 zaroori session + 1 optional.** Pehle 7 the; jinke files aur test surface
same the unhe merge kar diya, kyunki wahi kaam do baar karna waste bhi hai aur
risky bhi (ek hi file do PR me chhedna = merge conflict + dobara regression).

Har session ek fresh chat me chalao, **order me**, aur agla shuru karne se pehle
pichla merge kar do.

Background aur root-cause analysis: [`field-report-2026-09-29-analysis.md`](./field-report-2026-09-29-analysis.md)

---

## Session map

| Session | Naam                                            | Aapke issue | Sev | Size   | Depends on |
| ------- | ----------------------------------------------- | ----------- | --- | ------ | ---------- |
| **1**   | Map jhoot bolna band kare                       | #2, #3      | P0  | M      | —          |
| **2**   | Admin role gate + arrival zone                  | #6, #1      | P1  | M      | —          |
| **3**   | Ek shared map: parity + conductor + speed       | #4, #8, #7a | P1  | **L**  | —          |
| **4**   | 3D bus + 3D map + UI polish                     | #5          | P1  | M      | Session 3  |
| **5**   | _(optional)_ dedupe: `packages/map-core`        | #7b         | P2  | L      | 1–4        |

Session 1, 2 aur 3 ek dusre se **independent** hain — agar chaaho to order badal
sakte ho. Session 4 ko Session 3 ke baad hi chalana (wo usi shared surface pe
banega). Session 5 sabse aakhir me, ya kabhi nahi.

### Decisions — locked (30 Sep 2026)

| Sawaal                            | Faisla                                                                                     | Kahan     |
| --------------------------------- | -------------------------------------------------------------------------------------------- | --------- |
| Arrival circle kitna bada?        | **Detection 25 m + display patli ring** — dono. Plus live distance + manual "mark arrived"     | Session 2 |
| Admin ko status override chahiye? | **Haan, par chhupa hua** — read-only timeline + collapsed override + confirm + audit          | Session 2 |
| Conductor ko map dikhe?           | **Haan, read-only** — position dikhe, GPS sharing sirf driver ke phone se                      | Session 3 |

---

## Har session ke baad kya karna hai

```bash
npm run typecheck && npm run lint
npm --prefix web test
npm --prefix mobile test && npm --prefix mobile run test:sim
```

Aur phone pe check karo (ye Node test se prove nahi hota):

| Session | Phone pe kya dekhna hai |
| ------- | ------------------------ |
| 1       | Net ON karke trip kholo — koi red "Map failed to load" na aaye. Bus turant dikhe. Airplane mode ON→OFF karke dekho notice khud clear hoti hai. |
| 2       | Ek stop pe bus khadi karke dekho arrival record hota hai. Admin se trip banao — Boarding/Start buttons na dikhein. |
| 3       | **Android pe embedded admin/parent map pe pinch karo** — map zoom ho, page scroll na ho. Conductor se login karke map dikhe. |
| 4       | 3D toggle chalao, low-end phone pe lag check karo. Bus web aur mobile pe same dikhe. |

Agar kuch adhoora reh jaye to usi session me bolo: _"Session N ka Part X adhura
hai, sirf wahi complete karo, baaki mat chhedo."_

---

# SESSION 1 — Map jhoot bolna band kare (P0)

> **Hinglish:** Bus dikhe, aur jhoota "Map failed to load" khatam ho. Dono bug
> ek hi files me hain, isliye ek saath.

```
Fix two P0 defects on the live map. Both root causes are already located — verify, then fix. Do not re-diagnose from scratch.

=== DEFECT A: the bus never appears on the web map ===

File: web/src/features/map/MapViewInner.tsx

The bus-marker effect (~line 680) begins with `if (!mapRef.current) return;` but its dependency array (~line 735) is [fix, presentation.animate, applyFrame, startLoop] — nothing about map readiness. The map is created by a DIFFERENT effect gated on [webglSupported, hasAnything], and webglSupported is null on the first render. So:

  1. first render -> webglSupported null -> no map created
  2. the REST snapshot resolves -> `fix` is set -> marker effect runs -> mapRef.current is null -> returns
  3. the WebGL check completes -> re-render -> the map is created
  4. the marker effect never runs again (fix unchanged) -> no bus marker, permanently

Stop markers survive only by luck (mappedStops arrives later, after the map exists).

Fix:
- Add an explicit readiness signal: `const [mapReady, setMapReady] = useState(false)`, set true inside `map.on('load')`, set false in the init effect's cleanup.
- Add `mapReady` to the deps of EVERY effect that mutates the map imperatively: bus marker, stop markers, route line, trail line, accuracy circle.
- Preferred shape: one `syncOverlays()` routine called both from `map.on('load')` and from the data effects, so this ordering can never regress again.
- After the bus marker is created for the first time, dispatch { type: 'data-available' } if no fit has happened yet, so the camera actually frames the bus.

=== DEFECT B: "Map failed to load — check your network connection and map tiles" with the network ON ===

B1 — MOBILE. File: mobile/src/features/map/use-map-style.ts

  * `classifyMapLog` (~line 93) treats ANY MapLibre log at level warn/error whose text merely CONTAINS 'style', 'maplibre' or 'mbgl' as a styleLoad failure. MapLibre-native emits such warnings routinely (unsupported style property, sprite miss, one 404 tile, a request cancelled during a fast pan). Replace the substring heuristic with a strict allow-list of genuinely fatal patterns only — e.g. "failed to load style", "unable to fetch style", "style is not done loading", and style-URL requests returning HTTP 4xx/5xx. Everything else returns null. Apply the same strictness to 'glyphs' (one missing glyph range is not "labels unavailable").
  * The `LogManager.onLog` subscription (~line 331) calls reportMapIssue unconditionally. Gate it: a log line may only corroborate an issue the style pipeline already concluded — never raise one by itself.
  * `onStyleLoadFailed` (~line 247) reports styleLoad BEFORE any retry runs, contradicting the bounded-backoff design in map-style-recovery.ts. Report only when planStyleLoadFailure returns { kind: 'fallback' } (budget spent) or the offline fallback style is actually showing. Stay silent during retries.
  * Add auto-recovery: clear styleLoad on the next successful style/tile render, and re-run the pipeline when the network returns (mobile/src/hooks/useNetworkStatus.ts already exists — subscribe to it).
  * Copy: while the bundled offline fallback style is rendering, the map WORKS — stop calling that a failure. Replace the red map.issue.styleLoad line with a neutral chip plus a Retry affordance ("Offline map — tap to retry"). Keep a red line only for the terminal state. Update i18n.en.ts / i18n.hi.ts / i18n.mr.ts together; the i18n parity and clipping specs must stay green.

B2 — WEB. Files: web/src/features/map/MapViewInner.tsx (~line 394-402), web/src/features/tracking/TripTracker.tsx (~line 195)

  * `map.on('error', ...)` calls onMapError('Map failed to load') for EVERY error event, including per-tile 404s and aborts during a pan. And TripTracker never clears mapError except on a manual "Retry map" click.
  * Inspect the event: surface only style-level failures (no sourceId, or a style-URL request failure), not per-tile source errors.
  * Require 3 consecutive failures in a short window before surfacing anything.
  * Clear automatically on map.on('idle') / a successful 'styledata' event; expose that reset to TripTracker.
  * Soften the copy: "Map tiles unavailable — retrying…" while retrying; "Map failed to load" only when it has genuinely given up.

=== ACCEPTANCE ===
- A trip whose only fix came from the REST snapshot (no live socket traffic) shows the bus marker on the web admin map within one render.
- Reloading /tracking on a completed trip still shows the last-known bus.
- On a good network, every tracking screen (driver, admin, parent; web and mobile) shows zero map-error lines.
- Airplane mode raises the notice; turning the network back on clears it with no app restart and no manual tap.
- A single 404 tile never produces a user-visible error.
- Help -> Diagnostics still records the raw codes so a field screenshot can name what failed.
- New tests: (a) a fake map created AFTER the first fix still ends up with a bus marker; (b) a warn log mentioning "maplibre" raises no issue; (c) an issue clears when the network returns.

=== CONSTRAINTS ===
- No new runtime dependency.
- Do not touch the pure policy modules (bus-motion, follow-camera, tracking-presentation) — this is a wiring bug, not a policy bug.
- npm run typecheck && npm run lint && npm --prefix web test && npm --prefix mobile test must pass.
```

---

# SESSION 2 — Admin role gate + arrival zone (P1)

> **Hinglish:** Admin ko driver ke buttons na dikhein, aur circle 25 m ka +
> patli ring + exact distance. Is session me map engine ko haath nahi lagana.

```
=== HOW TO WORK THIS TASK (read this first) ===
- node_modules is NOT installed in a fresh checkout. Your FIRST command is `npm install` from the repo root (~40 s; its postinstall builds the five workspace packages). Nothing — typecheck, lint, tests — works before that.
- The diagnosis below is already verified against this codebase, with file paths and line numbers. Do NOT re-read whole files to confirm it, and do NOT re-diagnose from scratch. Open a file only when you are about to change it, and read only the region you are changing.
- Work file by file and EDIT AS YOU GO. Exploring everything up front is what exhausts a session before a single line of code is written.
- Run the verification suite ONCE, at the end.
- If you start running low on room: stop, make the part you have already finished green and committed, and say plainly which part is untouched.

Two independent P1 fixes in the trip/stop domain. No map-engine work in this session.

=== PART 1: the admin sees the crew's Boarding/Start buttons the moment a trip is created ===

Defect: web/src/app/(authenticated)/trips/[id]/page.tsx (~line 71-75) renders <TripStatusActions> in a "Lifecycle" card for every role with no role gate. TRIP_STATUS_TRANSITIONS[SCHEDULED] is [BOARDING, IN_PROGRESS, CANCELLED] (packages/validation/src/index.ts:1245), so three crew buttons appear at the top of the page as soon as an admin schedules a trip. Same on mobile: mobile/app/(admin)/trips/[id].tsx (~line 177) renders the crew TripStatusActions.

The API deliberately allows SCHOOL_ADMIN to PATCH /trips/:id/status (web/src/server/api/trips.ts:114, trips.service.ts:412) as a dispatcher override. DECISION (locked by the product owner): keep that override, but hide it. Do NOT change the endpoint's roles.

Required:
1. Driver/conductor surfaces (web /crew, mobile (crew)/trip.tsx) keep their large forward-only crew buttons unchanged.
2. Admin trip detail (web AND mobile) shows a READ-ONLY lifecycle timeline instead: Scheduled -> Boarding -> In progress -> Completed, with the trip's real timestamps and the current step highlighted; Cancelled rendered as a terminal branch with its reason.
3. Below it, a COLLAPSED "Dispatcher override" disclosure (closed by default) containing the transition buttons, the sentence "Use only when the crew device cannot act — this is recorded in the audit log", and a confirm dialog before applying. Cancel keeps its existing reason-capture flow.
4. Add one reusable, unit-tested helper `canActAsCrewOnTrip(user, trip)` and use it everywhere instead of inline role checks.

=== PART 2: the arrival zone circle is far too large, and 5 m is impossible ===

Current state (verified):
  - web/src/server/config/eta.config.ts:150 — ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS default 50 (runtime floor on every stop)
  - web/src/server/modules/eta/stop-arrivals.service.ts:135 — same default
  - packages/validation/src/index.ts:747 — stops cannot be saved below 30 m
  - seeders/20260827120800 — demo stops are 100/120/150 m
  - the driver map draws exactly max(stored, 50) via mobile/src/features/crew/arrival-zone.ts:42,70 -> trip-map-geometry.ts:126

Why 5 m cannot be the DETECTION radius: a fix only counts toward a stop when accuracy <= min(ARRIVAL_MAX_ACCURACY_METERS, effectiveRadius). Phone accuracy is typically 5-30 m, so at 5 m essentially no fix qualifies and the original "bus parked, manifest never opens" defect returns. Put this reasoning in the eta.config.ts docblock so the number is never silently lowered again.

DECISION (locked by the product owner): do BOTH halves — lower detection to 25 m AND make the drawing precise. 5 m detection is rejected.

Required:
1. DETECTION: default floor 50 m -> 25 m (still env-overridable). Stop create/edit minimum 30 m -> 15 m in packages/validation (both stopCreateSchema at ~line 747 and the import cell at ~line 2767). Change nothing else about the arrival gates — the anti-cascade work is carried by the departure/dwell/cooldown gates.
2. ONE SOURCE OF TRUTH: the server must return `effective_radius_meters` on the stop / trip-progress payloads. Delete the hardcoded mirror constant ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS from mobile/src/features/crew/arrival-zone.ts and read the server value; keep a clearly-labelled fallback for offline rendering only.
3. DISPLAY: replace the heavy filled circle with — a thin dashed ring at the effective radius (low opacity, no heavy fill), a small solid dot at the stop's exact surveyed coordinate, and a live distance readout on the next-stop card ("12 m from stop — inside zone" / "48 m from stop") using the same haversine the engine uses.
4. ADMIN UX: on the stop create/edit form (web and mobile), show a live preview of the geofence circle on a small map as the radius is typed, plus the helper line "Smaller than ~20 m may never trigger on a phone".
5. ESCAPE HATCH: the crew manual stop-marking path already exists (migration 20260926120000-add-crew-stop-marking-to-trip-stop-arrivals). Surface it on the next-stop card as a visible one-tap "I'm at this stop — mark arrived" using the existing HoldToConfirmButton.

=== ACCEPTANCE ===
- A school admin creating a trip sees a status timeline, no crew buttons, unless they deliberately open "Dispatcher override".
- A driver/conductor sees no change at all.
- Every transition is still audit-logged with {from, to} and the actor.
- A stop stored at 25 m draws a 25 m ring, not 50 m.
- The next-stop card always shows a numeric distance to the stop.
- A driver parked at a stop records the arrival with a typical 15 m accuracy fix.
- The mobile mirror constant is gone; changing the server env changes what the app draws.
- Existing specs (stop-arrivals.service.spec.ts, arrival-zone.spec.ts) updated, not deleted, and green.
- npm run typecheck && npm run lint && npm --prefix web test && npm --prefix mobile test pass.
```

---

# SESSION 3 — Ek shared map: parity + conductor + speed (P1, sabse bada)

> **Hinglish:** Admin, parent aur conductor ko wahi map mile jo driver ko milta
> hai — aur kyunki surface waise bhi rewrite ho raha hai, speed wala fayda
> (stops = ek layer) usi me muft mil jayega.

```
=== HOW TO WORK THIS TASK (read this first) ===
- node_modules is NOT installed in a fresh checkout. Your FIRST command is `npm install` from the repo root (~40 s; its postinstall builds the five workspace packages). Nothing — typecheck, lint, tests — works before that.
- The diagnosis below is already verified against this codebase, with file paths and line numbers. Do NOT re-read whole files to confirm it, and do NOT re-diagnose from scratch. Open a file only when you are about to change it, and read only the region you are changing.
- Work file by file and EDIT AS YOU GO. Exploring everything up front is what exhausts a session before a single line of code is written.
- Run the verification suite ONCE, at the end.
- If you start running low on room: stop, make the part you have already finished green and committed, and say plainly which part is untouched.

Give the admin, parent and conductor maps everything the driver map already has, by SHARING one implementation instead of copying it — and take the free performance win while the surface is being rewritten.

=== THE GAP (verified) ===
mobile/src/features/map/BusMap.tsx (used by mobile/app/(admin)/tracking.tsx and mobile/app/(parent)/tracking.tsx) is missing everything DriverTripMap.tsx has:
  - fullscreen Modal            — DriverTripMap.tsx:878 (i18n keys map.expand / map.exitFullscreen already exist, unused here)
  - zoom +/- buttons            — DriverTripMap.tsx:771 (policy already exists in mobile/src/features/map/map-controls.ts)
  - follow primary + follow switch + "waiting for fix" state — driverFollowControls() in map-controls.ts
  - <GestureIsland>             — DriverTripMap.tsx:841. Without it, on Android the surrounding ScrollView steals pan and pinch. This is the exact P1-5 defect fixed for the driver in PR #186 and still live for admin/parent.
  - explicit dragPan / touchZoom / doubleTapZoom props — DriverTripMap.tsx:311-313, which maplibre-runtime.spec.ts pins as required on Android
  - next-stop highlight and the arrival-zone ring

On web, web/src/features/tracking/TripTracker.tsx forwards `mapControls` only from the crew console; web/src/app/(authenticated)/tracking/page.tsx and .../parent/tracking/page.tsx pass nothing, and web/src/features/map/MapViewInner.tsx never adds a NavigationControl / FullscreenControl / ScaleControl — so NO web role gets zoom buttons or fullscreen.

=== CONDUCTOR (decision locked by the product owner) ===
The conductor must get this map, READ-ONLY. Today mobile/app/(crew)/trip.tsx gates the map AND the GPS strip behind one flag — `const isDriver = user?.role === UserRole.DRIVER` (line 133; blocks at 502, 513, 536) — so a conductor sees no map at all. Split that single gate in two:
  - the map surface -> visible to DRIVER and CONDUCTOR
  - the GPS sharing strip, the location watcher and every start/stop-sharing control -> DRIVER only, unchanged
The conductor's position comes from the observer socket (useLiveTripTracking), never from their own phone. Their map variant is read-only: no no-fix CTA, and observer copy rather than the driver's "your device" honesty line.

=== REQUIRED ===
1. MOBILE: extract ONE `LiveMapSurface` component owning the map body, overlays and controls, with a `variant: 'driver' | 'observer'` prop. Rewrite DriverTripMap and BusMap as thin wrappers over it. Both variants use map-controls.ts and useFollowCamera — do not fork the control policy.
   - observer variant gets: GestureIsland, explicit gesture props, +/- zoom, follow primary + switch, fullscreen modal, next-stop highlight, arrival-zone ring.
   - driver variant keeps its extra panels (GPS honesty line, no-fix CTA, trail, planned legs).
2. WEB: add maplibregl NavigationControl (zoom + compass), ScaleControl and FullscreenControl to MapViewInner, and make the camera controls ("Fit route" / "Follow bus") default-on rather than opt-in. `controls` stays as a label override only. Keep the buttons clear of the attribution and logo in the bottom corners.
3. Admin and parent pages pass proper labels; parent labels are parent-facing ("Show whole route" / "Follow the bus").
4. Replace the mobile web fallbacks — mobile/src/features/map/BusMap.web.tsx and mobile/src/features/crew/DriverTripMap.web.tsx currently render a text list instead of a map, so `npm run web` shows no bus at all. Render a real maplibre-gl map there, reusing the same style policy (mobile/src/features/map/map-style.ts). Keep the list only as the degraded state when WebGL is unavailable.
5. Make the mobile `needs-dev-build` panel say plainly that Expo Go carries no map engine and a development build is required (i18n keys map.needsDevBuildTitle / map.needsDevBuildBody already exist — copy change only).
6. PERFORMANCE, taken while the surface is being rewritten anyway:
   - stops become ONE layer instead of N markers. Mobile: a single ShapeSource + SymbolLayer (+ a text layer) instead of per-stop ViewAnnotations — on Android each ViewAnnotation is an offscreen bitmap rasterisation, so a 30-stop route is 30 of them. Web: a GeoJSON symbol layer instead of per-stop DOM markers, with popups via a layer click handler.
   - web: create the map once. Today MapViewInner re-creates the entire map when `hasAnything` flips; only sources should update.
   - decimate the trail line (Douglas-Peucker, ~5 m tolerance) before writing it to the source. A two-hour trip at one fix per 4 s is ~1,800 points re-set on every fix today.
7. Accessibility parity with the driver map: accessibilityRole, a live region announcing the follow state, 44 dp touch targets, prefers-reduced-motion respected.

=== ACCEPTANCE ===
- On an Android phone, pinch-zoom works inside the embedded admin and parent maps while the page still scrolls above and below them.
- Admin, parent and conductor can zoom with buttons, follow the bus, stop following and go fullscreen — on web and on mobile.
- A conductor sees the live map; a test proves their device never starts a location watcher.
- Zooming never knocks the camera out of follow mode (follow-camera-controller.spec.ts already pins this).
- A 30-stop route creates 1 stop layer, not 30 markers, on both platforms.
- `npm run web` in mobile/ shows a real map with the bus.
- grep shows ONE definition of the zoom step/bounds and ONE of the follow-control state machine.
- npm run typecheck && npm run lint && npm --prefix web test && npm --prefix mobile test && npm --prefix mobile run test:sim pass.

=== CONSTRAINTS ===
- This is a large change. If you cannot finish it all, finish items 1-3 completely (the parity + conductor core) and stop there with a clean, green tree — do NOT leave item 6 half-applied.
```

---

# SESSION 4 — 3D bus + 3D map + UI polish (P1)

> **Hinglish:** Ek hi bus web aur mobile dono me — 3/4 isometric, gradient,
> shadow, live pulse. Plus map pe optional 3D tilt aur buildings.
> **Session 3 ke baad hi chalao.**

```
=== HOW TO WORK THIS TASK (read this first) ===
- node_modules is NOT installed in a fresh checkout. Your FIRST command is `npm install` from the repo root (~40 s; its postinstall builds the five workspace packages). Nothing — typecheck, lint, tests — works before that.
- The diagnosis below is already verified against this codebase, with file paths and line numbers. Do NOT re-read whole files to confirm it, and do NOT re-diagnose from scratch. Open a file only when you are about to change it, and read only the region you are changing.
- Work file by file and EDIT AS YOU GO. Exploring everything up front is what exhausts a session before a single line of code is written.
- Run the verification suite ONCE, at the end.
- If you start running low on room: stop, make the part you have already finished green and committed, and say plainly which part is untouched.

Replace both bus markers with ONE shared, distinctly 3D-looking school bus, and add an optional 3D map camera. This builds on the shared LiveMapSurface from the previous session.

=== CURRENT STATE ===
- web/src/features/map/bus-marker-icon.ts:50 — BUS_MARKER_SVG is five <rect> elements. This is the "very basic 2D" being reported.
- mobile/src/features/map/BusMarkerGraphic.tsx — a flat top-down 26x42 PNG (@1x/@2x/@3x) generated by scripts/make-bus-marker.py.
- The two are different buses despite comments claiming parity.
- Nothing in the codebase sets pitch / bearing / fill-extrusion / sky — the map itself is completely flat.

=== PART A — ONE SHARED 3D-LOOKING BUS ===
1. Create a small workspace package `packages/map-assets` exporting:
   - BUS_MARKER_SVG — a 3/4 isometric school bus, nose-up at heading 0, with a gradient body (amber -> deeper amber), darker chassis and wheel wells, a glass windscreen with a specular highlight, a roof line, and a soft elliptical ground shadow placed OUTSIDE the rotating group so it never spins with the bus.
   - BUS_MARKER_BOX geometry constants (width, height, rotation box) so the existing anchor maths keeps working.
   - the stop marker too (a soft-lifted pin with a ring), keeping stops a visibly different species from the bus.
2. Web inlines the SVG once via <defs>/<use>, so creating a marker is not an innerHTML parse.
3. Mobile keeps the PNG pipeline but generates it FROM this SVG — update scripts/make-bus-marker.py (or replace it with an SVG->PNG rasteriser) so both platforms are provably the same artwork. Keep every guarantee in bus-marker-invariants.spec.ts (exact px box, RGBA, three densities).
4. Marker states, driven by data that already exists:
   - live + moving  -> full colour, gentle pulse halo, heading cone ahead of the bus (only above the 3 km/h heading gate bus-motion.ts already enforces)
   - live + stopped -> full colour, no cone
   - last known / stale -> desaturated, no pulse (today only the text says stale)
   - reduced motion -> no pulse, no tween (useReducedMotion / prefers-reduced-motion)
5. The marker stays decorative for screen readers; the callout and status card keep carrying the information.

=== PART B — 3D MAP CAMERA, BEHIND A TOGGLE ===
1. Add a "2D / 3D" toggle to the map controls.
   - 3D = pitch 45 (maxPitch 60), a building fill-extrusion layer at zoom >= 15, and a sky layer, all from the existing OpenFreeMap vector source. No new tile provider, no key, no billing — the provider policy in docs/live-tracking-map.md must not change.
   - 2D = today's behaviour exactly.
2. Defaults: admin and parent default to 3D; the DRIVER defaults to 2D and keeps touchRotate/touchPitch disabled. That driver decision is documented in DriverTripMap.tsx:314-317 for safety reasons — honour it, do not silently flip it.
3. Persist the toggle per user using the app's existing preference storage.
4. Performance guard: if the device reports reduced motion, or frames are repeatedly dropped, fall back to 2D and say so once.

=== PART C — UI/UX POLISH ===
- One consistent visual language for the status panel, controls and notices across driver / admin / parent (they currently drift).
- Bottom corners stay reserved for attribution and logo; controls stay top and right.
- A compact legend (bus / next stop / stop / driven path / planned order) behind an info affordance rather than permanent text below the map.

=== ACCEPTANCE ===
- One bus artwork, one source file; grep finds no second bus definition.
- Web and mobile screenshots show the same vehicle.
- The 3D toggle works on web and mobile and never changes the driver default.
- Marker rotation still keeps the vehicle centre exactly on the GPS coordinate at every heading (existing invariant specs green).
- No new runtime dependency heavier than ~20 KB gzipped. Explicitly NO three.js / deck.gl.
- npm run typecheck && npm run lint && npm --prefix web test && npm --prefix mobile test pass.
```

---

# SESSION 5 _(optional)_ — dedupe: `packages/map-core` (P2)

> **Hinglish:** ~2,500 lines duplicate code ek package me. Ye sirf refactor hai —
> koi naya feature nahi. Session 1–4 merge aur stable hone ke baad hi karo, ya
> skip kar do.

```
=== HOW TO WORK THIS TASK (read this first) ===
- node_modules is NOT installed in a fresh checkout. Your FIRST command is `npm install` from the repo root (~40 s; its postinstall builds the five workspace packages). Nothing — typecheck, lint, tests — works before that.
- The diagnosis below is already verified against this codebase, with file paths and line numbers. Do NOT re-read whole files to confirm it, and do NOT re-diagnose from scratch. Open a file only when you are about to change it, and read only the region you are changing.
- Work file by file and EDIT AS YOU GO. Exploring everything up front is what exhausts a session before a single line of code is written.
- Run the verification suite ONCE, at the end.
- If you start running low on room: stop, make the part you have already finished green and committed, and say plainly which part is untouched.

Remove the web/mobile map-code duplication. This is a pure refactor: behaviour must not change and every moved spec must keep passing. Run it only after the previous sessions are merged and stable.

=== DUPLICATION (verified — near-identical copies, with duplicated specs) ===
  bus-motion.ts             web 581 + spec 673   |  mobile 646 + spec 790
  follow-camera.ts          web 154 + spec 178   |  mobile 156 + spec 178
  tracking-presentation.ts  web 153 + spec 174   |  mobile 154 + spec 199
  accuracy-circle.ts        web 67               |  mobile 95 + spec 107
  map-style.ts              web 83 + spec 111    |  mobile 315 + spec 263
  geo                       web/src/features/map/geo.ts  |  mobile/src/lib/geo.ts
Roughly 2,500 lines of near-duplicate logic, plus two map-style policies that are meant to mirror each other but are not enforced to.

=== REQUIRED ===
1. New workspace package `packages/map-core` — pure TypeScript, zero React, zero native imports. Move and de-duplicate: bus-motion, follow-camera, follow-camera-controller, map-controls, tracking-presentation, accuracy-circle, fit-camera, route-snap, geo (haversine/bearing), the map-style policy, and the arrival-zone maths. Move the spec files with them so there is ONE suite instead of two.
2. Web and mobile import from the package. Keep thin platform adapters only where a genuine platform difference exists, and document each one in a comment.
3. Split web/src/features/map/MapViewInner.tsx (855 lines) into useMapInstance / useBusMarker / useStopLayer / useCameraControls.
4. Keep maplibre-gl in its own lazily-loaded chunk on web (MapView is already next/dynamic ssr:false — verify the CSS rides the same chunk).
5. Guardrail: add a lint rule or a test that FAILS if a module is duplicated between web/src/features/map and mobile/src/features/map.
6. Record before/after numbers in docs/live-tracking-map.md: map chunk bundle size, native annotation count for a 30-stop route, and frame time on a mid-range Android device.

=== ACCEPTANCE ===
- Zero behaviour change: every existing map spec passes unmodified (moved, not rewritten).
- The duplicate-module guard fails if someone re-forks a map module.
- npm run typecheck && npm run lint && npm --prefix web test && npm --prefix mobile test green.
```

---

## Agar kuch galat ho jaye

| Situation | Kya bolna hai |
| --------- | -------------- |
| Session adhura chhoda | _"Session N ka Part X adhura hai — sirf wahi complete karo, baaki kuch mat chhedo."_ |
| Test red ho gaye | _"`npm --prefix mobile test` red hai. Pehle test fix karo, feature nahi — aur batao kaunsa contract toota."_ |
| Agent ne extra kaam kar diya | _"Scope se bahar changes revert karo. Sirf prompt me likhi cheezein rakho."_ |
| Phone pe kaam nahi kar raha | _"Device pe X ho raha hai, expected Y tha. Session N ke us hisse ko dobara dekho — naya feature mat banao."_ |
