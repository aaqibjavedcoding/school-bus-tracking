# OSRM Report — kya hai, kaise chalega, aur poora free kaise hoga

**Date:** 8 October 2026
**Type:** Operational how-to + free-plan report (koi code change nahi; jo code likhna hoga wo Section 7 me list hai)
**Pichhli report:** [`docs/map-report-flight-view-google-maps-cost.md`](./map-report-flight-view-google-maps-cost.md)
**Sawaal:** "OSRM — yeh kaise honga, aur kya yeh free me kar sakte hai?"

---

## 0. TL;DR (seedha jawab)

- **OSRM = Open Source Routing Machine** — ek C++ routing engine jo OpenStreetMap data par chalta hai. License **BSD-2-Clause** (GitHub par verified, 8,126 stars, latest release **v26.10.0**) → **software 100% free**, koi key, koi account, koi card, koi metered tier nahi.
- **Data bhi free:** OSM extracts (Geofabrik / BBBike) **ODbL** license par, free download.
- **Do alag-daal phases hain, aur sirf pehla bhaari hai:**
  1. **Graph build** (ek baar, offline): `osrm-extract → osrm-partition → osrm-customize`. Bhaari (RAM/CPU/time) — lekin **ek baar** aur **free** (laptop ya GitHub Actions).
  2. **Serve** (halka): `osrm-routed` — ek chhote city graph ke liye ~0.5–1.5 GB RAM, query ~5–10 ms. **24/7 chalne ki zaroorat hi nahi** (agla point).
- **Hamare design ka jaadu:** route ki geometry **ek baar compute hoti hai aur DB me hamesha ke liye cache** hoti hai (`route_geometries`). Ek school ke 20 routes = **zindagi bhar me 20 engine calls**. Isliye engine **keval tab chalana padta hai jab naye route ki geometry compute karni ho** — baaki 99.99% time engine band ho sakta hai, map phir bhi road-by-road line dikhata rahega (cache hit).
- **Toh "free" ka jawab:** ✅ **Haan, poora ₹0 me ho sakta hai** — koi naya server, koi subscription, koi card nahi. Aapka repo **public** hai, isliye **GitHub Actions free + unlimited** (public repos ke liye), aur graph build + backfill wahi ho sakta hai. Engine ko permanently chalana ho tab bhi: aapka laptop, apna spare PC, ya Oracle Always Free VM (aaj 2 OCPU/12 GB free) — teeno me se kuch bhi chuno.

---

## 1. OSRM exactly kya karta hai

### 1.0 "Engine kahan se aata hai?" — 3 cheezein, teeno download/ek-baar

Engine ke liye **koi code likhna nahi padta** aur **kuch khareedna nahi padta** — wo ek **ready-made Docker image** hai jo download hoti hai:

| # | Cheez | Kahan se | Type |
|---|---|---|---|
| 1 | **Software image** (engine khud) | `ghcr.io/project-osrm/osrm-backend` (GitHub ka free registry, release **v26.10.0**, 1 Oct 2026) ya `osrm/osrm-backend` (Docker Hub) | `docker pull` — bas. Koi compile nahi, koi key nahi |
| 2 | **OSM data** | Geofabrik / BBBike (`.osm.pbf`) | download (free, ODbL) |
| 3 | **Graph** (`.osrm` artefacts) | Aapke hi box par 3 commands se banta hai (`osrm-extract → osrm-partition → osrm-customize`) | ek baar ka "processing" — ye bhi **command** hai, code nahi |

**Analogy:** Jaise aap PostgreSQL ka code nahi likhte — `postgis/postgis:16-3.4` image pull karte ho (aapke apne `infrastructure/docker-compose.yml` me wahi hai), waise hi OSRM: image pull + data download + ek baar graph build. Application ki taraf ka kaam sirf **`ROUTING_SERVICE_URL` set karna + glue code** hai (Section 7).

Hamara server ise ek hi tarah se call karta hai (`web/src/server/modules/routing/osrm.provider.ts`):

```
GET {ROUTING_SERVICE_URL}/route/v1/driving/{lng,lat;lng,lat;…}?overview=full&geometries=geojson&steps=true
```

Jawab me aata hai:
- **road-following polyline** (gali-gali ka actual shape, GeoJSON LineString),
- **distance + duration** (asli road distance, seedhi line se nahi),
- **legs + maneuvers** (`steps=true`) — yahi se driver ko "In 400 m, turn right onto Wardha Road" milta hai (wo code already likha hua hai: `mobile/src/features/crew/next-stop-directions.ts` + `TripNavigationCard.tsx`, sirf geometry ka intezaar hai).

OSRM kabhi internet/tile provider par depend nahi karta — ye aapke apne box par ek local HTTP service hai (default port 5000).

### 1.1 Do phases, ek-ek karke

| Phase | Command | Kahan chalta hai | Kitna bhaari | Kitni baar |
|---|---|---|---|---|
| **1. Graph build** | `osrm-extract` → `osrm-partition` → `osrm-customize` | Laptop / GitHub Actions runner / koi bhi box | Bhaari: extract peak RAM ≈ **3–6× pbf size**, artefacts disk ≈ **25–30× pbf** (community benchmarks) | **Ek baar** per extract (mahine/term me ek baar refresh) |
| **2. Serve** | `osrm-routed --algorithm mld <graph>.osrm` | Koi bhi chhota box; ya sirf tab jab compute karna ho | Halka: chhota city graph **~0.5–1.5 GB RAM**, query **~5–10 ms** | Sirf jab naye route ki geometry banani ho |

**Build phase kitna time?** Community numbers: ~200 MB metro pbf → extract **2–5 min**; 3 GB country pbf → 45–90 min. Nagpur-size cut (20–60 MB) laptop par **kuch minute** hi leta hai. Repo ka **Western Zone (210 MB)** GitHub runner (public repo standard: 4 vCPU / 16 GB / 14 GB SSD) par aaram se build ho jaata hai.

**Algorithm MLD kyun (CH nahi)?** MLD me weights badalne par sirf `osrm-customize` re-run hota hai (**~40 sec**) — CH me poora re-contract (minutes–hours). Query latency MLD ~5–10 ms — hamare use case ke liye bahut zyada kaafi.

---

## 2. Free kaise — har hisse ka license/price

| Cheez | Kya lagta hai | Free? |
|---|---|---|
| **OSRM software** | BSD-2-Clause, `ghcr.io/project-osrm/osrm-backend` / `osrm/osrm-backend` Docker image | ✅ Free (no key/karta) |
| **OSM data** | Geofabrik extracts (India 1.6 GB, **Western Zone 210 MB**) ya BBBike custom city extract | ✅ Free (ODbL — attribution chahiye, jo app me pehle se dikhta hai: "Data from OpenStreetMap") |
| **Docker** | Docker Desktop (Windows/Mac) ya `docker.io` (Ubuntu) | ✅ Free (personal/small business ke liye) |
| **Graph build compute** | Aapka laptop / spare PC | ✅ ₹0 |
| **Graph build in CI** | **Aapka repo public hai** (`aaqibjavedcoding/school-bus-tracking`, verified) → GitHub-hosted standard runners **unlimited free minutes** (4 vCPU / 16 GB) | ✅ Free forever |
| **Temporary reachability** (agar app cloud par hai) | Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:5000`) ya ngrok free | ✅ Free, no account (quick tunnel) |
| **Permanent free engine** (optional) | Oracle Cloud **Always Free** (aaj 2 OCPU / 12 GB ARM; card signup ke liye lagta hai, charge nahi) — ya apna spare PC/laptop 24/7 | ✅ ₹0 (Oracle me capacity "out of stock" aam issue hai) |
| **Chalane ka kharcha** | Bijli / laptop jo pehle se chal raha hai | ₹0 extra |

❌ Free **nahi** hain (aur policy me bhi mana hain): Google/Mapbox/MapTiler-type keyed routing APIs, ya public FOSSGIS/OSRM demo servers ko production backend banane — unki fair-use policy **1 req/s** hai, repo ka `routing.config.ts` docblock bhi isko explicitly mana karta hai. Demo server sirf testing ke liye, wo bhi polite.

---

## 3. Sizing — kitna extract kaafi hai

Rule: **jitne ilaake me buses chalti hain, us poore area ka extract** chahiye + thoda margin. Extract ke bahar ka origin/destination? → OSRM `NoRoute` deta hai → app planned (seedhi) line par fall back karti hai (graceful, koi crash nahi).

| Extract | Approx download | Build (laptop) | Disk (artefacts) | Serve RAM (community benchmarks) | Kis liye |
|---|---|---|---|---|---|
| **Nagpur city + aas-paas ka region** (BBBike rectangle/polygon, ~20–60 MB) | ~20–60 MB | kuch minute | ~0.5–1.5 GB | **~0.5–1.5 GB** | Ek shehar / ek school group — **recommended start** |
| **Geofabrik Western Zone** (Maharashtra + Gujarat + Goa, 210 MB) | 210 MB | ~10–30 min | ~5–6 GB | ~2–4 GB | Poore Maharashtra me schools ho to |
| **Geofabrik India** (1.6 GB) | 1.6 GB | ~45–90 min+ | ~40 GB+ | 8 GB+ | Poora India (abhi zaroorat nahi) |

> **Important:** aaj ka data change hota rehta hai (naye roads). Extract **mahine me ek baar** refresh karna kaafi hai — aur `osrm-customize` (~40 sec) se weights refresh ho jaate hain. **Geometry cache par koi asar nahi**: cache key = stops ke coordinates ka hash, aur roads change hone se route ki geometry naya maangne par hi badalti hai (purane rows waise hi valid rehte hain).

---

## 4. Step-by-step — laptop par aaj hi (copy-paste)

### Step 0 — Docker
- **Windows:** Docker Desktop (WSL2 backend) install karo → `docker --version`
- **Ubuntu:** `sudo apt install docker.io docker-compose-v2 -y`

### Step 1 — Data lao (free)
**Rasta A (Recommended — Nagpur-size, sabse halka):**
1. https://extract.bbbike.org kholo → map ko Nagpur par le jao → rectangle/polygon banao (kam se kam 30–40 km radius, jaise lat 20.70–21.60, lon 78.60–79.60) → format **"Osmium .pbf"** chuno → Extract.
2. Email/notification ke baad `.pbf` download (~2–7 min me ready, fair-use policy lagti hai).

**Rasta B (Geofabrik Western Zone se khud cut karo — poora automated):**
```bash
wget https://download.geofabrik.de/asia/india/western-zone-latest.osm.pbf
docker run --rm -v "$PWD:/data" ghcr.io/osmcode/osmium-tool \
  osmium extract --bbox 78.60,20.70,79.60,21.60 --strategy complete_ways \
  /data/western-zone-latest.osm.pbf -o /data/nagpur-region.osm.pbf
```

### Step 2 — Graph build (ek baar; "bhaari" step)
```bash
docker run --rm -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend:latest \
  osrm-extract -p /opt/car.lua /data/nagpur-region.osm.pbf

docker run --rm -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend:latest \
  osrm-partition /data/nagpur-region.osrm

docker run --rm -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend:latest \
  osrm-customize /data/nagpur-region.osrm
```

### Step 3 — Engine chalao (halka step)
```bash
docker run --rm -t -i -p 5000:5000 -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend:latest \
  osrm-routed --algorithm mld --threads 2 /data/nagpur-region.osrm
```

### Step 4 — Test (ek asli route)
```bash
curl "http://localhost:5000/route/v1/driving/79.0882,21.1458;79.0500,21.1700?overview=full&geometries=geojson&steps=true"
# distance/duration + "geometry":{"type":"LineString","coordinates":[…]}, "legs":[… "steps":[…] …]
```
Ye jawab aane ka matlab: engine theek hai. 🎉

---

## 5. Repo me kaise chipkega — 3 raste

### Rasta 1 — **Aaj hi, bina koi code change** (production DB me geometry bhar do)
Aapka API Render par hai, OSRM aapke laptop par. Dono ko jodne ke liye ek **free tunnel**:
```bash
cloudflared tunnel --url http://localhost:5000
# → https://<random>.trycloudflare.com  (free, no account, ephemeral URL)
```
1. Render → Environment me `ROUTING_SERVICE_URL=https://<random>.trycloudflare.com` set karo (http/https dono allowed hain; `key=` wali URL config khud reject karta hai).
2. Admin se login karke **har route ka page kholo** — ya `GET /api/v1/routes/:id/geometry` hit karo (role: admin/driver/conductor/parent sab allowed).
3. Pehla call = engine call + DB me cache. ~20 routes = ~20–40 sec (1 req/s throttle, 2 attempts).
4. **Tunnel band karo, `ROUTING_SERVICE_URL` hatao.** Map phir bhi **road line** dikhayega — cache hit.
5. ✅ Free, zero code. (Ye "demo/one-time" ke liye perfect hai; school ke sath naye routes aaye to phir se ek baar ye process chalao.)

### Rasta 2 — **Permanent, poora free, koi extra server nahi** (recommended = Session 1)
Engine cloud me 24/7 na chalao — **batch me chalao** jab naye routes aayein:
1. **GitHub Actions workflow** (manual dispatch, public repo = free unlimited): runner par extract download → `osrm-extract/partition/customize` → OSRM start → har route ke stops API se fetch (admin token) → geometry compute → naye **admin-only endpoint `PUT /routes/:id/geometry`** par POST → workflow khatam.
2. **Backend addition:** `PUT /routes/:id/geometry` (validation: LineString, ≥2 valid coords, tenant-pinned) + optional `POST /routes/:id/geometry/recompute`.
3. **Optional eager compute:** route ke stops save hone par fire-and-forget geometry compute (admin ko kuch karna hi nahi padega).
4. **Optional permanent engine:** agar kabhi live chahiye hi (jaise real-time re-routing), to `infrastructure/docker-compose.yml` me **profile-gated `osrm` service** add karo (`profiles: [routing]`, `osrm-routed --algorithm mld`, graph volume) — default start na ho:
```yaml
  osrm:
    image: ghcr.io/project-osrm/osrm-backend:latest
    profiles: ['routing']
    restart: unless-stopped
    command: osrm-routed --algorithm mld --threads 2 /data/nagpur-region.osrm
    volumes: ['./osrm-data:/data:ro']
    ports: ['5000:5000']
    healthcheck:
      test: ['CMD', 'curl', '-sf', 'http://localhost:5000/health']
      interval: 30s
```
⚠️ **Render free instance 512 MB RAM** hai — usme OSRM nahi baithega. Isliye Rasta 2 (batch) hi production ke liye sahi hai; engine tabhi chalao jab kaam ho.

### Rasta 3 — **Always-on free VM** (agar engine 24/7 chahiye hi)
- **Oracle Cloud Always Free**: ARM Ampere A1, aaj **2 OCPU + 12 GB RAM** (2026 me 4 OCPU/24 GB se kam hua, Always Free tenancies me) — 12 GB me OSRM aaram se. Signup par card verification lagta hai (charge nahi), aur free capacity "out of stock" milna aam hai.
- Ya **apna spare PC/laptop** 24/7 — ₹0, bijli chhod ke. Cache-forever ki wajah se engine ka girna koi aapda nahi.

---

## 6. Kharche ka final hisaab

| Scenario | Engine kahan | Monthly cost |
|---|---|---|
| Aaj hi test (tunnel + laptop) | Laptop, kuch minute | **₹0** |
| Production, batch model (recommended) | GitHub Actions, mahine me ek baar | **₹0** |
| Production, always-on | Oracle Always Free (2 OCPU/12 GB) ya spare PC | **₹0** |
| Agar Google Routes API use karte (comparison) | Google | 70k free/SKU/mo, phir **$1.50/1,000**, + card + ToS caching/non-Google-map problem |
| Agar Google 2D tiles use karte maslan | Google | 700k free tiles/mo, phir **$0.18/1,000**, + Google logo/attribution |

**Total OSRM rasta: ₹0/month, koi card nahi, koi account nahi, koi key nahi.**

---

## 7. Kya already hai vs kya banana hai (effort)

**Already hai (code likha hua, test-pinned):** OSRM provider + throttle/retry/timeout, `route_geometries` table, `GET /routes/:id/geometry`, web line (solid road / dashed planned), mobile line + offline cache, driver maneuver strip, config + key-rejection.

**Banana hai (Session 1 ka kaam, ~3–5 din):**
1. `infrastructure/docker-compose.yml` → profile-gated `osrm` service (upar wala YAML).
2. `scripts/build-osrm-graph.sh` → extract download + bbox cut + 3 commands + artefact check.
3. `.github/workflows/osrm-build.yml` (manual dispatch) → graph build on the free runner, artefacts upload.
4. `.github/workflows/osrm-backfill.yml` (manual dispatch, optional) → per-route geometry compute + POST.
5. Backend: `PUT /routes/:id/geometry` (admin-only, validated) + optional `POST /routes/:id/geometry/recompute`.
6. Eager compute hook (stops save hone par) — optional.
7. Docs/env: `web/.env.example` + README env table me `ROUTING_SERVICE_URL`, `ROUTING_TIMEOUT_MS`, `ROUTING_MAX_REQUESTS_PER_SECOND`; `docs/live-tracking-map.md` me "Road routing" section; `infrastructure/README.md`.
8. Specs: config validation, stops-hash stability, cache hit/miss, concurrent single-call guard, throttle, malformed OSRM response, timeout → null, routing-disabled → `unavailable`, tenant isolation, aur naye PUT endpoint ki validation.

**Baad me (Sessions 2–4, ~3–4 din):** web/mobile par road line ka polish + driver ka in-app turn-by-turn voice — kyunki **wo code already hai**, geometry aane par khud kaam karne lagega.

---

## 8. Common doubts (quick answers)

- **"Kya OSRM free hai?"** Haan. BSD-2 license, koi key/card nahi. Data ODbL (attribution already app me).
- **"Engine band hone par map toot jayega?"** Nahi. Cache hit par engine ki zaroorat hi nahi. Naye route ke liye “unavailable” → dashed planned line (honest fallback) — aur next baar engine milte hi compute + cache.
- **"Kitni RAM chahiye?"** Nagpur-size graph serve karne me ~0.5–1.5 GB; build ke waqt 1–2 GB (extract peak zyada, ~3–6× pbf). 16 GB runner/laptop par koi dikkat nahi.
- **"Extract jitna chhota, utna achha?"** Nahi — **jitna ilaaka buses chalti hain utna chahiye + margin**. Warna bahar ke stops ke liye `NoRoute` → fallback line.
- **"Data stale ho gaya to?"** Mahine me ek baar extract refresh + `osrm-customize` (seconds/minute). Cache ko chhune ki zaroorat nahi.
- **"Public OSRM demo server use kar sakte hain?"** Technically haan, **production me nahi** — 1 req/s fair-use, repo ki policy bhi mana karti hai. Sirf ek dum temporary testing.
- **"Nhaya server kharidna padega?"** Nahi. Laptop/GitHub Actions/Oracle-free — teeno ₹0.

---

## 9. Sources (8 October 2026 ko verified)

**OSRM**
- Repo + license: https://github.com/Project-OSRM/osrm-backend — `BSD-2-Clause`, stars 8,126, latest release **v26.10.0** (GitHub API se verified)
- Quick start + Docker steps: https://github.com/Project-OSRM/osrm-backend
- Build/serve memory, times, MLD vs CH, artefact sizing (~25–30× pbf), city-eval numbers: https://www.geospatialrouting.com/python-routing-engines-isochrone-mapping/deploying-osrm-with-docker-for-local-routing/ , https://sumguy.com/self-hosted-osrm-docker/ , https://www.pistack.xyz/posts/2026-04-25-graphhopper-vs-osrm-vs-valhalla-self-hosted-routing-engines-guide-2026/
- Extract kā peak-RAM behaviour (community): https://github.com/Project-OSRM/osrm-backend/issues/3839

**Data (free)**
- Geofabrik India + zones (India 1.6 GB; **Western Zone 210 MB**; ODbL): https://download.geofabrik.de/asia/india.html
- BBBike custom extracts (city-size, PBF, free, fair-use): https://extract.bbbike.org/ , https://extract.bbbike.org/extract.html

**Free compute**
- Oracle Cloud Always Free (ARM A1, 2026 me Always Free ke liye ~2 OCPU/12 GB): https://cloudpricecheck.com/free-tier/oracle , https://braindetox.kr/en/posts/oracle_always_free_tier_reduced_2026.html
- Repo public confirmation: `gh repo view aaqibjavedcoding/school-bus-tracking --json isPrivate` → `false` (public ⇒ GitHub-hosted runner minutes free/unlimited)

**Repo ke andar**
- Provider: `web/src/server/modules/routing/osrm.provider.ts` (1 URL shape, 1 retry, 1 req/s throttle, 5 s deadline, never throws)
- Cache-forever service: `web/src/server/modules/routing/route-geometry.service.ts` + migration `20261003090000-create-route-geometries.ts`
- Endpoint: `web/src/server/api/routes.ts:62`; client: `packages/api-client/src/index.ts:2022`
- Config + key rejection: `web/src/server/config/routing.config.ts`
- Consumer side: `web/src/features/map/route-geometry.ts`, `web/src/features/map/MapViewInner.tsx`, `mobile/src/features/crew/trip-map-geometry.ts`, `mobile/src/features/crew/next-stop-directions.ts`, `mobile/src/features/crew/offline/route-geometry-cache.ts`
- Session plan (jise is report me detail kiya gaya): `docs/map-upgrade-session-prompts.md` → Session 1
