# Map upgrade — session prompt pack

**What this is:** six copy-paste prompts, one per Arena session, that take the
map from "straight flight-path lines" to "road-by-road routing with a
Google-like feel" — **without touching anything else in the application**.

**How to use it:** open a new session, paste **one** prompt, let it finish, merge
the PR, then move to the next. Each prompt is self-contained and ends with a PR.

**Order matters.** Sessions 1 → 2 → 3 → 4 are a chain (backend first). Sessions
5 and 6 (the Google look) are independent and can be done any time, even first
if you want the visual win early.

**The two problems being fixed:**

1. **Flight paths.** Today the route line is drawn stop-to-stop as straight
   segments (`buildPlannedLegsLine` on mobile, `sbt-route` source in
   `web/src/features/map/MapViewInner.tsx`). On the screenshot the dashed amber
   line cuts diagonally across a whole colony. A driver cannot tell which road
   to take.
2. **The map does not feel like Google.** We inherit OpenFreeMap's `bright`
   cartography. See [`docs/google-like-map-plan.md`](./google-like-map-plan.md).

**The money rule that must survive all six sessions:** no API key, no credit
card, no metered tier. `web/scripts/map-provider-policy.spec.ts` and
`mobile/scripts/map-provider-policy.spec.ts` enforce it. Road routing therefore
means **self-hosted OSRM**, never a hosted directions API.

---

## Session 1 — Road routing backend (no UI changes)

```text
In this repo, implement ONLY the backend half of road-following route geometry.
Do not touch any UI, any map component, or any feature outside what I list.

PROBLEM
Routes are drawn as straight stop-to-stop lines ("flight paths"). A driver
cannot tell which road leads to the next stop. We need real road geometry.

HARD CONSTRAINT (non-negotiable, already enforced by
web/scripts/map-provider-policy.spec.ts and mobile/scripts/map-provider-policy.spec.ts):
no API key, no credit card, no metered provider. So the routing engine is
SELF-HOSTED OSRM reached over plain HTTP at a URL we configure. No hosted
directions API, no Google/Mapbox/ORS/GraphHopper, no key= in any URL.

WHAT TO BUILD
1. Config: web/src/server/config/routing.config.ts, following the exact shape
   and test style of the existing eta.config.ts.
   - ROUTING_SERVICE_URL (optional). Unset/blank => routing is DISABLED and the
     app keeps today's straight-line behaviour. Never silently invent geometry.
   - ROUTING_TIMEOUT_MS (default 5000), ROUTING_ENABLED derived from the URL.
   - Reject non-http(s) URLs and any URL containing key= or api_key= with a
     clear startup error; add a spec for that.
2. A new server module web/src/server/modules/routing/ matching the conventions
   of modules/eta/ (index.ts, *.service.ts, *.service.spec.ts, dto/):
   - A provider-agnostic interface RoutingProvider with one method:
     route(waypoints: Coordinate[]) => Promise<RoadRoute | null>, where
     RoadRoute = { geometry: GeoJSON LineString, distanceMeters, durationSeconds,
     legs: [{ distanceMeters, durationSeconds, maneuvers: [...] }] }.
   - An OsrmRoutingProvider implementation hitting
     {base}/route/v1/driving/{coords}?overview=full&geometries=geojson&steps=true
     with a timeout, one retry, and strict response validation. Never throw into
     the request path: return null and log.
   - Maneuvers normalised to our own shape:
     { type, modifier, roadName: string | null, distanceMeters, location }.
     Keep this shape OSRM-independent so a Valhalla provider can be added later.
3. Persistence + cache: a new migration in web/src/server/database/migrations/
   (follow the naming/timestamp convention of the newest file there) creating
   route_geometries: id, route_id (FK, unique per stop-set hash), stops_hash,
   geometry (JSONB), distance_meters, duration_seconds, legs (JSONB),
   provider, computed_at, plus the standard base-model timestamp columns.
   stops_hash = stable hash of the ordered (stop_id, lat, lng) tuples, so the
   cache invalidates by itself when a route's stops change. A cached row is
   reused forever until the hash changes — this keeps request volume near zero.
4. API: extend the existing routes module (web/src/server/modules/routes/) with
   GET /routes/:id/geometry returning
   { status: 'road' | 'unavailable', geometry, distance_meters, duration_seconds,
     legs, computed_at, provider } and the same tenant/role guards as the
   existing route endpoints. 'unavailable' when routing is disabled, the engine
   failed, or fewer than 2 located stops. Authorisation must be identical to
   GET /routes/:id — write a controller spec that proves cross-tenant access is
   denied.
5. Types: add the response shapes to packages/shared-types/src/index.ts and
   wire the endpoint into packages/api-client, following existing patterns.
6. Infrastructure + docs:
   - infrastructure/docker-compose.yml: an OPTIONAL, profile-gated osrm service
     (profile: routing) using the official osrm/osrm-backend image with an
     India extract, plus a short README section on building the graph.
   - docs/live-tracking-map.md: a new "Road routing" section stating what the
     geometry is, that it is cached, that it degrades to straight lines, and
     that it still costs nothing because the engine is ours.
   - README.md env table: the two new variables.

ACCEPTANCE
- npm run lint, npm run typecheck and npm test all pass.
- New unit specs cover: config validation, stops_hash stability, cache hit/miss,
  OSRM response parsing (including a malformed payload), timeout => null,
  routing-disabled => 'unavailable', and the controller's tenant isolation.
- No UI file changes. No change to ETA logic, notifications, auth or any other
  module. git diff --stat should only show routing/config/routes/types/
  api-client/infrastructure/docs files.

WHEN DONE
Commit on the current session branch, push it, and open a PR with gh describing
the change, the env variables, and how to run OSRM locally. Give me the PR link.
```

---

## Session 2 — Web map draws the real road line

```text
Depends on the merged Session 1 PR (GET /routes/:id/geometry exists).

Scope: the WEB live-tracking map only. Do not touch mobile, do not touch the
backend, do not touch any non-map feature.

PROBLEM
web/src/features/map/MapViewInner.tsx draws the route as a straight LineString
through the stop coordinates (source 'sbt-route', layer 'sbt-route-line'). On a
real Nagpur route the line cuts diagonally across entire colonies. Replace it
with the road geometry from the new endpoint, and keep the app honest when the
geometry is unavailable.

WHAT TO BUILD
1. A pure module web/src/features/map/route-geometry.ts (+ spec) that decides
   WHICH geometry the map shows, given { roadGeometry, stops }:
   - returns { kind: 'road', line } when the endpoint returned road geometry;
   - returns { kind: 'planned', line } (today's straight stop-to-stop line)
     otherwise;
   - returns null when there is nothing to draw.
   No React, no maplibre imports — testable under node --test, like the other
   pure modules in that folder.
2. Data: fetch the geometry through the api-client in the tracking page /
   MapView layer, following how the page already loads stops. Cache per route
   in component state; the geometry only changes when the route changes, so it
   must NOT refetch on every GPS fix.
3. Rendering in MapViewInner.tsx:
   - 'road' => a solid, rounded line (line-join/line-cap round) in the route
     colour, with a subtle wider casing underneath so it reads like a Google
     directions line.
   - 'planned' => keep exactly today's dashed look. The dash now MEANS
     "approximate, not the road", and nothing else may use that dash.
   - Layer ordering, the existing MIN_FIT_ZOOM fit behaviour and the bus marker
     stay as they are.
4. Honesty UI: the existing map caption/legend must say which line is on screen
   — "Road route" vs "Straight-line estimate — road route unavailable". Use the
   existing i18n/copy mechanism of the tracking page; do not invent a new one.

ACCEPTANCE
- npm --prefix web run lint, typecheck and test pass.
- New spec pins: road wins over planned, planned is the fallback, empty input
  draws nothing, and the fallback caption appears exactly when kind==='planned'.
- Visual check against the attached behaviour: the line must follow streets.
- git diff --stat shows only web/src/features/map/*, the tracking page, and docs.

WHEN DONE
Update the relevant part of docs/live-tracking-map.md, commit, push, open a PR
with gh including a before/after description. Give me the PR link.
```

---

## Session 3 — Mobile maps draw the real road line

```text
Depends on the merged Session 2 PR.

Scope: the MOBILE maps only — the parent/admin tracking surface
(mobile/src/features/map/) and the driver trip map
(mobile/src/features/crew/DriverTripMap.tsx + trip-map-geometry.ts). Do not
touch web, the backend, or any non-map feature.

PROBLEM
mobile/src/features/crew/trip-map-geometry.ts buildPlannedLegsLine draws
straight stop-to-stop segments, documented in that file as explicitly NOT a road
route. Now that road geometry exists, use it, and keep the fallback honest.

WHAT TO BUILD
1. Extend trip-map-geometry.ts (pure, React-free, MapLibre-free — keep it that
   way) with buildRoadRouteLine(roadGeometry, { fromStopId, stops }) which:
   - returns the road LineString, trimmed to the remaining portion of the route
     from the next stop onward when a next stop is known;
   - returns null when there is no road geometry, so the existing
     buildPlannedLegsLine stays as the fallback.
   Mirror the module's existing contract: null means "draw nothing", every
   coordinate passes isValidCoordinate.
2. Fetch the geometry once per trip (not per fix) through the mobile api-client,
   cache it with the existing offline/caching approach used in
   mobile/src/features/crew/offline/, so a driver who loses signal mid-trip
   keeps the road line.
3. Render: solid road line where today's solid amber "planned legs" line is;
   keep the dotted green trail untouched. The dotted/dashed planned line stays
   only as the fallback.
4. Copy: the existing caption key map.plannedNotice ("planned stop order, not
   the road route") must now be shown ONLY in the fallback case, and a new key
   used when the real road route is displayed. Update every language file the
   repo already ships.

ACCEPTANCE
- npm --prefix mobile run lint, typecheck and test pass.
- Specs pin: trimming from the next stop, null-when-no-geometry, the caption
  swap, and that an invalid coordinate never reaches the GeoJSON.
- bus-marker-invariants.spec.ts and the existing crew map specs stay green,
  unmodified.
- git diff --stat shows only mobile map/crew-map files, i18n files and docs.

WHEN DONE
Commit, push, open a PR with gh. Give me the PR link.
```

---

## Session 4 — Driver turn-by-turn: "which road do I take?"

```text
Depends on the merged Session 3 PR.

Scope: the DRIVER experience only — mobile/src/features/crew/TripNavigationCard.tsx,
a new pure maneuvers module, and the crew copy/voice files. Do not touch the
parent app, the web console, the backend, attendance, SOS, or notifications.

PROBLEM
A driver on an unfamiliar route still has to open an external map app to know
which road leads to the next stop. Session 1 already returns per-leg maneuvers
from OSRM. Surface them in the app.

WHAT TO BUILD
1. A pure module mobile/src/features/crew/next-stop-directions.ts (+ spec):
   given the road route legs and the current position, produce
   - the CURRENT maneuver: { instruction, roadName, distanceMeters } e.g.
     "In 400 m, turn right onto Wardha Road",
   - the NEXT maneuver after it (so the card can show a small preview),
   - null when there is no road geometry, so the card falls back to exactly
     today's behaviour.
   Choosing the current maneuver = nearest upcoming maneuver along the leg to
   the next stop. Pure functions only; no network, no React.
2. TripNavigationCard.tsx gains a compact directions strip above the existing
   Navigate button: the maneuver icon (use the Ionicons already imported), the
   instruction, and the distance. Large type, high contrast — a driver reads it
   at a glance. When next-stop-directions returns null, the card renders exactly
   as it does today.
3. Keep the existing external-navigation hand-off button unchanged. It stays the
   turn-by-turn-with-voice-and-traffic escape hatch; our strip is the in-app
   "which road" answer. Do not remove it, do not change its URL building.
4. Voice: extend the existing crew-voice announcements so the maneuver is spoken
   at the same points the next-stop announcement already fires — do not add a
   new timer or a new announcement cadence. Respect the existing
   mute/sound-settings preference.
5. Copy in every shipped language; follow crew-copy.ts conventions.

HONESTY RULES
- The strip must never show a maneuver derived from a stale route: if the road
  geometry failed to load, show nothing rather than a guess.
- Distances come from the routing engine's leg data, never from straight-line
  math.

ACCEPTANCE
- npm --prefix mobile run lint, typecheck and test pass.
- Specs pin: maneuver selection, the preview, null-fallback, the voice trigger
  reusing the existing cadence, and the copy keys existing in all languages.
- Existing crew specs (crew-voice, next-stop-announcer, navigation-stop) stay
  green and unmodified.

WHEN DONE
Update docs/live-tracking-map.md ("Navigation is a hand-off") to describe the
new in-app strip and why the deep link stays. Commit, push, open a PR with gh.
Give me the PR link.
```

---

## Session 5 — Google-like cartography (the look)

```text
Scope: map styling only. Independent of the routing sessions. Do not touch the
backend, business logic, or any non-map feature.

GOAL
The map must read like Google Maps: white road hierarchy, yellow highways, soft
grey buildings, blue water, green parks, dense readable labels, POI icons.
Cost must stay exactly zero: the TILES remain OpenFreeMap's free public vector
tiles (tiles.openfreemap.org, no key, no billing). Only the STYLE becomes ours.

Read docs/google-like-map-plan.md section 2 first — it already contains the
colour table and the file plan. Implement that plan.

WHAT TO BUILD
1. packages/map-assets gains the style as a versioned asset (the package already
   exists in the workspace and is built by npm run build:packages):
   - a kidbus-day style for the OpenMapTiles schema: background, water,
     waterway, landcover, landuse, building, transportation (motorway/trunk/
     primary/secondary/residential/service/rail, fill + casing), transportation_name,
     place, water_name, poi, boundary.
   - sources point at the OpenFreeMap planet tile endpoint; glyphs at the same
     host; sprite served from our own origin.
   - Export it as a typed JS object AND write the JSON to web/public/map-styles/
     at build time, so web can use a URL and mobile can import the object.
2. POI icons: build a sprite from Maki (CC0) and ship it at
   web/public/map-sprites/. Prioritise what matters to a school route: school,
   hospital, fuel, place-of-worship, police, bus-stop, park, restaurant.
3. web/src/features/map/map-style.ts and mobile/src/features/map/map-style.ts:
   DEFAULT_MAP_STYLE_URL (web) / the default style (mobile) now resolve to ours.
   The NEXT_PUBLIC_MAP_STYLE_URL / EXPO_PUBLIC_MAP_STYLE_URL override MUST keep
   working unchanged — it is the self-hosting escape hatch. Update both
   map-style.spec.ts files, including the https-only rule, which now has to
   allow our same-origin style path.
4. web/security-headers.js: confirm no CSP widening is needed (style and sprite
   are 'self', tiles unchanged) and add a comment saying so. If the sprite needs
   img-src, add it narrowly.
5. Extend BOTH map-provider-policy specs with a positive assertion: every
   "sources" URL in the shipped style points at the allowed tile host, and the
   style contains no key= / api_key=.
6. Keep the OSM/OpenFreeMap attribution visible — it is legally required.

ACCEPTANCE
- npm run lint, typecheck and test pass at the repo root.
- Both provider-policy specs pass, with the new positive assertions.
- The bus marker, stop layer, accuracy ring, follow camera and 2D/3D toggle all
  still work and are NOT modified.
- git diff --stat shows only packages/map-assets, web/public, the two
  map-style.ts + specs, security-headers.js, the two policy specs, and docs.

WHEN DONE
Update docs/live-tracking-map.md ("Map provider policy": the style is ours now,
tiles unchanged, still no key) and the README maps line. Commit, push, open a PR
with gh, and include a short note on how to preview the style locally. Give me
the PR link.
```

---

## Session 6 — Google-like behaviour (the feel)

```text
Depends on the merged Session 5 PR. Scope: map interaction only. No backend, no
business logic, no other feature.

GOAL
Close the remaining gap between our map and Google's: the things a user's hand
expects, all of them free and client-side.

WHAT TO BUILD (web first, then mirror on mobile where the native map allows)
1. POI tap sheet: tapping a POI icon opens a small sheet with the name and
   category, read from the already-rendered vector tile feature via
   queryRenderedFeatures. No network call, no new data source. Dismiss on
   outside tap. Must not interfere with stop-marker taps — stops win.
2. 3D buildings: a fill-extrusion layer driven by the tiles' building heights,
   enabled only in the existing 3D camera mode (web/src/features/map/bus-3d.ts
   already owns that mode). 2D mode must look exactly as before.
3. Night mode: a kidbus-night variant of the Session 5 style in
   packages/map-assets, selected from the app's existing theme/colour-scheme
   signal. No new user setting unless the app already has one.
4. Google-style controls: compass that appears only when the map is rotated,
   a recentre control, and a scale bar. Reuse the existing control components
   and the existing follow-camera behaviour — do not add a second camera system.
5. Reduced motion: honour the existing usePrefersReducedMotion hook for any new
   animation.

ACCEPTANCE
- Lint, typecheck and tests pass on both surfaces.
- Specs for the pure parts (POI feature selection precedence, 3D-mode gating,
  night-style selection).
- Existing map specs stay green and unmodified.
- Performance: no new per-frame React re-render. The existing marker-motion and
  follow-camera modules are untouched.

WHEN DONE
Document the new interactions in docs/live-tracking-map.md, commit, push, open a
PR with gh. Give me the PR link.
```

---

## Guard rails to repeat in every session

Each prompt above already contains these, but if you edit a prompt, keep them:

1. **Scope fence** — "only these files; do not touch the rest of the
   application", plus a `git diff --stat` acceptance check.
2. **No key, no billing** — both provider-policy specs must stay green.
3. **Honesty** — a prettier or more detailed map must never claim something it
   cannot prove. Straight line = says so. No road geometry = no maneuver.
4. **The escape hatch stays** — `NEXT_PUBLIC_MAP_STYLE_URL`,
   `EXPO_PUBLIC_MAP_STYLE_URL`, `ROUTING_SERVICE_URL`.
5. **End with a PR** — commit on the session branch, push, `gh pr create`, hand
   back the link.

## Running cost after all six sessions

| Item | Cost |
|---|---|
| Tiles (OpenFreeMap public) | ₹0 |
| Style, icons, 3D, night mode, POI sheet | ₹0 |
| Road routing — self-hosted OSRM, India extract, cached per route | one VPS, ~₹2,000–4,000/month |
| External turn-by-turn hand-off (kept) | ₹0 |

Routing is the only line with a number on it, and it is a flat server cost, not
a per-request bill — no API key anywhere, which is exactly the rule the repo
enforces in CI.
