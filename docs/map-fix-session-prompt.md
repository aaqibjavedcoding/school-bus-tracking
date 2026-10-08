# Map fix — new-session prompts (2 phases, 100% free)

**Kya hai:** do copy-paste prompts, ek-ek naye Arena session ke liye. Ek bhi prompt
Google/paid provider use nahi karta — engine open-source OSRM Docker image hai,
data free OSM hai, graph free GitHub runner ya laptop par banta hai.

**Engine kahan se aayega (ek line me):** `ghcr.io/project-osrm/osrm-backend`
(BSD-2, prebuilt Docker image) — `docker pull` se download. Data Geofabrik/BBBike
se free (ODbL). Graph 3 commands (`osrm-extract → osrm-partition → osrm-customize`)
se banta hai. **Purchase kuch nahi, key/account/card kuch nahi.**

**Kaise use karein:** naya session kholo → Phase 1 prompt paste → PR merge →
**Phase 2 prompt** naye session me paste → PR merge → aakhir me "What you must
click" wale 3 steps (workflow run → env var → backfill). Phase 2 Phase 1 par
depend nahi karta (independent hai), par engine wala Phase 1 driver ko turant
faayda deta hai — isliye pehle Phase 1.

---

## PHASE 1 — Engine (road-by-road line zinda karna)

```text
In this repo, deploy the self-hosted open-source OSRM routing engine path so routes stop being drawn as straight stop-to-stop lines. Do NOT touch the map style or any non-map feature in this session — that is Phase 2. Read first (already in the repo): docs/osrm-report-how-and-free.md and docs/map-report-flight-view-google-maps-cost.md.

PROBLEM
The routing code already exists and is correct: web/src/server/modules/routing/{osrm.provider,osrm-response,route-geometry.service,stops-hash}.ts, config web/src/server/config/routing.config.ts, table route_geometries (migration 20261003090000-create-route-geometries.ts, model registered), API GET /api/v1/routes/:id/geometry (web/src/server/api/routes.ts), client packages/api-client, consumers already wired on web and mobile (web/src/features/map/route-geometry.ts, MapViewInner.tsx; mobile trip-map-geometry.ts, DriverTripMap.tsx, TripNavigationCard.tsx, offline/route-geometry-cache.ts). But NO engine is deployed: ROUTING_SERVICE_URL is unset everywhere, docker-compose.yml has only postgres, there is no graph-build script, no free-runner workflow, and no write path for geometry. So every call answers { status: 'unavailable' } and both maps honestly fall back to the dashed straight line.

HARD RULE: 100% free and keyless — no API key, account, card or metered tier (Google/Mapbox/MapTiler/Stadia/Geoapify all banned; both map-provider-policy specs must stay green). The engine is the open-source BSD-2 OSRM Docker image, run from a prebuilt graph. The application must boot and behave exactly as today when ROUTING_SERVICE_URL is unset.

WHAT TO BUILD
1. infrastructure/docker-compose.yml: add a PROFILE-GATED `osrm` service (profiles: ['routing']) so plain `docker compose up -d` keeps starting only Postgres: image ghcr.io/project-osrm/osrm-backend (pin a version tag), command osrm-routed --algorithm mld --threads 2 /data/<region>.osrm, volume ../infrastructure/osrm-data mounted :ro, ports 5000:5000, /health check, restart unless-stopped, mem_limit. Add infrastructure/osrm-data/ to .gitignore.
2. scripts/osrm-graph.sh — documented one-shot build: download EXTRACT_URL (default https://download.geofabrik.de/asia/india/western-zone-latest.osm.pbf), optional BBOX cut with the free osmium-tool image (default Nagpur region 78.60,20.70,79.60,21.60, --strategy complete_ways), then docker run osrm-extract -p /opt/car.lua → osrm-partition → osrm-customize, artefacts into infrastructure/osrm-data/, fail loudly if an artefact is missing, echo next steps. Document: the extract must cover every place the buses drive (outside it OSRM answers NoRoute and the app falls back to the dashed line).
3. .github/workflows/osrm-backfill.yml — manual dispatch on the free GitHub-hosted runner (this repo is public): inputs extract URL, bbox, API base URL, admin token (secret), optional route ids (default all routes missing geometry). Steps: download+cut extract → build graph → start osrm-routed -d → for each route fetch stops from the API, call OSRM /route/v1/driving/…?overview=full&geometries=geojson&steps=true → PUT the result to the new endpoint (below) → summary, exit. Optional second job: build graph only and upload the .osrm.* artifact (skip if >2 GB).
4. Backend write path (the only genuinely missing code):
   - PUT /api/v1/routes/:id/geometry — SCHOOL_ADMIN only, tenant-pinned with the same routes().findOne(schoolId, id) lookup (cross-tenant = generic 404). Body { status:'road', geometry LineString, distance_meters, duration_seconds, legs, provider, computed_at? }. Strict validation: ≥2 coordinates, every coordinate finite valid lat/lng, distance/duration finite ≥0. Upsert into route_geometries keyed by (route_id, stops_hash) using the SAME hashRouteStops() as the read path so the next GET is a cache hit.
   - POST /api/v1/routes/:id/geometry/recompute — SCHOOL_ADMIN: drop cached rows for the route (and compute immediately when ROUTING_SERVICE_URL is set).
   - Add both to packages/api-client and shared-types following existing patterns.
   - Eager compute: when an admin saves/reorders a route's stops, fire-and-forget geometry compute via RouteGeometryService — never blocking, never throwing.
5. Env + docs: ROUTING_SERVICE_URL / ROUTING_TIMEOUT_MS / ROUTING_MAX_REQUESTS_PER_SECOND in web/.env.example and the README env table (blank = routing disabled = today's dashed behaviour, stated explicitly). "Road routing" section in docs/live-tracking-map.md and infrastructure/README.md: engine source (free BSD-2 image), free graph build (laptop or the free GitHub runner), geometry cached forever per stops-hash so the engine need not run 24/7, monthly extract refresh, honest fallback, and that a 512 MB Render free instance cannot host OSRM.

ACCEPTANCE
- npm run lint, npm run typecheck and npm test pass at the repo root (packages + web + mobile), including both map-provider-policy specs, unchanged in behaviour.
- New specs: PUT validation (bad LineString, bad coordinate, NaN distance), cross-tenant 404, PUT-then-GET cache hit with the same stops_hash, recompute clears the cache, routing-disabled still 'unavailable'.
- git diff limited to infrastructure/, scripts/, .github/workflows/, web/src/server (routing/api/db/models if needed), packages/api-client, packages/shared-types, docs, README, web/.env.example, .gitignore. No UI restyle.

WHEN DONE
Commit on the session branch, push, open a PR with gh, and give me the link plus a 6-line runbook: (1) run the backfill workflow, (2) where engine/graph live, (3) which env var to set and where, (4) what to do when a school adds routes later, (5) what happens when the engine is off (cache + honest fallback), (6) how to verify (open a route's geometry endpoint before/after).
```

---

## PHASE 2 — Google-jaisa detail (shops, road names, area names)

```text
In this repo, make the map as detailed as Google Maps — shops/POIs, road names along roads, colony/area names — on the existing free tiles. Do NOT touch the routing engine/backend (Phase 1 handles that). Read first: docs/map-report-flight-view-google-maps-cost.md (§2) and docs/osrm-report-how-and-free.md.

CONTEXT
The shipped KidBus style (packages/map-assets/src/kidbus-day.ts + kidbus-night.ts, copied to web/public/map-styles/kidbus-{day,night}.json) has three concrete defects the report pinned:
1. the poi layer asks for icon-image ['concat','poi-',['get','class']] but the sprite web/public/map-sprites/kidbus.json has unprefixed ids (school, hospital, place-of-worship, fuel, police, park, restaurant, pharmacy, bank, bus) → MapLibre skips the whole symbol, so NO POI icon or label ever renders;
2. transportation_name has no symbol-placement:'line' → road names sit on a single point and mostly disappear;
3. place is one unfiltered layer → city/village names win, colony/suburb/neighbourhood names never appear at tracking zooms.

HARD RULE: 100% free and keyless — tiles stay OpenFreeMap over OpenStreetMap (ODbL), attribution stays visible, no Google/Mapbox/MapTiler/Stadia/Geoapify, no key=/api_key= anywhere. Extend both map-provider-policy specs (mobile/scripts + web/scripts) with positive assertions; never weaken them.

WHAT TO BUILD
1. POI sprite fix — preferred: regenerate web/public/map-sprites/kidbus*.{json,png} (and whatever the native side needs) with ids poi-school, poi-hospital, poi-place_of_worship, poi-fuel, poi-police, poi-park, poi-restaurant, poi-pharmacy, poi-bank, poi-bus (keep the Maki CC0 provenance note in scripts/generate-kidbus-sprite.mjs). Alternative: a `match` in the style mapping class → real sprite id. Then add a spec that FAILS if any icon-image value in any shipped style names a sprite id missing from the shipped sprite. Bump poi minzoom sensibly + add symbol-sort-key so labels don't carpet the screen.
2. transportation_name: symbol-placement:'line', text-rotation-alignment:'map', symbol-spacing, zoom-interpolated text-size, minzoom, halo — names ride along the road.
3. place: class-wise rules (match on class or split layers): city z8, town z10, village z11, suburb z12, quarter ~12, neighbourhood z13+; symbol-sort-key rank so big names win deliberately; separate size/halo per class. Colony/suburb names MUST appear at z13–16 — that is the complaint being fixed.
4. Road hierarchy polish: class-wise widths/colours (motorway/trunk #fdd663, primary/secondary/tertiary near-white with casing, residential/service thinner), rail dashed, bridge/tunnel tweaks; night style kept in step.
5. Mobile sprite: native MapLibre cannot load the root-relative /map-sprites/kidbus. Either bundle the sprite with the app or point `sprite` at an absolute https URL on our own origin — free/keyless, CSP correct, decision pinned by a spec. Night style + web override must keep working.
6. Single source of truth: the style exists as a typed object (packages/map-assets) and as JSON (web/public/map-styles). Add a cheap drift check (spec or build step) so the two cannot silently diverge; update both.
7. If the sprite becomes same-origin, confirm web/security-headers.js CSP already covers it (no widening beyond what is used).

HONESTY RAILS
- The dashed straight line stays the fallback with the same "planned stop order — not the road route" caption; nothing may claim a road route that is not cached (mobile contract map.roadNotice / map.plannedNotice stays).
- Existing tests stay green; where a spec pinned the old style shape, update it and say why.

ACCEPTANCE
- npm run lint, npm run typecheck and npm test pass at the repo root.
- New specs: sprite-id integrity per shipped style, transportation_name line placement, place class minima/priority, style-object ↔ style-JSON drift check, and the extended policy assertions.
- git diff limited to packages/map-assets, web/public/map-styles|map-sprites, the two map-style.ts + their specs, mobile sprite wiring, security-headers.js only if needed, docs. No UI redesign, no routing/backend changes.

WHEN DONE
Update docs/live-tracking-map.md (and README's map lines) with what changed and how to preview the style locally. Commit on the session branch, push, open a PR with gh, and give me the link plus a short before/after: which labels/icons now render at z13–16.
```

---

## Dono PR merge hone ke baad aapke 3 clicks

1. **GitHub → Actions → "osrm-backfill" → Run workflow** (free runner par graph banega + geometry DB me bhar jayegi).
2. **Render → Environment → `ROUTING_SERVICE_URL`** = jo bhi engine URL ho (workflow/laptop/VM) — ya backfill workflow ke saath chhod do.
3. **School naye routes add kare** to workflow dobara Run — bas.

Engine band hone par bhi map road line dikhata rahega (geometry DB me cache hai) —
aur naye route ke liye honestly dashed planned line + caption.
