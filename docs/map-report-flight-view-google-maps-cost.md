# Map Report — "flight view" kyun dikh raha hai, Google jaisa map kaise banega, aur Google Maps ka paisa kitna hai

**Date:** 8 October 2026
**Type:** Decision report (is document me koi code change nahi hai — sirf analysis, evidence aur plan)
**Related:** OSRM ka poora how-to + "free kaise" — [`docs/osrm-report-how-and-free.md`](./osrm-report-how-and-free.md)
**Scope:** Driver + Parent + Admin, mobile aur web — saare map surfaces
**Aapke 3 sawaal:** (1) road-by-road kyun nahi, flight view kyun? (2) Google jaisa chhote area/shop/road-name wala map kaise? (3) Google Maps unlimited free hai ya paid — kitna charge karta hai?

---

## 0. TL;DR (Hinglish — sabse pehle ye padho)

1. **"Flight view" (seedhi line) koi bug nahi hai — engine hi nahi chal raha.** Code poora likha hua hai: server OSRM routing engine se road wali geometry maangta hai aur DB me hamesha ke liye cache karta hai. Lekin **OSRM engine kahin deploy hi nahi hua** (`infrastructure/docker-compose.yml` me sirf Postgres hai, `ROUTING_SERVICE_URL` kahin set nahi), isliye har request `{status:'unavailable'}` aati hai aur map **honestly** seedhi stop-to-stop line (dashed) draw karta hai — driver, parent, admin, sab me, mobile aur web dono me. Ye ek **deployment gap** hai, coding gap nahi.
2. **Google jaisa chhote area/shop/road-name nahi dikhne ka 80% karan hamara apna style file hai (14 layers),** aur usme 3 concrete defects hain:
   - **Shop/POI icons poori tarah dead hain** — style `poi-school`, `poi-hospital` maangta hai, sprite me naam `school`, `hospital` hain (prefix mismatch) → MapLibre us layer ko skip kar deta hai. Isliye **ek bhi shop/landmark icon nahi dikhta**.
   - **Road ke naam road ke upar nahi likhte** — `transportation_name` layer me `symbol-placement: 'line'` hi nahi hai, isliye naam gali ke beech ek point par girta hai (aur zyadatar screen par nahi dikhta).
   - **Area/colony/suburb ke naam ka koi rule nahi** — ek hi `place` layer country se colony tak sab ek hi size me draw karti hai, koi minzoom/size-priority nahi → bade naam (city/village) jeet jaate hain, chhote area ke naam dab jaate hain.
   - Mobile par sprite **ship hi nahi hua** (`/map-sprites/kidbus` root-relative path hai, mobile app me file hi nahi hai) → native par POI/sprites ka sawaal hi nahi.
   - **Status (8 Oct 2026, Session 7): teeno style defects + mobile sprite fix ho gaye** — style ab 39 layers ka hai (class-wise place ladder, line-placed road names, POIs on the shipped sprite), aur native sprite API origin se resolve hota hai. Details: [`docs/live-tracking-map.md`](./live-tracking-map.md) → "Session 7". Is report ke neeche wala analysis **fix se pehle ka** state describe karta hai.
3. **Google Maps "unlimited free" NAHI hai.** Sirf **ek** SKU unlimited free hai: **Maps SDK (Android/iOS) — "Maps SDK (India): Unlimited"** (native map loads, bina Map ID). Web map, routing, geocoding, places, tiles — sab metered hain: India me **70,000 free calls per SKU per month** (Essentials), 35k (Pro), 7k (Enterprise); 2D Map Tiles 700,000 free; uske baad per-1000 dollar rates. **Billing account + credit card mandatory** (sirf "Demo key" bina card hai, wo prototyping ke liye hai).
4. **Google lagane ka asli kharcha paisa nahi, kanoon + lock-in hai:** Google ke Terms (3.2.4) kehte hain (a) Google content cache/store nahi kar sakte (Routes/Directions max 30 din), (b) Google ka content **non-Google map par show nahi kar sakte** — matlab Google Directions ki line MapLibre par dikhana **ToS violation** hai. Hamara poora design ("route geometry hamesha ke liye DB me cache") Google ke saath **allowed hi nahi** hai. Google ka sasta rasta try karna ho to **Map Tiles API** (2D tiles MapLibre me, India 700k free tiles/month, $0.18/1k) — lekin usme Google logo + attribution lagta hai, caching/offline allowed nahi, aur Google routing phir bhi use nahi kar sakte.
5. **Recommendation (repo ke apne product rule ke hisaab se):** ₹0/month wala rasta hi sahi hai aur wo 90% ban chuka hai — bas **OSRM deploy karo (5-6 din ka kaam)** aur **style ke 3 defect fix karo (2-3 din)**. Uske baad driver ko "In 400 m, turn right onto Wardha Road" bhi mil jayega (wo code already likha hua hai, geometry aane ka intezaar hai).

---

## 1. Sawaal 1 — "Flight view" kyun? Poore detail me

### 1.1 Kaam kaise hona chahiye tha (design jo already implement hai)

Route ki seedhi line ko road-by-road line se replace karne ka poora design repo me **already implemented** hai:

| Hissa | File | Status |
|---|---|---|
| Server: OSRM se road geometry, cache-forever | `web/src/server/modules/routing/osrm.provider.ts`, `route-geometry.service.ts` | ✅ Likha hua |
| DB table `route_geometries` (stops-hash ke saath) | `web/src/server/database/migrations/20261003090000-create-route-geometries.ts` | ✅ Likha hua |
| API `GET /api/v1/routes/:id/geometry` | `web/src/server/api/routes.ts:62` | ✅ Live |
| Web map: road line (solid + casing) vs planned (dashed) | `web/src/features/map/route-geometry.ts`, `MapViewInner.tsx:1316-1321` | ✅ Live |
| Mobile: `buildRoadRouteLine` + offline cache | `mobile/src/features/crew/trip-map-geometry.ts`, `offline/route-geometry-cache.ts` | ✅ Live |
| Driver ke liye in-app "turn right onto…” strip | `mobile/src/features/crew/next-stop-directions.ts`, `TripNavigationCard.tsx` | ✅ Likha hua (geometry par depend karta hai) |
| Config `ROUTING_SERVICE_URL` (blank = straight lines) | `web/src/server/config/routing.config.ts` | ✅ Live |

Bina engine ke service **jhoot nahi bolti**: `provider === null` ho to turant `{ status: 'unavailable' }` return karti hai (no network call, no made-up geometry).

### 1.2 Toh phir bhi straight line kyun? — Engine kahin nahi hai

Aaj repo me ye cheezein **missing** hain (maine file-by-file check kiya):

| Missing piece | Evidence | Effect |
|---|---|---|
| OSRM container compose me nahi | `infrastructure/docker-compose.yml` me sirf `postgres` service hai | Koi engine hi nahi chal raha |
| Graph-build script nahi | `scripts/` folder me `build-osrm*` kuch nahi (sirf logo/sprite/backup scripts hain) | .osrm artefacts kabhi bane hi nahi |
| GitHub Actions batch job nahi | `.github/workflows/` me sirf `ci.yml` | Free-runner wala "compute once, POST back" raasta bhi nahi bana |
| `POST /routes/:id/geometry/recompute` nahi | `web/src/server/api/routes.ts` me sirf GET hai; `api-client` me `recompute` method bhi nahi | Batch path ka receiving endpoint hi nahi |
| Admin stop-save par eager compute nahi | `web/src/server/modules/routes/routes.service.ts` me geometry ka koi zikr nahi | Route banate hi geometry ban jaati, wo convenience bhi nahi |
| `ROUTING_SERVICE_URL` docs/env me nahi | `web/.env.example` me routing ka koi section nahi (grep: zero hits) | Deploy karte waqt koi ye variable set hi nahi karta |

### 1.3 Isliye aaj runtime par kya hota hai

```
Driver/Parent/Admin (koi bhi role, mobile ya web)
        │
        ▼
GET /api/v1/routes/:id/geometry
        │  ROUTING_SERVICE_URL unset  →  provider = null
        ▼
{ status: 'unavailable' }          ← har baar, har route, har role
        │
        ▼
Map fallback: seedhi stop-to-stop line
   web   → chooseRouteLine() → kind 'planned' (dashed, opacity 0.55)
   mobile→ buildPlannedLegsLine() (dashed amber)
        │
        ▼
Caption honestly kehta hai: "planned stop order — not the road route"
Driver ke TurnNavigationCard me maneuver strip khali rehti hai
(kyunki next-stop-directions ko legs chahiye, aur legs nahi hain)
```

**Iska matlab:** aapki "flight view" complaint ka fix **code likhne me nahi, OSRM deploy karne me hai** (Section 6 me exact steps).

### 1.4 "Driver road-by-road samajh hi nahi sakta" — iske 2 layer hain

1. **Line road par nahi hai** (upar wala reason) — isliye driver ko pata nahi kaunsa moddha lena hai.
2. **Maneuver strip khaali hai** — `TripNavigationCard` geometry aane par "In X m, turn right onto <road>" dikhata hai aur voice bhi bolti hai; geometry `unavailable` hai to wo chup rehta hai. Driver ke paas sirf "Navigate" button rehta hai jo **bahar wale Google Maps app** me le jaata hai (ye hand-off free hai aur aage bhi rahega).

---

## 2. Sawaal 2 — Google jaisa chhote area/shop/road-name kyun nahi dikhta?

### 2.1 Aaj ka style: 14 layers, aur usme 3 concrete defects

Shipped style: `packages/map-assets/src/kidbus-day.ts` → serve hota hai `web/public/map-styles/kidbus-day.json` se (night variant `kidbus-night.json`).

> **Note (8 Oct 2026):** neeche ke teeno defects **fix ho chuke hain** — Session 7 ("Cartography") me. Style ab 39 layers ka hai: `place-*` class-wise ladder (z13–16 par colony/suburb naam), `transportation_name` line-placed, `poi` shipped sprite ke real ids par (rank-gated, optional label), gali ka hierarchy teen width groups me, aur mobile par sprite API origin se resolve hota hai. Ye section us waqt ka state record karta hai jab report likhi gayi thi; current behaviour ke liye `docs/live-tracking-map.md` → "Session 7" dekho.

Layers: `background, water, waterway, landcover, landuse, building, road-casings, road-fills, rail, transportation_name, place, water_name, poi, boundary`.

**Defect 1 — POI/shop icons poori tarah dead (ye aapki "shops nahi dikhte" complaint ka exact karan):**

```jsonc
// web/public/map-styles/kidbus-day.json  (poi layer)
"icon-image": ["concat", "poi-", ["get", "class"]]   // maangta hai: poi-school, poi-hospital…
```
```js
// web/public/map-sprites/kidbus.json  (jo asli me hai)
["bank","bus","fuel","hospital","park","pharmacy","place-of-worship","police","restaurant","school"]
// koi bhi "poi-" prefixed id nahi hai  →  NONE
```
MapLibre ka rule: agar `icon-image` ka naam sprite me nahi hai to wo **symbol poora skip** ho jaata hai (text bhi nahi). Isliye **z0 se z22 tak ek bhi shop/landmark icon ya naam draw nahi hota** — Google me jo tap-tap ke naam dikhte hain, wo humare map par structurally gayab hain. (Upgrade ke baad jo POI tap-sheet ka code hai — `web/src/features/map/poi-sheet.ts` — wo bhi isi wajah se aaj kuch nahi dikhata.)

**Defect 2 — road ke naam road ke upar nahi likhte:**

```jsonc
// transportation_name layer
"layout": { "text-field": ["get","name"], "text-font": ["Noto Sans Regular"], "text-size": 12 }
// missing: "symbol-placement": "line", "text-rotation-alignment": "map",
//          "symbol-spacing", zoom-wise minzoom + size
```
`symbol-placement` default `point` hai → har gali ka naam uske beech ke **ek point** par girta hai, gali ke saath rotate nahi hota, aur zyadatar colliding hone se hide ho jaata hai. Google/OpenFreeMap ke asli styles line placement + zoom rules use karte hain — isliye wahan naam gali ke saath "behte" hain.

**Defect 3 — chhote area (colony/suburb/neighbourhood) ke naam ka koi rule nahi:**

```jsonc
// place layer — country se colony tak sab ek hi layer, ek hi size
"text-size": ["interpolate", ["linear"], ["zoom"], 5, 12, 12, 16]
// missing: class-wise minzoom (city z8 / town z10 / village z11 / suburb z12-13),
//          "symbol-sort-key" se importance priority, alag sizes/halos
```
Ek hi layer me sab compete karte hain, koi importance order nahi → **bade naam (city/village) jeet jaate hain, chhote area ke naam dab jaate hain** — bilkul wahi jo aapne dekha ("direct main city and village name show karta hai").

**Defect 4 (mobile-specific) — sprite mobile me ship hi nahi hua:**
Style me `sprite: "/map-sprites/kidbus"` root-relative path hai. Web par ye same-origin se chal jaata hai, lekin **native MapLibre ko absolute https URL chahiye** — aur `mobile/` me `map-sprites` ki ek bhi file nahi hai (assets me sirf bus-marker/icon/splash hain). Matlab native app par sprite ka koi rasta hi nahi.

### 2.2 Baaki 20% gap = data + zoom + features (ye bhi theek hone chahiye)

| Google par dikhta hai | Humare paas | Kya chahiye |
|---|---|---|
| Road ke naam, house numbers | `housenumber` layer hi nahi | layer add + line placement |
| Gali ka hierarchy (service/residential/primary ka rang+width) | `road-fills` me sirf motorway/trunk yellow, baaki sab white | class-wise width/colour table |
| Colony / sector / area ke naam | unfiltered `place` | class-wise minzoom + priority |
| Shops, hospital, school, mandir ke icons | **dead** (Defect 1) | sprite id fix + Maki icons whitelist |
| Park/market/landmark ka green/orange area | landuse/landcover basic | zyada class coverage |
| 3D buildings | sirf 3D mode me (web) | night + mobile variants |
| Satellite view | nahi | **free + unlimited me possible nahi** (alag report section) |
| Live traffic | nahi | koi free source nahi (apne fleet data se derive ho sakta hai) |

**Aur ek important, non-code sach:** OSM data India ke villages/tier-3 shehron me Google se patla hai (shops/POI especially). Google ke 200M+ businesses hain; OSM me aapke ilaake ke shops register hi nahi ho sakte. Iska matlab: **100% Google-jaisa POI density OSM data se possible nahi** — 80-90% "Google jaisa feel" (roads, names, colours, icons, 3D) bilkul possible hai, POI ki gehrai nahi.

---

## 3. Sawaal 3 — Google Maps free hai kya? Poori pricing (8 Oct 2026 tak verified)

### 3.1 Pehle ek line ka jawab

> **Nahi, Google Maps "unlimited free" nahi hai.** Sirf **mobile app ka native Maps SDK** unlimited free hai (bina Map ID). Web map, routing, geocoding, places, tiles — sab **metered** hain, per-SKU free cap ke saath. Free tier claim karne ke liye bhi **billing account + credit card** lagta hai.

### 3.2 March 2025 ke baad ka model (jo aaj chal raha hai)

- Purana "$200 monthly credit" **1 March 2025 se khatam**.
- Ab **per-SKU free monthly cap**: global me Essentials 10,000 / Pro 5,000 / Enterprise 1,000 calls per month.
- **India-billed accounts ko 7× zyada free:** **Essentials 70,000 / Pro 35,000 / Enterprise 7,000 per SKU per month** (billing address India + usage mostly India ho).
- Nov 2025 se subscription plans bhi hain (Starter $100/50k, Essentials $275/100k, Pro $1,200/250k) — lekin **India pricing walon ke liye subscriptions eligible nahi**; India me PAYG hi sasta padta hai.
- Naye accounts: **$300 trial credit** (90 din).
- Charging USD me calculate hoti hai, **INR me charge hoti hai** (Aaj ka rate ≈ **$1 = ₹96.6**).

### 3.3 Asli price list — INDIA (jo aapko lagegi)

| SKU | Category | Free / month | Uske baad (per 1,000) |
|---|---|---|---|
| **Maps SDK (Android/iOS) — bina Map ID** | Essentials | **Unlimited** | **$0** |
| Dynamic Maps (web map loads, Maps JS API) | Essentials | 70,000 | $2.10 |
| **Map Tiles API: 2D Map Tiles** (MapLibre/kisi bhi renderer me) | Essentials | **700,000** | **$0.18** |
| Map Tiles API: Street View Tiles | Essentials | 700,000 | $0.60 |
| Map Tiles API: Photorealistic 3D Tiles | Enterprise | 7,000 | $3.30 |
| **Routes: Compute Routes Essentials** (routing/directions) | Essentials | 70,000 | **$1.50** |
| Routes: Compute Routes Pro | Pro | 35,000 | $3.00 |
| Routes: Compute Routes Enterprise | Enterprise | 7,000 | $4.50 |
| Directions API (legacy) | Essentials | 70,000 | $1.50 |
| **Geocoding** (address → lat/lng) | Essentials | 70,000 | $1.50 |
| Autocomplete | Essentials | 70,000 | $0.85 |
| Place Details Essentials | Essentials | 70,000 | $1.50 |
| Text/Nearby Search Pro | Pro | 35,000 | $9.60 |
| **Navigation SDK (Navigation Request)** | Enterprise | 7,000 | **$8.00** |
| Static Maps | Essentials | 70,000 | $0.60 |

### 3.4 Global rates (India ke bahar wale billing ke liye, comparison)

| SKU | Free / month | 0–100k |
|---|---|---|
| Maps SDK (Android/iOS, no Map ID) | Unlimited | $0 |
| Embed (iframe) | Unlimited | $0 |
| Dynamic Maps (web) | 10,000 | $7.00 |
| Map Tiles API: 2D Map Tiles | 100,000 | $0.60 |
| Compute Routes Essentials | 10,000 | $5.00 |
| Geocoding | 10,000 | $5.00 |
| Navigation Request | 1,000 | $25.00 |

### 3.5 5 zaroori "chhote-print" niyam (jo paisa double kar dete hain)

1. **Map ID = mehenga trap.** Mobile Maps SDK unlimited **sirf tab** hai jab aap **Map ID (cloud styling) use na karein**. Map ID lagaya to wahi loads **Dynamic Maps** ban jaate hain (India $2.10/1k, 70k free) — 16,000 users × 3 opens × 22 din = 10.5 lakh+ loads → **hazaar dollars/month**. Rule: **mobile par kabhi Map ID mat lagana.**
2. **Billing account + card mandatory** (free tier claim karne ke liye bhi). Bina card ke sirf **Maps Demo Key** hai — sandbox/prototyping, production ke liye nahi (daily limit, limited APIs).
3. **Caching allowed nahi.** Terms 3.2.4: Google content pre-fetch/cache/store nahi kar sakte; Directions/Routes se sirf **lat/lng 30 din tak** (place_id exempt). **Hamara `route_geometries` "compute once, cache forever" design Google ke saath ToS violation hai.**
4. **Non-Google map par Google content nahi.** Terms 3.2.3(e)/3.2.4: Google ka content (routing, places) **Google map par hi** dikhana hoga. Matlab Google Directions ki road line apne MapLibre par dikhana **allowed nahi**. (Map Tiles API is rule ka sanctioned exception hai — wo third-party renderers ke liye hi bana hai, lekin logo/attribution + no-caching ke saath.)
5. **Public ToS + Privacy Policy chahiye** jo Google ke terms ko reference karein (Google Maps Platform policies ki requirement).

---

## 4. Google lagane ka kharcha — hamare scale ke numbers

**Assumption (1 school):** 20 buses, ~300 parent app users, ~25 parent web users, 5 admins, 2 trips/din, 22 working days. 1 parent 10-min watch = ~30 tiles / ~3 map opens.

| Scale | Option A: Full Google (iOS/Android SDK + Maps JS + Routes API) | Option B: Google 2D tiles MapLibre me (Map Tiles API) + apna OSRM routing | Option C: Aaj ka stack (MapLibre + OpenFreeMap + khud ka OSRM) |
|---|---|---|---|
| **1 school** | ~**$0** (mobile SDK unlimited; web loads 2.2k, routes 880 → dono free cap me) | ~**$0** (4.3 lakh tiles → 700k free ke andar) | **₹0** |
| **10 schools** | ~$0–20/mo (routes 8.8k free; web ~22k free) | **~$650/mo (₹63,000)** — 4.3M tiles: 700k free + 3.6M × $0.18 | **₹0** |
| **50 schools** | **~$84/mo (₹8,100)** — web map loads 110k: 70k free + 40k × $2.10 | **~$1,500/mo (₹1.45 lakh)** — $0.18 → $0.045 volume tiers | **₹0** |
| **200 schools** | **~$940/mo (₹91,000)** (web loads + routes) | **~$5,000+/mo (₹5 lakh+)** | **₹0** |
| **Agar mobile par Map ID lag gaya** | 50 schools par **+$2,000/mo**, 200 schools par **+$27,000/mo (₹26 lakh/month)** | — | — |

Note: rates Google ki official price lists se, aur tile/load counts stated assumptions par based hain — exact bill usage par depend karega. Billing account + card har haal me chahiye (Option A/B).

**Aur ek cost jo table me nahi dikhti:** Option A ka asli kharcha **engineering** hai — poori map layer (markers, follow-camera, 3D bus, trail, accuracy circle, offline behaviour, POI sheet, night mode) MapLibre se Google SDK par dobara likhni padegi, aur `route_geometries` cache-forever design ko "har trip par API call + 30-din cleanup" me badalna padega. Option B me sirf tile layer badalta hai (kaam kam), lekin Google logo/attribution, no-offline, aur daily tile quota 1,00,000/din (default) accept karna padega.

---

## 5. Ek zaroori baat — repo ka apna rule

Is repo me **product rule** hai jo test se enforce hota hai:
`mobile/scripts/map-provider-policy.spec.ts` + `web/scripts/map-provider-policy.spec.ts` — *"koi API key nahi, koi card nahi, koi metered tier nahi"*. Ye specs **Google Maps, Mapbox, MapTiler, Stadia, Geoapify, react-native-maps** aur **`key=` wale URLs** ko codebase me aate hi fail kar dete hain.

Matlab: Google lagane ka decision sirf technical nahi — **uske saath ye rule aur ye do test files badalni padengi**, aur `docs/live-tracking-map.md` ki "Map provider policy" update karni padegi. Ye report aapko decision ke liye facts deti hai; rule badalna aapka product call hai.

---

## 6. Recommendation aur exact next steps

### 6.1 Kya karein (₹0, repo ke plan ke hisaab se)

**Phase 1 — "Flight view" khatam karo (road-by-road line + driver maneuvers). ~3-5 din**
1. `infrastructure/docker-compose.yml` me **profile-gated `osrm` service** add karo (`osrm/osrm-backend`, `--algorithm mld`, mounted graph volume, `profiles: [routing]` — default start na ho).
2. `scripts/build-osrm-graph.sh` banao: Geofabrik se **city/district extract** (poora India nahi) → `osrm-extract → osrm-partition → osrm-customize` → `.osrm` artefacts.
3. `.github/workflows/` me manual workflow: free runner par graph build + OSRM start + `POST /routes/:id/geometry/recompute` (jo endpoint **abhi banana padega**) — is tarah production box par RAM ka bojh bhi nahi.
4. `ROUTING_SERVICE_URL` deploy env me set karo + `web/.env.example` aur README env table me document karo.
5. Bonus (optional): route ke stops save hone par **eager compute** wire karo (`routes.service.ts`) — pehla driver khulte hi road line ready milega.

**Phase 2 — Google jaisa look (style ke defects). ~2-3 din**
6. **POI fix:** sprite keys ko `poi-*` prefix ke saath regenerate karo (Maki icons CC0 hain; `scripts/generate-kidbus-sprite.mjs` abhi 3-line stub hai — ise asli generator banao) **ya** style ki `icon-image` expression ko sprite ke exact naam par map karo (`match` whitelist + `place_of_worship` → `place-of-worship`).
7. **Road names fix:** `transportation_name` me `symbol-placement:'line'`, `text-rotation-alignment:'map'`, `symbol-spacing`, zoom-wise `text-size`/`minzoom`, class filters.
8. **Area names fix:** `place` layer ko class-wise todo (city/town/village/suburb/quarter/neighbourhood) with `minzoom` + `symbol-sort-key` (rank) + alag sizes.
9. **Google-jaisi cartography:** class-wise road widths/colours, `housenumber` layer, park/landmark labels, metro-level details, night variant me same rules.
10. **Mobile sprite fix:** sprite ko app me bundle karo ya absolute https URL (hamare API origin) se serve karo — native par root-relative path kaam nahi karta.
11. `docs/live-tracking-map.md` + README docs index update; map-provider-policy specs me **positive assertions** (sab source URLs allowed host par, koi key nahi).

**Phase 3 — parent/admin web par bhi same** (kai cheezein already shared hain: same style JSON web par serve hota hai).

**Phase 4 (optional, aage) —** POI tap sheet ko kaam karna (icons fix hone ke baad khud kaam karega), 3D buildings, traffic colour apne fleet GPS data se.

### 6.2 Agar phir bhi Google chahiye (decision tree)

```
Google ka content chahiye?
├─ Sirf AGAR "Google ki tiles/dikhaav" chahiye (map ka look) 
│    → Option B: Map Tiles API (2D tiles) MapLibre me. 700k free tiles/mo (India), $0.18/1k.
│      + Google logo/attribution, no caching/offline, daily tile quota.
│      + Routing apna (OSRM) hi rahega — Google Directions non-Google map par allowed nahi.
├─ "Google ka poora feel + satellite + Google routing" chahiye
│    → Option A: mobile par Maps SDK (unlimited free, bina Map ID), web par Maps JS (70k free, $2.10/1k),
│      routing Routes API (70k free, $1.50/1k).
│      + Billing account + card, public ToS/privacy update, 30-din cache rule,
│        map layer ka poora rewrite, policy specs + product rule change.
└─ "₹0 rahe aur map professional lage" chahiye
     → Option C (recommended): OSRM deploy + apna style fix. 100% free, unlimited, koi card nahi.
```

### 6.3 Is report ke baad turant karne layak kaam (ek hi din me)

- ✅ Style ka **POI prefix fix** (ya sprite regenerate) — is ek change se shops/landmarks/icons dikhne lagenge (web + mobile dono, kyunki style same hai).
- ✅ `transportation_name` me `symbol-placement:'line'` — road ke naam road par aane lagenge.
- ✅ `place` layer me class-wise minzoom + priority — colony/area ke naam dikhne lagenge.
- ✅ Mobile me sprite ship/absolute-URL fix.
- ✅ `ROUTING_SERVICE_URL` ka doc + compose/profile + graph script — "flight view" ka asli ilaaj.

---

## 7. Sources (8 October 2026 ko verified)

**Google pricing & policy**
- Google Maps Platform core services pricing list (global) — https://developers.google.com/maps/billing-and-pricing/pricing
- Google Maps Platform core services pricing list — **India** — https://developers.google.com/maps/billing-and-pricing/pricing-india
- Pricing categories (free caps: Essentials 10k global / **70k India**, Map Tiles 100k global / 700k India) — https://developers.google.com/maps/billing-and-pricing/pricing-categories
- India pricing & billing FAQ (70k / 35k / 7k, INR billing) — https://developers.google.com/maps/billing-and-pricing/india
- Maps SDK for Android usage & billing ("All mobile usage … unlimited") — https://developers.google.com/maps/documentation/android-sdk/usage-and-billing
- Map Tiles API usage & billing (2D tiles SKU, daily quota) + release notes (15k → **100k QPD**, May 2026) — https://developers.google.com/maps/documentation/tile/usage-and-billing , https://developers.google.com/maps/documentation/tile/release-notes
- Map Tiles API policies (Google logo + third-party renderer attribution, no caching) — https://developers.google.com/maps/documentation/tile/policies
- Google Maps Platform Terms — no caching / no use with non-Google maps (3.2.4) + Directions/Routes caching rules (30 days) — https://developers.google.com/maps/terms-20180207 , https://cloud.google.com/terms/maps-platform/eea/maps-service-terms
- Directions API policies (results must be shown on a Google map) — https://developers.google.com/maps/documentation/directions/policies
- March 2025 pricing change announcement — https://mapsplatform.google.com/resources/blog/start-building-today-with-up-to-10-000-monthly-free-calls-per-product/

**Alternatives (India, free tiers)**
- Ola Maps (Krutrim) — 5M free calls/month per API / 500k combined tier, no card, India-only: https://tech.olakrutrim.com/ola-maps-made-for-india-priced-for-india/
- India alternatives comparison (Jul 2026) — https://maps.guru/blog/google-maps-alternatives-indian-startups

**Repo ke andar ka evidence**
- Straight-line fallback: `web/src/features/map/route-geometry.ts`, `web/src/features/map/MapViewInner.tsx:1316-1321`, `mobile/src/features/crew/trip-map-geometry.ts`
- Geometry endpoint: `web/src/server/api/routes.ts:62`; service: `web/src/server/modules/routing/route-geometry.service.ts`; provider: `osrm.provider.ts`
- Missing deployment: `infrastructure/docker-compose.yml`, `.github/workflows/ci.yml` (sirf), `web/.env.example` (routing vars nahi)
- Style defects: `packages/map-assets/src/kidbus-day.ts`, `web/public/map-styles/kidbus-day.json`, `web/public/map-sprites/kidbus.json`
- Policy guard: `mobile/scripts/map-provider-policy.spec.ts`, `web/scripts/map-provider-policy.spec.ts`
- Plan docs (pehle se maujood): `docs/live-tracking-map.md`, `docs/google-like-map-plan.md`, `docs/map-upgrade-session-prompts.md`
