# Web crew console (`/crew`)

The `/crew` page is the web counterpart of the mobile trip screen: the page a
driver or conductor keeps open on a phone or dashboard tablet. It used to show
only the trip status controls, the SOS panel, a plain live map and the
passenger manifest. This document describes the additions that bring it to
parity with the mobile crew experience: the **next-stop card**, the **stops
table with Arrived / Skip**, the **Google Maps navigation hand-off** and the
upgraded map — all in **English, Hindi and Marathi**.

Everything here is client-side composition over endpoints and policies that
already existed; no server module, admin page, parent page or the shared
`ManifestList` component was changed.

## Next-stop card

`web/src/features/crew/NextStopCard.tsx`, rendered first on the page:

- stop name and a **"Stop 4 of 8"** counter (`stopCounterOf`, route order);
- distance and ETA, read from the **server-computed** ETA summary
  (`GET /trips/:tripId/eta` snapshot + `trip:eta:update` socket pushes via the
  shared `useLiveTripTracking` hook). The client never invents a distance or
  an ETA: without a GPS fix both read "Waiting for GPS";
- how many and **which** children are still waiting at that stop
  (`summarizeStopKids` over the trip manifest — PENDING rows at the stop,
  windowed to 8 names with a "+N more" line, mirroring mobile's
  `next-stop-kids.ts`);
- a **Navigate** button (below).

Which stop is "next" is server-authoritative where possible
(`crew-progress.ts` → `deriveNextStop`): the ETA summary's `next_stop` wins
while it is still unserved; before the first GPS fix the fallback is the first
stop in route order without an arrival/skip record. A stop that was arrived
**or skipped** is never re-surfaced as next.

## Stops table with Arrived / Skip

`web/src/features/crew/CrewStopsPanel.tsx`: one row per route stop with its
number, name, children count (and how many still waiting), live ETA +
distance, state badge (**Arrived / Skipped / Next / Pending**) and the two
crew actions:

- **Arrived** → `POST /trips/:tripId/stops/:stopId/arrive`
- **Skip** → inline reason form (required, min 3 characters — the same rule
  the server enforces) → `POST /trips/:tripId/stops/:stopId/skip`

Both go through the existing api-client methods (`markTripStopArrived`,
`skipTripStop`) from the crew stop-marking PR, each press carrying one
idempotency key (`withIdempotencyKey(generateIdempotencyKey())`) so a retry
can never record a stop twice. A stop the geofence already recorded answers
`created: false` and is toasted as "already recorded", never as an error.
Row state comes from the fetched arrivals (`GET /trips/:tripId/arrivals`,
`skip_reason !== null` ⇒ skipped) with the live ETA summary's `arrived` flag
as backup for geofence arrivals that happen while the page is open.

## Navigation hand-off (no paid SDK)

`web/src/features/crew/navigation.ts` mirrors `mobile/src/lib/navigation.ts`:
the stack has no routing service on purpose, so navigation is a **hand-off** —
the page builds the documented Google Maps URL-API deep link and opens it in a
new tab; the device's own map application does the turn-by-turn routing. No
key, no account, no metered request (the `map-provider-policy` guard test
keeps it that way).

- `buildDirectionsUrl` — `https://www.google.com/maps/dir/?api=1&destination=…
&waypoints=…&travelmode=driving&dir_action=navigate`, byte-identical to the
  mobile builder. No `origin` is ever sent (the map app's own live position is
  always fresher). Waypoints are capped at Google's limit of 9.
- `buildDirectionsUrlChunks` — long routes split into consecutive ≤2048-char
  links without losing or reordering a stop.
- `buildCrewRouteUrl` — the crew page entry: next stop as destination, the
  remaining unserved, surveyed stops (route order) as waypoints.
- The "never navigate to a guessed coordinate" rule lives in
  `navigationTargetOf`: a stop without real in-range coordinates is not a
  navigation target, and the card explains why the button is disabled.

Tests: `web/src/features/crew/navigation.spec.ts`, registered in
`web/package.json` → `test:web` (runs in CI's "Web tests" job). It pins the
URL contract against the mobile spec plus the `crew-progress.ts` derivations
(next-stop choice, per-stop state, waiting-kids windowing, driven trail).

## Map

The shared `MapView` gained three **optional** props (`types.ts`); callers
that omit them — admin tracking, trip detail, parent pages — keep the exact
previous behaviour:

- `nextStopId` — the crew page's next stop rendered as the enlarged, pulsing
  `.stop-marker.next` marker. Deliberately separate from `highlightStopId`
  (which parent pages use for a child's home stop) so the two cannot fight.
- `trail` — the path the bus has **actually driven**, as its own green line
  (`sbt-trail` source/layer) above the blue planned line. Seeded from
  `GET /trips/:tripId/location/history` and extended by every live fix
  (`appendTrailPoint`, deduped and capped).
- `controls` — opt-in **"Fit route"** button (always visible) next to the
  existing **"Follow bus"** control, with caller-supplied (localized) labels.
  Fit hands the camera to the user (explore mode) so the next GPS fix cannot
  yank the fitted view away; Follow hands it back.

The straight blue line between stops is captioned honestly on the crew page
(localized): it is the planned stop order drawn as straight lines, **not the
real road** — same disclaimer the tracking pages already carry.

## Languages (en / hi / mr)

`web/src/features/crew/crew-i18n.ts`: every string this feature adds ships in
English, Hindi and Marathi, with wording reused from the mobile dictionaries
(`mobile/src/lib/i18n.{en,hi,mr}.ts`) where a matching key exists. The
default is **Hindi** (the crew audience default, like mobile), persisted per
device in `localStorage` (`sbt.crew.language`), switchable from the page
header. The scheme (flat keys, `{param}` placeholders, `.one`/`.other`
plurals) matches mobile. This is deliberately scoped to `/crew` — the admin
and parent surfaces are out of scope, so no global i18n framework was
introduced.

## File map

| File                                                 | Role                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `web/src/app/(authenticated)/crew/page.tsx`          | Page composition: one live subscription feeds card/table/map. |
| `web/src/features/crew/NextStopCard.tsx`             | Next stop, counter, distance/ETA, waiting kids, Navigate.     |
| `web/src/features/crew/CrewStopsPanel.tsx`           | Stops table + Arrived / Skip(reason) endpoint calls.          |
| `web/src/features/crew/navigation.ts`                | Google Maps URL builders (pure, mirrors mobile).              |
| `web/src/features/crew/crew-progress.ts`             | Next-stop / stop-state / kids / trail derivations (pure).     |
| `web/src/features/crew/crew-i18n.ts`                 | en/hi/mr dictionaries, `crewT`, `useCrewLanguage`.            |
| `web/src/features/crew/navigation.spec.ts`           | Contract tests, registered in `test:web`.                     |
| `web/src/features/map/types.ts` + `MapViewInner.tsx` | Optional `nextStopId` / `trail` / `controls` props.           |
| `web/src/features/tracking/TripTracker.tsx`          | Pass-through of the new optional props + localized captions.  |
