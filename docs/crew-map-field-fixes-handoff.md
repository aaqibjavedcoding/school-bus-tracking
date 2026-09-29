# Crew map & tracking — field-defect batch (handoff)

Seven defects were reported from a real run (driver parked at home, first stop
= home with two kids). Two were server-side and shipped first; this document
covers the five mobile ones and states exactly what is proven by CI and what
still needs a phone.

| #    | Report                                                          | Status                                   |
| ---- | --------------------------------------------------------------- | ---------------------------------------- |
| P0-1 | Stop-arrival cascade — every stop recorded, trip auto-completed | fixed earlier (`eta` departure gate)     |
| P0-2 | Next-stop voice said "0 students"                               | fixed earlier (kids-load race)           |
| P1-3 | Full Map opened to a 0-height map                               | fixed — `flex: 1` in the modal           |
| P1-4 | "HOLD to send SOS" flush against Manifest/Stops                 | fixed — `linkRow` bottom margin          |
| P1-5 | Zoom unusable: no buttons, pinch scrolled the screen instead    | fixed — buttons + gesture island         |
| P1-6 | "Follow bus" did nothing / turned itself off                    | fixed — one primary, explicit switch     |
| P2-7 | "No fix from this device yet" lied after an app restart         | fixed — persisted stats + actionable CTA |

Everything below is presentation and persistence. **`follow-camera.ts`'s
reducer policy and its specs are untouched**, by instruction and on merit: the
camera was deciding correctly, the screen was describing it badly.

---

## P1-3 — the Full Map modal had no height

`DriverTripMap` drew the map into `styles.wrap`, which carries a fixed
`height` for the embedded card. Inside the fullscreen `Modal` the same style
applied, so the map got the card's height inside a full-screen container — and
on the first layout pass, before that height resolved, it got zero. The modal
opened onto a blank sheet with a working Close button.

The fix is one style, applied only in fullscreen:

```ts
wrapFull: { flex: 1, borderRadius: 0, borderWidth: 0 },
```

`mapBody(fullHeight)` already branched on the mode, so the modal now passes
`[styles.wrap, styles.wrapFull]`: the wrap fills the modal, the rounded card
edge disappears where there is no card, and the embedded path is unchanged.

**Still needs a device:** that `controlsFull` clears the modal header on a
notched Android phone and under iOS Dynamic Island, and that exit-fullscreen
returns the embedded map to its previous camera. Both are on the manual
checklist in [`live-tracking-map.md`](./live-tracking-map.md).

## P1-4 — the SOS panel touched the buttons above it

`<Screen>` is a `ScrollView` with `padding: spacing.md` and **no child gap**;
every card owns its own bottom margin. The `linkRow` (Manifest + Stops) had
none, so `SosQuickPanel` — a hold-to-confirm destructive control — sat flush
against two ordinary navigation buttons. A thumb travelling to "Stops" ended
its swipe on the SOS panel.

```ts
linkRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
```

`spacing.md` is 16 dp, matching `StopMarkActions` directly above it, so the
whole column now has one rhythm rather than one exception. The map card gained
the same `marginBottom` for the same reason.

## P1-5 — zoom

Three separate causes, three separate fixes.

### Buttons (`src/features/map/map-controls.ts`)

A pinch is a two-hand gesture and a driver has one hand. `+` / `−` buttons are
stacked at the map's right edge; the policy — step size, bounds, and whether a
button is live — is a pure module so "already fully zoomed in" is decided once
and tested without a renderer:

- `MAP_ZOOM_STEP = 1` (a whole level; half steps read as "nothing happened"),
- `MAP_ZOOM_MIN = 3` / `MAP_ZOOM_MAX = 19` — bounds on _the buttons_, not a
  `minZoom`/`maxZoom` clamp on the engine; a pinch may still go anywhere,
- `zoomLimits(currentZoom)` drives the disabled state, so a button at the
  maximum is visibly spent instead of silently dead.

A press is a **programmatic** camera move: MapLibre reports no
`userInteraction`, and `follow-camera-controller.ts`'s `zoomBy` suppresses its
own zoom-delta fallback for the move it just issued. **Zooming therefore never
knocks the camera out of follow** — which is the behaviour the pinch could not
offer and the main reason the buttons exist.

### Gesture ownership (`src/components/scroll-lock.ts` + `gesture-island.tsx`)

The embedded map lives inside the `Screen` `ScrollView`. On Android the
scroll container wins a drag that starts on a child unless the child calls
`requestDisallowInterceptTouchEvent`, and the installed
`@maplibre/maplibre-react-native@^11.4.0` does not. Reading the installed
native source (pinned by `maplibre-runtime.spec.ts`) confirmed there is no
prop for it, so the fix is on our side of the boundary:

`GestureIsland` wraps the map and, via touch **observers** (`onTouchStart` /
`onTouchEnd` / `onTouchCancel` — never `onStartShouldSetResponder`, which
would swallow the events the native map needs), sets `scrollEnabled={false}`
on the owning `Screen` for the duration of the touch. Ownership is refcounted
in `scroll-lock.ts` so a second island, or an unmount mid-gesture, cannot
leave the screen permanently unscrollable. Outside a `<Screen>` the island
degrades to a plain `View`.

The MapView is also now explicit about what it accepts — `dragPan`,
`touchZoom`, `doubleTapZoom`, `touchRotate={false}`, `touchPitch={false}` —
rather than relying on the library's defaults, because rotate and pitch on a
240 dp card are only ever accidents.

### Height

`EMBEDDED_MAP_MIN_HEIGHT = 240` is the component's default; the trip screen
passes `Math.max(260, EMBEDDED_MAP_MIN_HEIGHT)`. At the old 200 dp a pinch had
nowhere to land.

**Still needs a device:** Android gesture ownership is the one fix here that a
Node test cannot prove. The specs pin the policy and the library's source
strings; only a phone can prove the map keeps the drag and the screen still
scrolls outside it.

## P1-6 — "Follow bus"

The old block was three states across two controls, and the primary button
_toggled follow off_ while following. A driver who had panned away and wanted
the bus back pressed the big button and got follow switched off. With no fix
at all, the same button called `recenter()`, which returns early when nothing
is rendered — a tap that did nothing, silently, with no explanation.

`driverFollowControls({ hasFix, followEnabled, exploring })` now returns the
whole view as data:

- **primary** is always _Follow bus_: re-centre **and** re-enable following.
  Never a toggle, so its tap can never mean the opposite of its label.
- **secondary** is an explicit `accessibilityRole="switch"` pill — _Follow: on_
  while following, a disabled _Follow: off_ state pill when not (the way back
  on is the primary right next to it).
- **no fix** disables the primary and says why: _Waiting for fix_, with the
  a11y hint _Waiting for a GPS fix — follow is unavailable_.

The accessibility live region announces `controls.stateKey`, so a mode change
is spoken rather than only drawn. **There is no state in which tapping does
nothing without saying why** — the acceptance criterion, expressed as the
module's contract and covered case-by-case in `map-controls.spec.ts`.

## P2-7 — the panel lied after a restart

### The persisted record

`lastFix` and `lastAckAt` lived in memory only. An app restart reset them and
the panel announced _"No fix from this device yet"_ while the server was
holding fixes this very phone had sent minutes earlier. It was the most
alarming sentence on the screen, it was false, and nothing on the screen could
clear it.

`src/features/crew/tracking-stats-persistence.ts` is the pure half:
`CREW_TRACKING_STATS_KEY`, a codec, `decidePersistedStatsRestore` and
`shouldPersistTrackingStats`. `tracking-lifecycle.ts` writes from `patchStats`
(fire-and-forget, single in-flight write) and hydrates inside
`hydrateCrewTracking`.

Three rules keep a restored fix honest:

1. **Scoped to the trip.** The record carries its `tripId` and is refused for
   any other — a coordinate from the morning run must never appear as the
   afternoon's bus. This is the one failure mode worse than the bug being
   fixed, and `decidePersistedStatsRestore` returns `other-trip` for a
   mismatch _and_ for no trip at all.
2. **Scoped to the account** (`userId` / `schoolId`) — the same ownership
   check `tracking-context.ts` applies to the resumable trip.
3. **Bounded by age** — `PERSISTED_FIX_MAX_AGE_MS` is 12 h, aligned with
   `TRACKING_CONTEXT_MAX_AGE_MS`, since a fix that outlives the context could
   only be restored next to a trip the lifecycle has already forgotten.

The record keeps its **original timestamps**, so `deriveCrewTrackingStatus`
ages it exactly as it would have in a process that never died: a restored fix
reads _last known, 4 min ago_, never _live_, and the marker is never animated
as a moving bus. Hydration also never starts a watcher, and live values
already in memory always win over the disk.

Writes are throttled to `STATS_PERSIST_MIN_INTERVAL_MS` (10 s) — fixes arrive
every ~4 s and this is a value read once per process — **except** a trip
change, which writes immediately, because a record naming the wrong run must
not exist even for ten seconds. The record is deleted alongside the persisted
context (stop, logout, account change), so ending a run erases it.

Nothing secret is stored: a coordinate this device produced, its accuracy,
heading, speed and mock-location flag, and two timestamps.

### The no-fix CTA

The panel's no-fix state now offers the action that would actually fix it,
chosen by `driverMapNoFixCta(state, strip)` in `crew-map-presentation.ts`.
It **reuses `gpsStripActions`** — the same policy `GpsShareStrip` renders — so
the map can never offer a different remedy from the strip six points above it:

| strip action         | map CTA label  | wired to                              |
| -------------------- | -------------- | ------------------------------------- |
| `share` / `retry`    | Share / Retry  | `sharing.retry()`                     |
| `open-settings`      | Open settings  | `sharing.openLocationSettings()`      |
| `request-permission` | Allow location | `sharing.requestLocationPermission()` |
| `stop` → `help`      | Get help       | `router.push('/help')`                |

`stop` is deliberately remapped: "stop sharing" is not a remedy for _no fix_,
so when the strip's primary is Stop the map deep-links to Help instead. No new
mechanism, no second retry path.

---

## Conductor path

`features/conductor/index.ts` re-exports the crew feature wholesale, so every
change above reaches the conductor screen. Re-checked after the batch:

- the GPS strip and the map remain `isDriver`-gated — a conductor sees
  neither, and the new map props are computed from pure functions with no
  side effects;
- the conductor's lifecycle never starts GPS, so `state.tripId` stays null and
  `persistStatsIfDue()` returns before touching storage;
- `NextStopKidCard` and the next-stop announcement are untouched by this batch
  and still read the same frontier-derived stop and kid count.

## What CI proves

```bash
npm --prefix mobile test          # 1378 unit tests
npm --prefix mobile run test:sim  # 4 simulations, 61 scenarios
npm run typecheck && npm run lint
```

| Spec                                  | Pins                                                                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `map-controls.spec.ts`                | zoom step/bounds/limits, and every follow-control state — including that no reachable state produces an enabled control with nothing to do                                              |
| `follow-camera-controller.spec.ts`    | a zoom press never leaves follow (even reported as a gesture); our own pan misattributed by Android keeps follow; a far centre or a centre-less report exits; the window expires        |
| `maplibre-runtime.spec.ts`            | the installed native source strings the gesture fix depends on, so a library bump that changes them fails CI instead of a driver's phone                                                |
| `scroll-lock.spec.ts`                 | refcounted ownership: nested islands, unmount mid-gesture, never a stuck unscrollable screen                                                                                            |
| `tracking-stats-persistence.spec.ts`  | the codec (incl. every corrupt shape), all eight restore decisions, the trip-scope guarantee, and the write throttle                                                                    |
| `tracking-recovery.sim.spec.ts` 34–37 | end to end: send → kill → reopen → the panel stops lying; a restored fix ages instead of going live; the next run never inherits the previous position; another driver restores nothing |
| `crew-map-presentation.spec.ts`       | the no-fix CTA mapping, including `stop` → Help                                                                                                                                         |
| i18n parity / clipping                | `map.followWaitingFix`, `map.followOffA11y`, `map.noFixA11y`, `map.zoomIn`, `map.zoomOut` in `en`/`hi`/`mr`, with a badge budget on the waiting state                                   |

## What still needs a phone

These are simulations with test doubles, not device tests. Unverified here, in
priority order:

1. **Android gesture ownership** — pinch and pan on the embedded map while the
   screen still scrolls above and below it (P1-5, the only fix whose core
   claim is native).
2. **Fullscreen layout** on a notched Android device and an iPhone with Dynamic
   Island — map fills the sheet, `controlsFull` clears the header, exit works.
3. **`userInteraction` attribution at runtime** — if the provider ever reports
   a real pinch as programmatic, the zoom-delta fallback in `follow-camera.ts`
   is what catches it; the spec proves the fallback fires, a device proves
   which path is taken.
4. **The restart path on a real kill** — force-stop, reopen, confirm the panel
   shows _last known_ with a plausible age rather than _no fix_.
