# Field report — 29 Sep 2026 · Analysis (no code changed yet)

Yeh document sirf **analysis** hai. Koi code change nahi kiya gaya. Har issue ka
**root cause + exact file:line + fix ka size + trade-off** neeche hai. Fix ke
copy-paste prompts alag file me hain:
[`field-report-2026-09-29-fix-prompts.md`](./field-report-2026-09-29-fix-prompts.md).

---

## 0. Ek nazar me (executive summary)

| #  | Aapne jo bataya                                             | Asli wajah (verified in code)                                                             | Kahan                                                                 | Sev | Effort |
| -- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --- | ------ |
| 1  | Lat/long circle "ab bahut bada dikh raha hai"                | Display radius = detection radius = `max(stop.geofence_radius, 50 m)`; seed data 100–150 m | `arrival-zone.ts:42`, `eta.config.ts:150`, `validation:747`               | P1  | S      |
| 2  | Map me bus show hi nahi ho rahi                              | Web: bus-marker effect map-ready pe depend nahi karta → marker kabhi create hi nahi hota   | `MapViewInner.tsx:680–735`                                                | P0  | S      |
| 3  | "Map failed to load… network/tiles" jabki net ON tha         | Har MapLibre warn/error log ko `styleLoad` failure maan liya jata hai, aur clear nahi hota | `use-map-style.ts:93–105, 331–335`; web `MapViewInner.tsx:401`            | P0  | M      |
| 4  | Admin/Parent map driver jaisa nahi (zoom/follow/fullscreen)  | Ye saare controls sirf `DriverTripMap` me hain; `BusMap`/web `MapView` me hain hi nahi     | `BusMap.tsx` vs `DriverTripMap.tsx`; `tracking/page.tsx`                  | P1  | M      |
| 5  | Bus 2D aur basic hai, 3D + unique chahiye                    | Web = 5 rectangles ka SVG; mobile = flat top-down PNG; map me pitch/3D hai hi nahi         | `bus-marker-icon.ts:50`, `BusMarkerGraphic.tsx`                           | P1  | M/L    |
| 6  | Trip create karte hi admin ko Boarding/Start dikha           | Admin trip page sabko crew ke lifecycle buttons dikhata hai, role gate nahi hai            | `trips/[id]/page.tsx:73`, `validation:1245`                               | P1  | S      |
| 7  | Optimization, reuse, fast chahiye                            | web+mobile me ~2,500 lines duplicate map logic; N stops = N native annotations             | `web/src/features/map/*` ⇄ `mobile/src/features/map/*`                    | P2  | L      |
| 8  | "Driver aur conductor role ke issue fix nahi hue"            | Conductor ko map/GPS dikhta hi nahi (`isDriver` gate) → ab read-only map milega            | `app/(crew)/trip.tsx:133,502,513,536`                                    | P1  | S      |

**Sabse pehle kya fix hona chahiye:** #2 (bus dikhe) → #3 (jhoota error band) →
#6 (admin ko driver menu na dikhe) → #1 (circle) → #4 (admin/parent map) → #5
(3D bus) → #7 (refactor).

---

## 1. Arrival zone circle — "5 meter maanga tha, ab bahut bada dikh raha hai"

### Abhi code me kya hai

Teen alag jagah radius decide hoti hai, aur teeno ka default bada hai:

| Jagah                                                             | Value                                    | Kya karti hai                                    |
| ----------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------ |
| `web/src/server/config/eta.config.ts:150`                         | `ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS = 50` | Server ka **floor** — har stop ka radius kam se kam 50 m |
| `packages/validation/src/index.ts:747`                            | `.min(30)`                               | Admin 30 m se chhota radius **save hi nahi kar sakta** |
| `seeders/20260827120800-demo-core-domain-data.ts:295,309,323,337` | `100`, `120`, `150`                      | Demo/seed stops ka actual radius                 |

Driver map jo circle draw karta hai wo hai
`effectiveArrivalRadiusMeters(stop) = max(stored, 50)`
(`mobile/src/features/crew/arrival-zone.ts:42,70` → `trip-map-geometry.ts:126`).

Yaani aapke seeded stop pe screen pe **100–150 m ka circle** ban raha hai.
Code bilkul theek chal raha hai — **data** aur **floor** bade hain. Isliye
"zyada bada dikh raha hai".

### 5 m kyun nahi ho sakta (important — yeh decision aapka hai)

Yeh sirf ek number nahi hai, physics hai:

- Phone GPS ki typical horizontal accuracy **5–30 m** hoti hai (urban / building
  ke paas 30–50 m).
- Server ka per-stop gate: fix tabhi count hota hai jab
  `accuracy ≤ min(ARRIVAL_MAX_ACCURACY_METERS, effectiveRadius)`
  (`eta.config.ts:34–56`).
- Agar `effectiveRadius = 5` kar diya, to **koi bhi fix qualify nahi karega**
  (accuracy 12 m > 5 m) → seedha wahi purana bug wapas: "bus khadi hai, manifest
  nahi khul raha".
- Plus `ARRIVAL_REQUIRED_CONSECUTIVE_FIXES = 2` aur `ARRIVAL_MIN_DWELL_MS = 10 s`
  — 5 m circle me do consecutive fix milna practically impossible hai.

### Isliye sahi fix (recommended)

**Display aur detection ko alag kar do.** Aaj dono ek hi number use karte hain;
wahi confusion hai.

1. **Detection** floor `50 → 25 m` (default), aur poori tarah env/DB se tunable.
   25 m = sabse chhota circle jo real phone accuracy ke saath kaam karta hai.
2. **Stop create/edit** ka min `30 → 15 m` (admin ko control milega), aur admin
   UI me ek **live preview circle** map pe dikhe — taaki save karne se pehle
   dikhe ki circle kitna bada hai.
3. **Display** badlo: mota bhara hua circle hatao, ek **patli dashed ring +
   stop pe 5 m ka precision dot + live distance readout** ("Stop se 12 m") —
   driver ko precision dikhegi bina 100 m ka daag dekhe.
4. **Manual override** already mojood hai (`add-crew-stop-marking-to-trip-stop-arrivals`
   migration) — usko next-stop card pe promote karo: "Yahin pe hoon, arrive
   mark karo". GPS kabhi bhi 100% nahi hoga, escape hatch chahiye.
5. **Ek hi source of truth**: abhi mobile ka `50` server ke `50` ki *copy* hai
   (`arrival-zone.ts:42` — comment me khud likha hai "mirror"). Server ko
   `effective_radius_meters` API response me bhejna chahiye, taaki dono kabhi
   alag na ho sakein.

> **✅ Decided (30 Sep 2026): dono.** Detection floor 50 m → **25 m**, aur display
> alag — patli dashed ring + stop pe precision dot + live distance readout. Saath
> me manual "main yahin hoon, arrived mark karo" button promote hoga. 5 m
> detection radius explicitly reject kiya gaya (phone GPS ke saath kaam nahi
> karega).

---

## 2. Map me bus dikh hi nahi rahi — P0

Yahan **do alag bug** hain, ek web ka ek mobile ka.

### 2a. Web — bus marker kabhi create hi nahi hota (asli bug)

`web/src/features/map/MapViewInner.tsx`:

```ts
// line 680 — bus marker effect
useEffect(() => {
  const map = mapRef.current;
  if (!map) return;                 // ← map abhi bana hi nahi → chup-chaap return
  ...
}, [fix, presentation.animate, applyFrame, startLoop]);   // line 735 — map ka koi zikr nahi
```

Aur map alag effect me banta hai, jiske deps `[webglSupported, hasAnything]`
hain (line ~544). Sequence yeh hota hai:

1. First render → `webglSupported === null` → **map nahi banta**.
2. REST snapshot (`getTripLocation`) resolve hota hai → `fix` set hota hai →
   marker effect chalta hai → `mapRef.current` abhi bhi `null` → **return**.
3. WebGL check complete → re-render → ab map banta hai.
4. Marker effect dobara **nahi** chalta, kyunki `fix` badla hi nahi.
5. Agar trip live nahi hai (ya socket quiet hai) to naya fix aata hi nahi →
   **bus permanently gayab**, jabki stops aur route line dikh rahi hain.

Stops isliye dikh jaate hain kyunki `mappedStops` baad me aata hai (alag
`useLoad`), to unka effect map banne ke *baad* re-run ho jata hai. Bus ko wo
luck nahi milta.

**Fix (chhota):** ek `const [mapReady, setMapReady] = useState(false)` rakho,
`map.on('load')` pe `true`, aur `mapReady` ko bus-marker / stops / route /
accuracy — chaaron effects ke deps me daalo. Ya behtar: ek `syncOverlays()`
imperative function banao jise map-load aur data-change dono call karein.

### 2b. Mobile — do surface hain jo map hai hi nahi

- **Expo Go me map bilkul nahi chalta.** `mapSurfaceMode()` (`map-surface-mode.ts:33`)
  Expo Go me `'needs-dev-build'` return karta hai — MapLibre custom native
  module hai, Expo SDK ka part nahi. Agar aap Expo Go pe test kar rahe hain to
  bus kya, **poora map** nahi aayega, sirf ek panel aayega. Dev build / EAS build
  chahiye.
- **`npm run web` pe bhi map nahi hai.** `BusMap.web.tsx` aur
  `DriverTripMap.web.tsx` map nahi, ek **list fallback** render karte hain
  ("Live map (open on the mobile app for the full map)"). Yeh intentional tha,
  par aaj ke requirement ("web aur mobile dono me fix") ke hisaab se yeh
  **gap** hai — mobile web build pe MapLibre GL JS chal sakta hai.

**Fix:** (a) web fallback ko real `maplibre-gl` map se replace karo (mobile web
bundle), (b) `needs-dev-build` panel me ek clear line: "Expo Go me map nahi
chalta — dev build chahiye", (c) 2a wala map-ready fix.

---

## 3. "Map failed to load — check your network connection and map tiles" jabki net ON tha — P0

Yeh string exactly yahan hai: `mobile/src/lib/i18n.en.ts:640`
(`map.issue.styleLoad`). Do independent false-positive generators hain.

### 3a. Mobile — har MapLibre log line ko failure maan liya jata hai

`mobile/src/features/map/use-map-style.ts:93`:

```ts
export function classifyMapLog(level, tag, message) {
  if (level !== 'error' && level !== 'warn') return null;
  const text = `${tag ?? ''} ${message ?? ''}`.toLowerCase();
  if (text.includes('glyph') || text.includes('font')) return 'glyphs';
  if (text.includes('style') || text.includes('maplibre') || text.includes('mbgl')) {
    return 'styleLoad';                                   // ← yahan
  }
  return null;
}
```

Aur line 331:

```ts
LogManager.onLog((event) => {
  const code = classifyMapLog(event.level, event.tag ?? null, event.message ?? null);
  if (code !== null) reportMapIssue(code);   // ← bina kisi retry/severity check ke
  return false;
});
```

Problem: MapLibre-native **routine** warn logs deta hai jinme ye words hote
hain — unsupported style property, sprite miss, ek tile ka 404, fast pan pe
cancelled request, `mbgl` ka koi bhi diagnostic. In sab ka matlab `substring
'style' | 'maplibre' | 'mbgl'` ke hisaab se "Map failed to load" ban jata hai.

Aur clear hone ka **ek hi** raasta hai: `notifyStyleLoaded()` — jo
`onDidFinishLoadingMap` pe firing hota hai, matlab **pehle**. Uske baad aayi
har warning permanently red line chhod deti hai. Isliye net ON hone par bhi
error dikhta rahta hai.

Doosri baat: `onStyleLoadFailed()` (line ~247) `reportMapIssue('styleLoad')`
**retry se pehle** call karta hai — jabki `map-style-recovery.ts` ka poora
design "bounded retry, phir batao" hai. Ek transient blip jo 2 s me theek ho
jata hai, wo bhi line dikha deta hai.

### 3b. Web — har tile error "Map failed to load" bolta hai, aur kabhi reset nahi hota

`web/src/features/map/MapViewInner.tsx:394–402`:

```ts
const onMapErrorEvent = (event: unknown) => {
  console.error('[MapView]', message);
  onMapErrorRef.current?.('Map failed to load');   // ← har error event pe
};
map.on('error', onMapErrorEvent as never);
```

MapLibre GL JS `error` event **per-tile** bhi fire karta hai (404 tile, abort
on pan, source-level hiccup). Aur `TripTracker.tsx:195` me `mapError` state
sirf tab clear hota hai jab user "Retry map" dabaye — koi auto-recovery nahi.
Ek tile ka blip = permanent red badge.

### Sahi fix

1. `classifyMapLog` ko **strict allow-list** do (`failed to load style`,
   `unable to fetch style`, `style is not done loading`, HTTP 4xx/5xx on the
   style URL). Bare `'style' | 'maplibre' | 'mbgl'` ko kabhi match na karo.
2. `styleLoad` **sirf tab** report ho jab bounded retry budget khatam ho jaye
   (ya offline fallback style show ho raha ho) — `planStyleLoadFailure()` ka
   `'fallback'` branch. Pehle attempts pe chup raho.
3. Auto-clear: successful style/tile render pe, aur `useNetworkStatus()`
   (already mojood: `mobile/src/hooks/useNetworkStatus.ts`) ke "back online"
   event pe.
4. Copy badlo: red error ki jagah **neutral chip + Retry button**:
   "Offline map · Retry". Jab tak fallback base style chal raha hai, map *kaam*
   kar raha hai — usko failure mat bolo.
5. Web: `error` handler me `e.sourceId` / `e.error.status` dekh ke sirf
   **style-level** errors surface karo, 3 consecutive ke baad, aur `map.on('idle')`
   pe clear kar do.

---

## 4. Admin aur Parent ka map driver jaisa nahi hai — P1

Verified: driver ke paas jo kuch hai, admin/parent ke paas **kuch bhi nahi**.

### Mobile

`(admin)/tracking.tsx:124` aur `(parent)/tracking.tsx` dono `BusMap` use karte
hain. `BusMap.tsx` me kya **missing** hai (vs `DriverTripMap.tsx`):

| Feature                                    | DriverTripMap                            | BusMap (admin/parent) |
| ------------------------------------------ | ---------------------------------------- | --------------------- |
| Fullscreen                                 | ✅ `Modal` + `map.expand` (line 878)      | ❌ nahi                |
| Zoom `+ / −` buttons                       | ✅ `zoomGroup` (line 771)                 | ❌ nahi                |
| Follow primary + follow switch + "no fix"  | ✅ `driverFollowControls()` (line 720)    | ❌ sirf ek chhoti pill |
| `GestureIsland` (ScrollView se pinch bachana) | ✅ line 841                            | ❌ nahi → **Android pe pinch kaam hi nahi karegi** |
| `dragPan/touchZoom/doubleTapZoom` explicit | ✅ line 311–313                           | ❌ nahi                |
| Next-stop highlight / arrival zone         | ✅                                        | ❌ nahi                |

Matlab admin/parent pe **wahi P1-5 bug zinda hai** jo driver ke liye PR #186 me
fix hua tha — screen ka ScrollView pinch churā leta hai.

### Web

- `TripTracker` ke paas `mapControls` prop hai, par use **sirf** `/crew` page
  bhejta hai (`crew/page.tsx`). `/tracking` (admin, line 93) aur
  `/parent/tracking` (line 122) kuch nahi bhejte → "Fit route" button hai hi
  nahi, aur "Follow bus" sirf tab dikhta hai jab aap already pan kar chuke ho.
- `MapViewInner` me **`NavigationControl` hai hi nahi** — yaani kisi bhi role
  ko zoom `+/−` buttons nahi milte, na `FullscreenControl`, na `ScaleControl`.
  Sirf scroll-wheel/pinch.

### Fix

Ek **shared map shell** banao (mobile ek component, web ek), jisme by default
ye sab ho: zoom buttons, follow primary + switch, fit-route, fullscreen,
gesture ownership. Phir driver/admin/parent teeno usi ko alag `variant` ke
saath render karein. `map-controls.ts` (policy) aur `useFollowCamera` (binding)
**already reusable hain** — sirf `BusMap` unhe call hi nahi karta.

---

## 5. Bus 3D aur unique chahiye — P1

### Abhi kya hai

- **Web** (`bus-marker-icon.ts:50`): literally 5 `<rect>` — body, windscreen,
  do window strips, ek rear bar. Yeh "kafi basic 2D" wali cheez exactly yahi
  hai.
- **Mobile** (`BusMarkerGraphic.tsx`): 26×42 dp PNG sprite (@1x/@2x/@3x),
  `scripts/make-bus-marker.py` se generate hua — flat top-down bus, halka
  shading. Behtar hai web se, par phir bhi "sticker" jaisa.
- **Dono alag buses hain** — parent app pe alag, console pe alag. Comment me
  likha hai ki match karte hain, par karte nahi.
- **Map khud flat hai**: poore codebase me kahin `pitch`, `bearing`,
  `fill-extrusion`, `sky`, ya terrain set nahi hota. Driver map ne to jaan-boojh
  ke `touchRotate={false} touchPitch={false}` kiya hua hai (safety reason,
  documented).

### Teen option (effort ke hisaab se)

| Option | Kya                                                                                                | Cost                       | Recommendation |
| ------ | --------------------------------------------------------------------------------------------------- | -------------------------- | -------------- |
| **A** — Pseudo-3D marker | Ek shared isometric/3-quarter school-bus SVG: gradient body, glass reflection, chassis shadow, un-rotating ground ellipse, live pulse halo, heading cone | ~0 KB extra, koi nayi dependency nahi | ✅ **Karo** |
| **B** — 3D map camera    | `pitch: 45`, `maxPitch: 60`, z≥15 pe `fill-extrusion` buildings, sky layer, "2D/3D" toggle          | Web free; mobile pitch supported; GPU load thoda badhega | ✅ Karo, **toggle** ke saath |
| **C** — Real glTF model  | `deck.gl` / three.js custom layer + 3D bus model                                                    | +~600 KB web, mobile me equivalent nahi, 2 alag buses fir se | ❌ Abhi nahi |

**Plan: A + B.** Ek hi SVG `packages/map-assets` (naya tiny package) me rakho,
web usko inline kare, mobile ke liye wahi SVG `make-bus-marker.py` se PNG
densities generate kare — to **ek hi bus** dono jagah. 3D camera ek toggle ho:
admin/parent pe default ON, driver pe default OFF (driver safety decision
already documented hai — usse todna nahi chahiye).

UX polish jo saath me karni chahiye:
- speed > 3 km/h pe heading cone, warna nahi (jhoota direction na dikhe — yeh
  rule already `bus-motion.ts` me hai, marker ko bas follow karna hai);
- `prefers-reduced-motion` / `useReducedMotion()` pe pulse aur tilt band;
- stale fix pe bus **desaturate** ho jaye (abhi sirf text kehta hai "last known");
- stop dots ko bhi ek soft 3D lift (shadow + ring) mile, par species alag rahe.

---

## 6. Trip create karte hi admin ko "Boarding / Start" dikhna — P1 (asli bug, confirmed)

### Kya hota hai

`web/src/app/(authenticated)/trips/[id]/page.tsx:71–75`:

```tsx
<Card title="Lifecycle">
  <TripStatusActions trip={data.trip} onUpdated={...} />   // ← role ka koi check nahi
</Card>
```

aur `packages/validation/src/index.ts:1245`:

```ts
[TripStatus.SCHEDULED]: [TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.CANCELLED],
```

Matlab trip banate hi, admin ko **Boarding**, **In progress** aur **Cancelled**
teen buttons page ke sabse upar wale card me dikhte hain. Bilkul wahi jo aapne
dekha.

Mobile pe bhi same: `mobile/app/(admin)/trips/[id].tsx:177` crew ka
`TripStatusActions` render karta hai.

### Server kya kehta hai

`web/src/server/api/trips.ts:114` — `PATCH /trips/:id/status` ke roles:
`[SCHOOL_ADMIN, DRIVER, CONDUCTOR]`, aur `trips.service.ts:412` admin ko
explicitly allow karta hai. Yaani **API jaan-boojh ke admin ko override deta
hai** (dispatcher override — bus kharab, driver phone dead, etc.).

Isliye yeh **UI bug hai, API bug nahi** — jab tak aap na kaho ki admin ko
bilkul nahi karna chahiye.

### Fix

- `/crew` (driver/conductor) pe bade crew buttons — waise hi rahein.
- Admin trip page pe: **read-only lifecycle timeline** (Scheduled → Boarding →
  In progress → Completed, with timestamps). Crew buttons hatao.
- Ek collapsed **"Dispatcher override"** section: warning text + confirm dialog
  + reason field, taaki emergency me admin kar sake par galti se na dabaye.
- Ya agar aap strict separation chahte hain: admin se status change poora hatao
  aur `patchTripsByIdStatus` ke roles se `SCHOOL_ADMIN` nikaal do (Cancel alag
  endpoint pe already admin-only hai: `trips.ts:144`).

> **✅ Decided (30 Sep 2026): override rahega, par chhupa hua.** Admin page pe
> read-only lifecycle timeline; crew buttons "Dispatcher override" collapsed
> section me, warning + confirm dialog + audit log ke saath. API contract nahi
> badlega — `SCHOOL_ADMIN` endpoint pe rahega.

---

## 7. Performance, reuse aur code duplication — P2 (bada, par asli fayda yahin hai)

### Aaj kitna duplicate hai

Yeh files web **aur** mobile dono me alag-alag copy hain, apne-apne spec files
ke saath:

| Module                     | web (lines) | mobile (lines) |
| -------------------------- | ----------- | -------------- |
| `bus-motion.ts` + spec     | 581 + 673   | 646 + 790      |
| `follow-camera.ts` + spec  | 154 + 178   | 156 + 178      |
| `tracking-presentation.ts` | 153 + 174   | 154 + 199      |
| `accuracy-circle.ts`       | 67          | 95 + 107       |
| `geo.ts`                   | 44          | (lib/geo.ts)   |
| `map-style.ts` + spec      | 83 + 111    | 315 + 263      |
| bus graphic                | 125 (SVG)   | 97 (PNG)       |

Total **~2,500+ lines** ka near-duplicate, plus do alag bus designs, plus do
alag map-style policies jo "mirror" hone chahiye par enforce nahi hoti.

Aur components me: `BusMap.tsx` (633) + `DriverTripMap.tsx` (1169) me ~70%
same surface code hai (sources, layers, accuracy circle, camera, panel).

### Plan

1. **Naya workspace package `packages/map-core`** — pure TypeScript, zero React,
   zero native import:
   `bus-motion`, `follow-camera`, `follow-camera-controller`, `map-controls`,
   `tracking-presentation`, `accuracy-circle`, `geo`, `fit-camera`,
   `route-snap`, `map-style` policy, `arrival-zone` math.
   Saare spec files usi package me shift → **ek suite, do nahi**.
2. **Naya `packages/map-assets`** — ek bus SVG (string export) + stop marker SVG
   + PNG generator script. Web inline karega, mobile build-time PNG banayega.
3. Mobile: ek `LiveMapSurface` component, teen variants (`driver` | `observer` |
   `parent`). `DriverTripMap` aur `BusMap` dono usi ke wrapper ban jaayein.
4. Web: `MapViewInner` (855 lines) ko todo — `useMapInstance`,
   `useBusMarker`, `useStopLayer`, `useCameraControls`.

### Speed wins (measurable)

| Kya                                                                               | Fayda |
| ---------------------------------------------------------------------------------- | ----- |
| Stops ko N markers ki jagah **ek GeoJSON symbol layer** banao (web + mobile dono)  | 30-stop route pe Android me 30 offscreen bitmap rasterisation → 1 layer. Sabse bada win. |
| Mobile `BusMap` ko `React.memo` surface + `GestureIsland` do (driver map jaisa)     | 5 s status tick native map tak nahi pahunchega |
| Web: `hasAnything` flip pe poora map re-create hota hai — usko hatao               | Map ek baar bane, data badalne pe sirf sources update hon |
| Trail line decimation (Douglas–Peucker)                                            | 2 ghante ka trip @4 s = 1,800 points, har fix pe poora LineString re-set ho raha hai |
| `maplibre-gl` ko alag chunk me rakho (`next/dynamic` already hai — CSS bhi udhar)  | Admin dashboard ka initial JS ~200 KB halka |
| Bus SVG ko `<defs>` + `<use>` se ek baar inject karo                                | Har marker create pe `innerHTML` parse nahi hoga |

---

## 8. Driver aur conductor role — jo "fix nahi hua"

Yahan mujhe **aapse confirm karna hai** ki exactly kya expected tha, kyunki
code me jo hai wo jaan-boojh ke hai:

- Driver aur conductor **ek hi crew screens** share karte hain —
  `mobile/src/lib/roles.ts:8–12`, aur `features/driver/index.ts` +
  `features/conductor/index.ts` dono literally `export * from '../crew'` karte
  hain.
- Par **conductor ko map aur GPS strip dikhta hi nahi**: `app/(crew)/trip.tsx`
  me `const isDriver = user?.role === UserRole.DRIVER` (line 133) aur map/GPS
  blocks `{isDriver ? ... : null}` ke peeche hain (lines 502, 513, 536).
- Conductor ka phone GPS bhi start nahi hota (by design — do phone se do
  position stream conflict karte).

Matlab: is report ke saare map fixes **conductor tak pahunchenge hi nahi**, jab
tak hum yeh na decide karein.

> **✅ Decided (30 Sep 2026): conductor ko read-only map milega.** `isDriver` gate
> do hisson me toot jayega — **map** driver + conductor dono ko, **GPS sharing
> strip aur location watcher** sirf driver ko. Conductor ka phone kabhi second
> GPS stream start nahi karega (iska test bhi likha jayega), aur conductor ko
> observer copy dikhegi, "your device" wali nahi. Yeh PR-5 me hai.

---

## 9. Jo test se prove nahi ho sakta (honest disclosure)

Repo me `node_modules` install nahi hai is sandbox me, aur mobile ke saare map
tests pure-TS policy modules pe hain (renderer ke bina). Isliye:

- Android pe gesture ownership (pinch vs ScrollView) — **sirf phone pe** prove
  hoga.
- `LogManager` ke asli log lines kya aate hain — sirf device pe dikhega; isliye
  fix me allow-list ke saath ek **debug screen** honi chahiye jo raw log
  dikhaye (Help → Diagnostics me already jagah hai: `crew-diagnostics.ts`).
- MapLibre GL JS ke `error` event ka exact shape per-tile vs per-style — browser
  me verify karna hoga.
- 3D pitch ka performance impact low-end Android pe — device pe measure karna
  hoga.

---

## 10. Suggested order — 4 zaroori session + 1 optional

Pehle 7 PR socha tha; jinke files aur test surface same the unhe merge kar diya.

1. **Session 1 (P0):** bus map pe dikhe **+** jhoota "Map failed to load" khatam.
   (dono ek hi files me hain)
2. **Session 2 (P1):** admin se crew lifecycle buttons hatao (read-only timeline
   + chhupa override) **+** arrival zone — detection 25 m, display patli ring +
   distance + manual mark-arrived.
3. **Session 3 (P1, sabse bada):** ek shared map surface — admin/parent/conductor
   ko zoom, follow, fullscreen, gesture island; mobile web pe asli map; **+**
   stops = ek layer (speed win, kyunki surface waise bhi rewrite ho raha hai).
4. **Session 4 (P1):** ek shared 3D bus (SVG → web inline + mobile PNG) + 3D map
   toggle + UI polish. *Session 3 ke baad hi.*
5. **Session 5 (P2, optional):** `packages/map-core` extraction + trail
   decimation + duplicate-module guardrail. Skip bhi kar sakte ho.

Session 1, 2, 3 ek dusre se independent hain — order badal sakte ho. 4 ko 3 ke
baad hi chalana.

Har session ka ready-to-paste prompt:
[`field-report-2026-09-29-fix-prompts.md`](./field-report-2026-09-29-fix-prompts.md)
