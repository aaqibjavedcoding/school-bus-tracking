# Making the map look and work like Google Maps — while staying free and unlimited

Status: **plan / decision document**. No code changed yet.
Date: 2026-10-03.
Constraint being honoured: the product rule in
[`docs/live-tracking-map.md` → "Map provider policy"](./live-tracking-map.md) —
**no API key, no credit card, no billing, no metered tier**, enforced by
`web/scripts/map-provider-policy.spec.ts` and `mobile/scripts/map-provider-policy.spec.ts`.

---

## TL;DR (Hinglish)

- **Look & feel Google jaisa** — 100% possible, free, unlimited. Apna khud ka
  style JSON banao, tiles wahi free OpenFreeMap rahenge. Effort ~2–3 din.
- **POI icons, 3D buildings, Google-type labels** — free, same style JSON me.
- **Satellite / hybrid view** — *truly free + unlimited + commercial* ka koi
  option nahi hai. Esri keyless = non-commercial only, Google ke tiles scrape
  karna = ToS violation. Rasta: Bhuvan (India, free, registration) ya apna
  S3/VPS pe imagery. Recommendation: **Phase 3 tak skip**.
- **Search (place/address)** — free hai, par public instances fair-use hain.
  Rasta: debounce + cache ab, self-host Photon jab scale ho (~₹1.5k/mo).
- **Road-snapped route line + real ETA + turn-by-turn** — ye bhi **₹0** me ho
  jaata hai: OSRM container sirf apne shehar ka extract chalaye to ~0.5 GB RAM
  leta hai (ek paid Mumbai+Hyderabad deployment 0.25 CPU / 0.5 GB pe chalta
  hai), aur heavy graph-building step GitHub Actions ke free runner pe hota
  hai. Route geometry route ke banne par ek baar compute hoti hai aur DB me
  hamesha ke liye cache — runtime pe requests na ke barabar.
- **Live traffic** — koi free source nahi. Lekin hamare paas apna fleet GPS
  history hai → apna "school-route traffic" khud derive kar sakte hain, free.

Bottom line: **"Google jaisa dikhna" aaj free me ho jaata hai. "Google jaise
sab features" free me nahi hote — unka free version = apna chhota server.**

---

## 1. What "Google jaisa" actually breaks down into

| # | Google Maps feature | Free + unlimited possible? | How |
|---|---|---|---|
| 1 | Cartography (white roads, yellow highways, blue water, green parks) | ✅ Yes | Custom style JSON on OpenFreeMap tiles |
| 2 | POI icons (school, hospital, petrol pump, restaurant) | ✅ Yes | Maki/Temaki icon sprite, self-hosted from `web/public` |
| 3 | Dense labels at every zoom | ✅ Yes | Style layer tuning (same tiles) |
| 4 | 3D buildings, pitch/rotate, smooth zoom | ✅ Yes | Already MapLibre; `building` layer is in the tiles |
| 5 | Satellite / hybrid view | ❌ Not free+unlimited+commercial | See §4 |
| 6 | Place / address search | ⚠️ Free, fair-use limited | Photon or Nominatim; self-host to make it unlimited |
| 7 | Road-snapped route polyline (not straight lines) | ✅ Yes | OSRM container, city extract, on the box we already pay for |
| 8 | Real road-distance ETA | ✅ Yes | Same engine, same cached geometry |
| 9 | In-app turn-by-turn for driver | ✅ Yes | Maneuvers come with the cached route |
| 10 | Live traffic colours | ❌ No free source | Derive from our own fleet history |
| 11 | Street View | ❌ Not from Google | Mapillary (free key, sparse India coverage) |

Items 1–4 are what a user actually *means* by "map Google jaisa lagta hai".
They are all free, all unlimited, and all land in one file.

---

## 2. Phase 1 — Google-grade cartography (free, unlimited, ~2–3 days)

### The key idea

A MapLibre **style JSON** and the **tiles** are two different things.
Today we point the app at *OpenFreeMap's* style (`.../styles/bright`) — so we
inherit their cartography. But the style is just a JSON file describing colours
and layers; it can live in **our own repo** and still read **their free tiles**.

```
Today:   app ──► tiles.openfreemap.org/styles/bright  (their colours, their tiles)
Phase 1: app ──► /map-styles/kidbus.json  (OUR colours)
                        └── sources ──► tiles.openfreemap.org/planet  (their free tiles)
                        └── glyphs  ──► tiles.openfreemap.org/fonts/...
                        └── sprite  ──► /map-sprites/kidbus  (OUR icons)
```

**Cost impact: zero.** Same tile host, same no-key, no-billing contract. The
provider-policy spec keeps passing because no banned provider and no `key=`
appears anywhere.

### The Google palette to target

| Element | Google Maps colour | OpenMapTiles layer to style |
|---|---|---|
| Land / background | `#f8f9fa` | `background` |
| Water | `#aadaff` | `water`, `waterway` |
| Park / green | `#c8e6c9` → `#b7e1a1` | `landcover` (`park`, `grass`, `wood`) |
| Motorway fill | `#fdd663` (yellow) | `transportation` (`motorway`, `trunk`) |
| Primary road | `#ffffff` with `#dadce0` casing | `transportation` (`primary`, `secondary`) |
| Residential road | `#ffffff`, thinner | `transportation` (`residential`, `service`) |
| Building | `#e8eaed` fill, `#dadce0` outline | `building` |
| Rail | `#d6d6d6` dashed | `transportation` (`rail`) |
| Road label | `#5f6368`, halo `#ffffff` | `transportation_name` |
| Place label | `#3c4043` bold | `place` |
| Water label | `#4a90d9` italic | `water_name` |

### Work items

| File | Change |
|---|---|
| `web/public/map-styles/kidbus-day.json` | **New.** Full style, ~120 layers, OpenMapTiles schema |
| `web/public/map-sprites/kidbus.{png,json,@2x.png,@2x.json}` | **New.** POI sprite built from Maki (CC0) + Temaki |
| `web/src/features/map/map-style.ts` | `DEFAULT_MAP_STYLE_URL` → `/map-styles/kidbus-day.json` (relative, served by Next) |
| `web/src/features/map/map-style.spec.ts` | Update the pinned default + allow relative URL (today it demands `https://`) |
| `mobile/src/features/map/map-style.ts` | Same default, but **absolute** URL (RN can't use relative) → served from the web origin or bundled as an asset |
| `web/security-headers.js` | `MAP_TILE_HOST` stays; style + sprite are `'self'`, so **no CSP widening needed** |
| `web/scripts/map-provider-policy.spec.ts` | Add a positive assertion: the shipped style's `sources` only point at the allowed host |
| `docs/live-tracking-map.md` | "Map provider policy" section updated: style is now ours, tiles unchanged |
| `README.md` | Maps line updated |

### Two sub-decisions to make

1. **Relative vs absolute style URL.** Web can serve `/map-styles/kidbus-day.json`
   from `web/public` (zero config, same-origin, CSP-free). Mobile needs an
   absolute URL or a bundled asset. Cleanest: ship the JSON in
   `packages/map-assets` (which already exists in the workspace) and have both
   surfaces import it — then MapLibre takes a style **object**, not a URL, and
   the whole thing works offline-first. `resolveMapStyleUrl(env)` stays as the
   override escape hatch.
2. **Keep the env override.** `NEXT_PUBLIC_MAP_STYLE_URL` /
   `EXPO_PUBLIC_MAP_STYLE_URL` must keep working so a self-hosted deployment can
   still swap everything with one variable.

### What this buys

A map that reads like Google at a glance: white road hierarchy, yellow
highways, soft grey buildings, school/hospital icons, dense Indian place names.
Parents will not be able to tell the difference on the tracking screen.

---

## 3. Phase 2 — Google-like *behaviour* (free, 1–2 days)

These are app-side, no provider involved, all free:

- **POI tap sheet** — tap a school/hospital icon → bottom sheet with name,
  like Google. The data is already in the vector tile (`poi` layer); MapLibre's
  `queryRenderedFeatures` gives it to us for free.
- **3D buildings on pitch** — `fill-extrusion` layer, data already in tiles.
  Our web map already supports a pitched camera (`bus-3d.ts`).
- **Google-style controls** — compass, recentre FAB, ± zoom pill, scale bar.
- **Smooth "blue dot" style bus marker with heading cone** — we have the marker;
  the accuracy ring (`accuracy-circle.ts`) already mirrors Google's.
- **Day / night auto theme** — a second style JSON (`kidbus-night.json`),
  same tiles. Google does this; it costs us one more file.

---

## 4. Satellite / hybrid — the honest answer

**There is no free, unlimited, commercially-usable global satellite tile
service.** Imagery costs real money to license, so nobody gives it away the way
OpenFreeMap gives away OSM vector tiles.

| Option | Key? | Cost | Commercial use | Verdict |
|---|---|---|---|---|
| Esri World Imagery, keyless `services.arcgisonline.com` | No | Free | ❌ Esri's terms close the legacy endpoint to commercial use | **Reject** — we're a paid SaaS |
| Esri via ArcGIS Location Platform | Yes | Free tier 2M tiles/mo, then paid | ✅ | Violates our no-key rule |
| EOX Sentinel-2 cloudless | No | Free | ❌ CC BY-NC-SA — non-commercial | Reject |
| Google satellite tiles (`mt0.google.com`) | No | Free | ❌ Direct ToS violation | **Never** |
| Mapbox / MapTiler satellite | Yes | Metered | ✅ | Banned by policy |
| **Bhuvan / ISRO (NRSC)** | Registration | Free | ⚠️ Needs reading their terms | Worth evaluating: 1 m imagery for 200+ Indian cities, 2.5 m elsewhere, WMS/WMTS |
| **Self-hosted imagery** | No | Your VPS + storage | ✅ | The only clean unlimited path |

**Recommendation:** do **not** ship a satellite toggle in Phase 1 or 2. If a
school demands it, the Bhuvan route is the India-specific answer and needs a
terms review first (and India's National Geospatial Policy has masking rules
for sensitive areas, which matters for a government-facing product).

Also worth saying out loud: for a *bus tracking* screen, satellite is actively
worse. Parents need road names and the bus position, not rooftops.

---

## 5. Search, routing, ETA, traffic — the "features" half

### 5.1 Place / address search (admin adds a stop)

- **Photon** (`photon.komoot.io`) — no key, search-as-you-type, OSM data.
  Public instance is explicit fair-use: "please be fair, extensive usage will be
  throttled, availability not guaranteed."
- **Nominatim** public — 1 request/second, no bulk, strict policy.

**Plan:** our volume is tiny (an admin creating stops, not parents searching).
Use Photon with 300 ms debounce + a server-side cache of resolved queries in our
own DB. When it grows: self-host Photon with an India extract (~8 GB RAM VPS,
roughly ₹1,500/month) → then it genuinely is unlimited.

### 5.2 Road-snapped route line, real ETA, turn-by-turn — at zero cost

Today the amber line on the driver card is honestly labelled "planned stop
order, not the road route", and navigation is a **deep link** to the phone's map
app (`src/lib/navigation.ts`).

The road geometry can be added without paying anyone, because of one property
of this product: **a bus route's shape almost never changes.** It changes when
an admin adds, removes or moves a stop. So routing is not a per-request runtime
service at all — it is an occasional job whose answer we store.

**The zero-cost architecture**

1. **Compute once, store forever.** A `route_geometries` row keyed by a hash of
   the route's ordered stop coordinates. Hash unchanged ⇒ no engine call, ever.
   A school with 20 routes makes 20 calls in its lifetime.
2. **The engine is a container next to the app.** `osrm-backend` with a **city
   or district extract**, not all of India. A metro extract needs roughly
   0.5–2 GB of RAM at serve time — one production deployment serves Mumbai and
   Hyderabad routing on **0.25 CPU and 0.5 GB RAM**. That fits on the server the
   app is already running on. **₹0 extra.**
3. **The heavy step runs where compute is already free.** Building the graph
   (`osrm-extract` → `osrm-partition` → `osrm-customize`) is the memory-hungry
   part. It runs **once per extract** on a GitHub Actions runner (4 cores,
   16 GB, free minutes) or on a laptop, and the built artefacts are uploaded.
   Production never builds a graph.
4. **If the app box truly has no spare RAM**, the engine does not have to run
   continuously at all: a manually-triggered GitHub Actions job can start OSRM,
   compute geometry for every route that is missing it, POST the results to an
   admin endpoint, and shut down. Free, and correct, because the data is static.

**What we do NOT do:** hosted directions APIs (all metered), and no leaning on
the FOSSGIS public demo servers in production — their policy is 1 request per
second, fair use, explicitly not for production third-party services.

### 5.3 Live traffic

No free traffic feed exists (Google, TomTom, HERE all meter it).

But we are a fleet app: we already store every GPS fix
(`GET /trips/:id/location/history`). Average speed per road segment per
time-of-day, from our **own buses**, over a few weeks, gives a
school-route-specific congestion model that is more useful than generic traffic
— and costs nothing. This is a genuine Phase 4 differentiator, not a
consolation prize.

### 5.4 Street View

Google's is not licensable this way. **Mapillary** is the open equivalent (free
API, needs a token — so it would need a policy carve-out), and Indian coverage
outside metros is thin. Not worth it for a bus app.

---

## 6. Cost summary

| Phase | What | Monthly cost | Keeps the no-key rule? |
|---|---|---|---|
| 1 | Google-like cartography + icons | **₹0** | ✅ Yes |
| 2 | Google-like interactions, 3D, night mode | **₹0** | ✅ Yes |
| 3 | Road routing — OSRM container, city extract, on the existing app server; graph built in GitHub Actions; geometry cached per route in our DB | **₹0** | ✅ Yes |
| 4 | Own traffic model from fleet history | **₹0** (our DB) | ✅ Yes |
| — | Place search — Photon public, debounced + cached | **₹0** | ✅ Yes |
| — | Satellite | Not recommended | — |

**Total additional monthly cost of every phase: ₹0.** The only optional paid
line in the whole plan would be moving the OSRM container onto its own box, and
that is a scaling choice, never a requirement — the geometry is cached, so the
engine is idle almost all the time.

---

## 7. Recommended sequence

1. **Phase 1 now** — the style JSON. Biggest visual payoff, zero cost, zero
   risk, one file plus spec/doc updates. This is what "Google jaisa" means to
   99% of users.
2. **Phase 2 next** — POI sheet, 3D, night mode, Google-style controls.
3. **Phase 3 when it hurts** — self-host, driven by either an OpenFreeMap
   outage or a customer asking for road-accurate ETA. The code is already
   written for this: one env variable, no app changes.
4. **Phase 4 later** — our own traffic model.
5. **Satellite** — only on a named customer request, via Bhuvan, after a terms
   review.

## 8. What stays non-negotiable

- No API key, no card, no metered tier — the policy specs stay green.
- OSM attribution stays visible (legally required on OSM-derived tiles).
- `NEXT_PUBLIC_MAP_STYLE_URL` / `EXPO_PUBLIC_MAP_STYLE_URL` stay as the
  one-variable escape hatch.
- The map never claims a position or an ETA it cannot defend — a prettier map
  must not become a more confident one.
