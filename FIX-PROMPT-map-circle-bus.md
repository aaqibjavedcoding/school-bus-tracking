# FIX PROMPT (paste into a new session) — Live map: circle, bus marker, arrival → manifest + voice

## Context (repo: aaqibjavedcoding/school-bus-tracking, monorepo)
- `web/` — Next.js parent/admin console, MapLibre GL JS map (`web/src/features/map/MapViewInner.tsx`).
- `mobile/` — Expo React Native app (driver/conductor/parent), native map via `@maplibre/maplibre-react-native` (`mobile/src/features/map/LiveMapSurface.tsx`, `mobile/src/features/crew/DriverTripMap.tsx`).
- `packages/map-assets/` — the ONE shared bus marker artwork (SVG), rasterised into `mobile/assets/bus-marker.png` (+@2x/@3x) by `mobile/scripts/generate-assets.mjs`.
- Server arrival engine: `web/src/server/modules/eta/stop-arrivals.service.ts`; config in `web/src/server/config/eta.config.ts`.

## Field report from a real trip (what happened)
Driver started a trip with 5 stops close together. On the map:
1. One big round circle swallowed all 5 stops. Expected: a small circle around the relevant stop's lat/long only (~few metres), and the manifest should open when the bus is inside it.
2. The bus often does NOT show on the map; when it does show it is a basic square/blocky sprite — UI/UX is bad. Expected: a proper top-down vehicle marker like Ola/Uber cabs, smoothly animated, rotating to heading.
3. When the bus reaches a stop, the stop's NAME should be announced (voice).
4. If the driver deviates from the planned route (traffic), the bus must STILL show on the map at its real GPS position, and the driver must still be informed before the next stop arrives (this partly exists — keep it working).

## Root causes already located in code (verify, don't re-hunt)
1. **Giant circle** = stops' stored geofence radius. `geofence_radius_meters` default is **100 m** (`web/src/server/database/models/stop.model.ts:96`); seeded demo stops use **120 m** (`web/src/server/database/seeders/20260905120000-four-dummy-schools.ts:846`). Driver map draws the next-stop ring with `effective_radius_meters = max(stored, 25)` (`mobile/src/features/crew/arrival-zone.ts` → `effectiveArrivalRadiusMeters`, `trip-map-geometry.ts` → `buildArrivalZonePolygon`, rendered in `LiveMapSurface.tsx` as `sbt-arrival-zone-*`). With 5 stops within ~50 m, a 100–120 m ring covers all of them.
   ALSO a second circle: the GPS **accuracy circle** (amber fill) is drawn whenever fix accuracy is > 50 m, up to **500 m** (`web/src/features/map/tracking-presentation.ts`: `ACCURACY_CIRCLE_MAX_METERS`, mirrored in mobile `crew-map-presentation.ts`, drawn in `MapViewInner.tsx → syncAccuracyCircle` and `DriverTripMap.tsx → accuracyCircleFeature`). A weak-GPS trip start (typical) paints a circle over everything.
2. **Manifest never auto-opens.** Only manual navigation exists (`mobile/app/(crew)/trip.tsx` → `router.push('/manifest')`) and a prompt when returning from external navigation (`mobile/src/features/crew/TripNavigationCard.tsx`, pushes `/manifest?stopId=...`).
3. **Boxy bus sprite.** Artwork in `packages/map-assets/src/index.ts` (`BUS_MARKER_DEFS_SVG`) is a flat 3/4 block with windows; at 26×42 dp it reads as a square. Same PNG on mobile, same SVG on web (`createBusMarkerElement` in `MapViewInner.tsx`).
4. **Bus not visible causes:** (a) Expo Go has no MapLibre native module → surface shows the "dev build needed" panel instead of any map (`mobile/src/features/map/map-surface-mode.ts`); (b) marker renders only after a delivered GPS fix (`map-overlays.ts → reconcileBusMarker`); stale fix = frozen marker, outdated = depends.
5. **Voice:** next-stop announcements exist (`mobile/src/features/crew/next-stop-announcer.ts` → `stop.next` / `stop.approaching` / `stop.near` with stop names) but there is NO "arrived at stop" event and NO manifest auto-open wired to arrival.

## Fix requirements

### A. Circle size (display + detection parity)
- The driver must see a SMALL ring that means "the zone that records this stop". The drawn radius and the server's detection radius MUST stay the same number — do not shrink only the drawing (the codebase deliberately keeps parity: "a zone you cannot see is a gate you cannot reason about").
- Add a configurable small default per-stop radius (target ~15–25 m; product asked for ~5 m, but DO NOT hardcode 5 m as a detection radius: the repo documents why — `eta.config.ts` / `stop-arrivals.service.ts` comment: a 5 m zone makes the accuracy gate unsatisfiable for a typical phone fix; phone GPS accuracy at a kerb is 5–25 m). Make it env-configurable (e.g. extend `ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS` usage or a new `STOP_DEFAULT_GEOFENCE_RADIUS_METERS`) and change the model/seeder defaults from 100/120 m down to the small value.
- Migration/backfill guidance: shrink existing stops' stored radii to the new default (or add an admin bulk-fix), because old rows keep 100–120 m.
- The amber GPS **accuracy circle**: cap it far lower (e.g. stop drawing past ~120–150 m; keep the "position approximate" wording instead) so it can never visually swallow stops.
- The 5-close-stops sanity case must end with: ring around ONLY the next stop; the other four stops render as normal numbered dots outside it.

### B. Arrival → announce stop NAME + open manifest
- When the server records an arrival (trip progress/ETA push or arrival socket event — use the existing channel the app already consumes), the driver app MUST, edge-triggered once per stop per trip:
  1. Speak "Stop <name> aa gaya / arrived" (add a new event like `stop.arrived` in `crew-voice.ts` + `next-stop-announcer.ts`, in the active locale and voice mode; carry student count like the near-line does).
  2. Auto-navigate to the manifest for THAT stop (`/manifest?stopId=<arrivedStopId>`) so boarding marks can start immediately. Do not stack it if the driver already has the manifest open for that stop (idempotent).
- Keep the existing manual mark path untouched as the escape hatch.

### C. Proper bus marker (Ola/Uber-like) + always visible when GPS exists
- Redesign `packages/map-assets` bus artwork as a clean **top-down school bus** (roof view, recognisable windshield/roof, clear nose-up = heading 0), legible at 26×42 dp, crisp at 1x/2x/3x. Keep `BUS_MARKER_BOX` geometry contract (anchor = exact centre at every heading; rotationBox math) or update it consistently everywhere (`BusMarkerGraphic` throws on mismatch).
- Regenerate native PNGs with `mobile/scripts/generate-assets.mjs`; web reads the same defs (one source of truth — do not fork art between web/mobile).
- Keep existing behaviours that are correct: heading rotation, smooth interpolation (`bus-motion.ts`), stale = desaturated/frozen, reduced-motion handling, halo/cone.
- Visibility guarantees: bus renders for ANY available fix (live or last-known, last-known shown desaturated, never disappears silently). When it cannot render, the reason is stated (Expo Go dev-build panel; "no GPS yet" state) — never a blank map.

### D. Off-route driving
- Bus position follows the real GPS fix regardless of the planned straight legs. On mobile verify the optional route-snap (`route-snap.ts`) never clamps the bus onto the planned polyline when the driver is far off it (snap only when close, else raw fix). Web already draws raw position — keep it.
- Driver pre-stop information must keep working off-route: `next-stop-announcer` tiers (next / approaching ≤400 m / near ≤300 m) are distance-based, so they still fire; add the arrival line from (B). Fix anything that suppresses them when the trail/planned geometry diverges.

## Acceptance criteria
1. Trip with 5 stops each ~40–60 m apart: driver map shows a small ring around ONLY the current next stop; ring size equals the server's detection radius exactly (parity, assertable in a spec like `arrival-zone.spec.ts` / `trip-map-geometry.spec.ts`).
2. A fix with 300 m accuracy does not paint a circle covering stops (accuracy ring capped; wording carries the uncertainty).
3. On a recorded arrival: one voice line says the stop's NAME (+ count), and the manifest for that stop opens, once per stop per trip.
4. Bus marker is a top-down vehicle that rotates with heading and animates between fixes, on: parent web map, admin web map, mobile driver map and mobile parent map (dev build). Never a blank square.
5. Driver takes a different road: bus still tracks on both web and mobile; next-stop voice info still fires; arrival still records/announces.
6. Update/extend the existing specs (they're `node --test` `.spec.ts` files next to the modules) and run the affected suites for web, mobile and `packages/map-assets` before finishing. Note any validation that enforces radius ≥ 30 m ("New/edited stops are additionally required to be ≥ 30 m by validation" in `stop-arrivals.service.ts`) — lower it consistently with the new default.

## Note
User mentioned screenshots of the app showing the bug — if attached in the session, verify the fix against them; the code-level root causes above are confirmed regardless.
