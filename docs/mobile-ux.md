# Mobile UX — legibility system

How the Expo app presents itself to its least-technical users first: drivers and
conductors who read the screen at arm's length, in daylight, sometimes through
gloves. This document is the map of the system introduced by the mobile
legibility pass (Phase 1): the tokens, the measured contrast, and — just as
importantly — what was deliberately **not** changed.

**Phase 2 (crew screens: one job, one screen) is merged on top of this system —
its map is in ["Phase 2 — crew screens: one job, one screen"](#phase-2--crew-screens-one-job-one-screen)
below. Phase 1's tokens and guards are untouched by it; Phase 2 only builds on
them.**

## The layers

1. **Shared tokens — untouched.** `packages/design-tokens` is also consumed by
   the web console; its scales and palette values were not edited. Web density
   is unchanged.
2. **Mobile-only aliases** (`mobile/src/theme/tokens.ts`): a semantic layer
   _over_ the shared tokens, picked for the phone:
   - `text.body` 14 (floor for anything that carries information), `text.secondary` 13
     (short labels only), `text.title` 16, `text.numeric` 20, `text.statusWord` 20 —
     the standard consumer-app scale (owner decision, 2026-09).
   - `touch.compact` 44 (dense admin rows only), `touch.target` 56 (every
     button's default), `touch.field` 64 (crew field actions: start trip,
     board, SOS, share GPS).
   - `surface.actionPrimary` = `secondary[700]` — **green is the action colour**
     (owner decision, 2026-09: the school-bus amber read as "dark orange" on the
     trip/map screens; amber stays the brand accent and the IN_PROGRESS state),
     `actionSuccess` = `secondary[700]`,
     `actionDanger` = `status.danger`, `actionInfo` = `status.info`,
     `borderInteractive` / `placeholder` = `neutral[500]` — every filled action
     surface reaches WCAG AA with its label (measured table below).
3. **Machine-checked guards** (run in `npm --prefix mobile test`):
   - `theme/contrast.spec.ts` pins every text/background pair below and the
     regression marker for the old primary button.
   - `theme/legibility.spec.ts` scans the source tree: **0 text under 14px on
     crew surfaces** (`app/(crew)`, `src/features/crew`,
     `src/features/tracking`) and a 13px floor app-wide.

## Measured contrast (computed by `contrast.spec.ts`, not by eye)

| Pair                                                  | Background                | Foreground                | Ratio       | WCAG floor |
| ----------------------------------------------------- | ------------------------- | ------------------------- | ----------- | ---------- |
| primary action label                                  | `#15803d` (secondary-700) | white                     | **5.01:1**  | 4.5:1      |
| success action label                                  | `#15803d` (secondary-700) | white                     | **5.01:1**  | 4.5:1      |
| danger action label                                   | `#dc2626` (status.danger) | white                     | **4.83:1**  | 4.5:1      |
| info action label                                     | `#2563eb` (status.info)   | white                     | **5.17:1**  | 4.5:1      |
| secondary button label                                | white                     | `#1e293b`                 | **14.63:1** | 4.5:1      |
| ghost button label                                    | `#f1f5f9`                 | `#334155`                 | **9.45:1**  | 4.5:1      |
| badge neutral / ghost                                 | `#f1f5f9`                 | `#334155`                 | **9.45:1**  | 4.5:1      |
| badge info                                            | `#e0f2fe`                 | `#0369a1`                 | **5.17:1**  | 4.5:1      |
| badge warning                                         | `#fef3c7`                 | `#b45309`                 | **4.51:1**  | 4.5:1      |
| badge success                                         | `#dcfce7`                 | `#166534`                 | **6.49:1**  | 4.5:1      |
| badge danger                                          | `#fee2e2`                 | `#b91c1c`                 | **5.30:1**  | 4.5:1      |
| interactive border (inputs, chips, secondary buttons) | white                     | `#64748b` (neutral-500)   | **4.76:1**  | 3:1        |
| placeholder text                                      | white                     | `#64748b` (neutral-500)   | **4.76:1**  | 3:1        |
| active chip / active tab tint                         | white                     | `#15803d` (secondary-700) | **5.01:1**  | 4.5:1      |
| toast success                                         | `#15803d`                 | white                     | **5.01:1**  | 4.5:1      |
| toast danger                                          | `#dc2626`                 | white                     | **4.83:1**  | 4.5:1      |
| muted text on screen background                       | `#f8fafc`                 | `#475569`                 | **7.24:1**  | 4.5:1      |

**Regression marker (the bug this fixes):** the old primary button rendered
white text on `primary[500]` = **2.15:1** — it failed every threshold and is
now pinned in the spec so it cannot silently return (`OLD_PRIMARY_BUTTON_RATIO`).

## Buttons

One `Button` for everything (`src/components/ui.tsx`):

- **Sizes:** `sm` 44 (dense admin rows only), `md` 56 (default), `lg` 60,
  `field` 64 (crew field actions).
- **Icon + label always** (`icon` / `iconRight`, Ionicons) — an action is read
  faster with both than with either alone.
- **Tones:** filled variants resolve to the measured-AA surfaces above; the
  crew's green-vs-neutral vocabulary ("board" green, "drop" neutral, lifecycle
  actions from `crew-action-meta.ts`) is one shared, unit-tested mapping.
- **Accessibility:** `accessibilityRole="button"`, label fallthrough,
  `{disabled, busy}` state, busy spinner; press feedback = scale 0.965 +
  opacity via the built-in `Animated` (no reanimated dependency).

## Type-scale rule (enforced by the guard spec)

- Body text is never under **16px**; status/numbers are **22–28px bold**
  (`text.numeric`, `text.statusWord`).
- Labels/secondary never under **14px** — the design token `xs` (12px) no
  longer appears anywhere in the app.
- Crew surfaces: **0 instances below 16px**, guarded in CI
  (`legibility.spec.ts`).
- Dynamic type: `allowFontScaling` stays ON with `maxFontSizeMultiplier` caps
  on chrome (1.3× labels, 1.5× button labels — `fontScaleCaps`) so a large
  system font cannot break 56/64px rows. Manual OS-font check on a crew
  device: Settings → Display → Font size → Largest → trip screen stays
  single-column, nothing clips.

## Interpretations worth knowing

- **Tab-bar labels are platform chrome** (every OS ships ~10–13pt captions
  there). They were still bumped phone 11 → 13, tablet 13 → 14
  (`bottom-bar-metrics.ts`), and the active/inactive tints moved to
  `secondary[700]` / `neutral[500]` (both AA).
- Where a visual element must stay small (banner ✕, search clear), its _hit
  area_ was raised to ≥44px with `hitSlop`, keeping the visible icon compact.

## Deliberately NOT done (and why) — Phase 1 list, annotated where Phase 2 picked it up

- **Shared `design-tokens` values unchanged** — the web console depends on
  them; mobile-specific choices live only in `mobile/src/theme/`. _(Still
  true in Phase 2: the status-card colours alias existing token values.)_
- **Telemetry moved, not deleted** — the GPS diagnostics counters
  (rejected/dropped/invalid) stay exactly where they are in Phase 1; moving
  them to a Help/Support surface is Phase 2 scope. _(→ Done in Phase 2 —
  they now live on the Help/Support screen; see below.)_
- **No screen restructuring** — the giant one-state-per-screen crew trip card,
  hold-to-confirm SOS with haptics/voice, and the full-row tap board/drop are
  Phase 2/3. _(The trip card, hold-to-confirm SOS and full-row board/drop are
  now Phase 2; haptics/voice remain Phase 3.)_
- **No new dependencies** — `Animated` is built in; `expo-haptics` /
  `expo-speech` arrive with Phase 3, keeping every merge small and reviewable.
  _(Still true: Phase 2 added zero dependencies, and **Phase 3a added zero
  too** — the device locale comes from `Intl` / `NativeModules.I18nManager`
  instead of `expo-localization`. Only 3b adds the two audio/haptics
  packages.)_
- **Admin density preserved where deliberate** — `Button size="sm"` (44px) and
  the `md` badge/chip sizes remain for dense admin tables; the admin sweep to
  14px labels and visible borders happened, but table density opt-in stays.
- **No chart/audio assets** — unchanged; house rule 11 stands.

## What a driver/conductor sees differently (before → after)

- Every button grew: trip actions are 64px with icons ("Start boarding" 🧍,
  "Depart & drive" 🧭, "Share GPS" 📍) — previously 44px text-only.
- The brand-amber buttons are now **green** with readable white text
  (2.15:1 → 5.01:1); amber is reserved for brand accents and the IN_PROGRESS
  state word, so the map/trip area no longer reads as dark orange.
- Manifest rows: names 15 → 18px bold, "Board" is a green 60px icon button,
  filter chips are 56px with icons and counts.
- All trip ETA numbers are 24px bold; "Next stop" headline is 20px.
- Offline/sync banner text is 16px with a 56px "Sync now"/"Retry".
- Anything grey that was hard to read (placeholders, secondary borders,
  "muted" text) is now visibly darker.

---

## Phase 2 — crew screens: one job, one screen

Phase 2 restructures the **crew (driver + conductor) screens only** — admin and
parent surfaces are untouched except where the Phase-1 guards already applied.
The audience rule: a semi-literate crew member, one thumb, full sun, stress —
**if reading is required, the design failed**. Everything below is client-side
presentation; API contracts, `packages/*`, the offline queue, GPS
validation/sharing, socket wiring, idempotency keys and session refresh are
untouched.

### The new screen IA (what lives where now)

**Trip tab (`app/(crew)/trip.tsx`)** — top to bottom:

1. **Giant status card** (`features/crew/StatusCard.tsx`) — the background
   colour _is_ the state (mapping below); the state word at 28px bold with its
   icon; the **next stop + ETA at 24px** (server-computed ETA only); exactly
   **one** primary action (64px, from `TripStatusActions`, on a white sheet so
   the coloured button always sits on the measured white surface); everything
   else — route code, scheduled time, date, bus reg no., role chip, connection
   state, departed/arrived stamps, "N trips today" — inside a collapsible
   **"More details"** section (collapsed by default, `accessibilityState`
   exposed). **De-prioritised, not deleted.**
2. Offline-sync banner (unchanged).
3. **Driver GPS strip** (`features/crew/GpsShareStrip.tsx`) — the whole
   driving-time story: `Sharing ✅ / ❌` + last-update time + one tap
   (**Share GPS** first, **Stop** while running, and after a failed start the
   failing cause's own repair — **Open location settings** for a services-off
   switch or a permanent denial, **Ask for location permission** for a
   refused-but-askable prompt, **Retry** only for anything else —
   `gps-strip-action.ts`, spec-pinned) + a "GPS details & support" link. A
   failed start also gets a **second line with the reason** (danger tone,
   announced politely) so `Sharing ❌` is never left to be guessed. The
   driver's confirmed lifecycle tap starts sharing itself, so the strip's
   button is the fallback, not the normal way in.
4. Driver navigation card (button is now `secondary` — the lifecycle action
   stays the only filled primary on the screen). The **Driver Trip map** above
   it is now a driving card: a `Next: {stop} · {distance} · ~{eta}` line above
   the map box (all server numbers), the next stop drawn as the one big amber
   **NEXT** pin (id passed down from `deriveTripProgressForTrip`; the map never
   picks one), a dotted green **trail** of recorded fixes (the only "driven"
   line), a solid amber **planned stop-order** line ahead with a caption saying
   it is not the road route, **Full screen**, and an explicit
   **Follow: on/off** pill — see `docs/live-tracking-map.md` → "The two lines,
   the badge and the driving card".
   **The next-stop block (N3/N6 rework)** — the driver's navigation card is
   now the whole "what's next" answer in one glance: stop name (18px bold),
   **"Stop 4 of 8"** (`navigate.card.stopOf`), the server's
   `distance · ~ETA` line, **"N kids waiting here"** (the PENDING count over
   the whole next-stop manifest slice — all-marked reads "All kids marked at
   this stop"), the kid **names with their ✓ marks** rendered inside the same
   card (`NextStopKidRows` — one block, one heading, no duplicate
   "Kids at next stop" title), and the lat/long demoted to one small muted
   line. The old `Trip {id} · N stops` meta line (a truncated trip id) is
   **gone** — diagnostics, not kerbside copy. The conductor keeps the
   standalone kids card (same data, its own heading) because they do not
   drive.
5. Manifest / Stops & ETA links (56–60px, icon + label).
6. **SOS quick row** — the hold-to-confirm button + its status line.
7. "Help & support" link.

**SOS tab (`app/(crew)/sos.tsx`)** — the full panel: hold-to-confirm button
(same component), status line, optional **"Add details first"** sheet
(type/message/location — the _after-the-fact_ path; the default path needs zero
reading), recent alerts, cancel flow.

**Help & Support (`app/(crew)/help.tsx`, hidden tab — `href: null`, reached
from the trip screen)** — **the GPS telemetry moved here, nothing was
deleted**: the full `GpsSharePanel` with all four counters ("Sent",
"Rejected", "Dropped (offline)", "Invalid fix"), last fix + server reason, the
background-sharing switch, and the permission-recovery UI. Below the panel, an
always-available **Diagnostics (for support)** card (both crew roles, with or
without a trip): app runtime (Expo Go / development build · platform), API
host, live-tracking socket, connection, location services, foreground +
background permission, what is sharing, last stop with the server's trip
status, recovery attempts + last reason, last error + when, and the delivery
counters — built by `crew-diagnostics.ts`, whose spec pins that no JWT-shaped
string or secret can reach any row. Framed as what it is: numbers the crew
reads _with the support team_, not while driving. A
source guard (`features/crew/help-routing.spec.ts`) asserts the move in both
directions so a future edit cannot undo it silently.

**Manifest (`app/(crew)/manifest.tsx`)** — same list, new rows: the **whole
card is the tap target** (row tap = the current action), a **60px ✓/✕ glyph
zone** on the right (green ✓ = board, grey ✕ = drop), and on success a
**green flash** + inline **"Ramesh ✓ 7:42 AM"** (server timestamps only) +
a screen-reader announcement. Filter chips keep their icons and counts.
Names 18px bold, rows ≥64px. The offline queue, idempotency and 409-as-success
handling are byte-for-byte the Phase-1 logic; a queued action shows
"⏳ saved offline" on the row until the server confirms.

### Status → colour mapping (machine-checked)

The mapping lives in `features/crew/trip-status-style.ts` and is pinned by
`trip-status-style.spec.ts`:

| Trip state    | Card background           | Word        | Icon           | White-word contrast |
| ------------- | ------------------------- | ----------- | -------------- | ------------------- |
| `BOARDING`    | `#15803d` (secondary-700) | BOARDING    | people         | **5.01:1**          |
| `IN_PROGRESS` | `#b45309` (primary-700)   | ON THE ROAD | navigate       | **5.02:1**          |
| `COMPLETED`   | `#475569` (neutral-600)   | COMPLETED   | checkmark-done | **7.58:1**          |
| `CANCELLED`   | `#475569` (neutral-600)   | CANCELLED   | close-circle   | **7.58:1**          |
| `SCHEDULED`   | `#475569` (neutral-600)   | SCHEDULED   | time           | **7.58:1**          |

- All values are **aliases of existing shared tokens** — `design-tokens` is
  untouched (Phase-1 rule).
- "Distinguishable from a metre away" is asserted as a **pairwise RGB
  distance ≥ 60** between the three distinct state colours — a plain, honest
  proxy, spelled out in the spec.
- **Colour is never the only cue**: every state also differs in its word
  _and_ its icon (`crew-copy.ts` pins distinct words), so colour-vision
  deficiency changes nothing.
- The primary action's colour always hints the _next_ state (grey card →
  green "Start boarding", green card → amber "Depart & drive", amber card →
  grey "Complete trip") — the existing `crew-action-meta` vocabulary.

### Hold-to-confirm SOS (≤1 press, impossible to brush-fire)

- One 64px red button (`features/crew/HoldToConfirmButton.tsx`); press-and-
  hold **900 ms** (pinned inside the required 600–1200 ms window) with a
  dark **fill sweep** (built-in `Animated`); release early = cancel, nothing
  fires.
- The decision logic is the pure `hold-to-confirm.ts` controller: **fires
  exactly once per completed hold**, double-press cannot re-fire until reset.
- Every request of one alert carries the **same idempotency key**
  (`sos-flow.ts` `SosSession`; key rotates only after server confirmation) —
  the Task-44 contract of `POST /api/v1/emergencies/sos` is unchanged and the
  key-reuse behaviour is spec-pinned (`sos-flow.spec.ts`).
- Offline → **"SOS queued ⏳ — will send when internet returns"**, then an
  automatic same-key retry on reconnect. Queueability is decided by the
  attendance queue's shared `shouldQueueAfterError` rule. Deliberate scope:
  this retry state is **session-scoped** (in memory), because the durable
  offline queue is attendance-only by design and `features/crew/offline` is
  zero-touch in Phase 2. A durable SOS queue would need a backend-approved
  queue extension — future work, not silently invented here.
- Screen readers skip the hold: the accessibility _activate_ action fires
  immediately (holding is a motor pattern, not an a11y one).
- The type/message sheet is optional and its confirm button is _also_ a hold
  button — every path to the server goes through hold-to-confirm.

### Crew copy is i18n-ready (Phase 3 plug point)

Every Phase-2 string lives in `features/crew/crew-copy.ts` (flat, key-stable,
pure formatters for interpolated ones) — Phase 3's Hindi/voice layer replaces
this one module; Phase 2 ships English-only copy through it. Guarded by
`crew-copy.spec.ts` (non-empty, distinct uppercase status words).

### Guard specs added in Phase 2 (all under `npm --prefix mobile test`)

| Spec                        | Pins                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trip-status-style.spec.ts` | status→colour mapping, white-word ≥4.5:1 on every state, RGB-distance ≥60 between state colours, distinct word+icon per state, exactly one primary action per state |
| `hold-to-confirm.spec.ts`   | 900 ms inside the 600–1200 ms window, single-fire + lock, early-release cancel, progress curve                                                                      |
| `sos-flow.spec.ts`          | same idempotency key across retries/double-press, key rotation only on server confirmation, queued-on-offline semantics                                             |
| `manifest-row.spec.ts`      | row ≥60px, glyph ≥60px, name 18px, ✓/✕ mapping, "Name ✓ time" confirmation from server timestamps, a11y labels + announcements, flash colour contrast               |
| `help-routing.spec.ts`      | telemetry counters **gone** from `trip.tsx`, **present** on `help.tsx`, help registered as a hidden tab, SOS fires only through hold-to-confirm                     |
| `crew-copy.spec.ts`         | copy non-empty, status words distinct + uppercase                                                                                                                   |

The Phase-1 guards still pass unchanged: **0 text below 16px on crew
surfaces** (the new screens included) and every contrast pair — the three new
status-card pairs are rows in `theme/contrast.ts` → `contrast.spec.ts` → the
table above.

---

## Phase 3 — localisation & voice

Phase 3 makes the app usable by someone who cannot read English. It is
**client-side only**: no API contract, no `packages/*` change, no migration, no
new endpoint. The server keeps speaking English.

Phase 3 ships in two parts. **3a (this section) is localisation**: the i18n
layer, the English/Hindi dictionaries, the string migration, the language
switch and the guards. **3b is voice + haptics** (`expo-speech` /
`expo-haptics`) and appends its own subsection here.

### The key set

`mobile/src/lib/i18n.en.ts` is the **source of truth**: **423 keys** (286 at
Phase 3a, +28 by Phase 3b for voice lines and sound settings, +29 by Phase 4b
for the crew PIN/QR login, +1 for `settings.language.nameMr` when Marathi
joined, and more by the later phases; the reliability/runtime effort of this
branch adds +35 — the map panel, the background gating, the strip repair
actions, the status line and the diagnostics card), flat and dotted
(`manifest.confirmBoard`, `gps.tierGood`, `error.HTTP_409`). `mobile/src/lib/i18n.hi.ts` and `mobile/src/lib/i18n.mr.ts`
are typed as `Dictionary` — the same key set with widened values — so a
missing or extra key in any locale is a **compile** error before it is ever a
runtime one.

| Group                                                | Keys    | Covers                                                                                                                      |
| ---------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `nav.*`, `role.*`                                    | 20      | tab labels, screen titles, role words                                                                                       |
| `status.*`, `attendance.label.*`, `boarding.label.*` | 16      | trip/attendance vocabulary, incl. the 20px card words                                                                       |
| `trip.*`                                             | 39      | trip screen, "More details", lifecycle actions, cancel flow                                                                 |
| `manifest.*`                                         | 42      | board/drop, filters, summary badges, search, a11y labels + announcements                                                    |
| `sos.*`                                              | 39      | hold-to-confirm, status line, details sheet, cancel flow                                                                    |
| `gps.*` (incl. `gps.recovery.*`)                     | 44      | sharing strip + panel, permission recovery                                                                                  |
| `offline.*`                                          | 15      | sync banner (with `.one`/`.other` plural pairs)                                                                             |
| `stops.*`, `eta.*`, `navigate.*`, `connection.*`     | 21      | stops screen, ETA views, navigation hand-off, live chip                                                                     |
| `help.*`, `settings.*`                               | 23      | Help screen, the language switch + the Phase-3b sound settings (incl. the batch-3C missing-voice hint)                      |
| `login.*`                                            | 39      | sign-in labels + the crew PIN/QR path (school code + PIN, no user id)                                                       |
| `common.*`, `time.*`                                 | 12      | shared chrome, relative time, minutes, the On/Off switch words                                                              |
| `error.*`                                            | 18      | known server error codes + the four crew-login codes + the unknown-code prefix                                              |
| `voice.*`                                            | 17      | **spoken only** — Latin script in every locale, never rendered on screen (the note under this table has the batch-3C delta) |
| **total**                                            | **345** | the groups above are exhaustive — every key is in exactly one                                                               |

> The counts above are the **Phase-3b snapshot** this table was written against
> and are stale in several places: later batches (reliability, date nav, push,
> 3C) moved groups around and added `map.*`, `driverMap.*`, `datePicker.*` and
> `date.*`, which no row covers — `en` now carries **491** keys. Batch 3C's own
> delta, stated exactly rather than folded into a stale total: `voice.*`
> **17 → 38** (the 17 Latin lines kept, plus `voice.stop.next` /
> `voice.stop.approaching`, plus the 19-key `voice.native.*` twin) and
> `settings.*` **+2** for the missing-voice hint. Reconciling the whole table is
> a docs task of its own and is deliberately not done here.

### Resolution order

Implemented once, in `resolveInitialLocale` (`src/lib/i18n.ts`), and pinned by
`i18n.spec.ts`:

1. **saved preference** (AsyncStorage key `sbt.mobile.locale`) — an explicit
   choice always wins;
2. **role default** — `DRIVER`/`CONDUCTOR` → **`en`** (owner decision, 2026-09:
   the app opens in English and the driver picks their language); everyone
   else → the device locale;
3. **`en`** — an unsupported or absent device locale falls back to the source
   of truth rather than to a guess.

The deliberate consequence: **a crew member on a Hindi- or Marathi-locale
phone still opens in English** until they pick a language themselves — the
switch lives on the **login screen** (a row of self-naming pills) _and_ on
the Help screen, and once tapped the saved choice wins forever. Admins and
parents follow the device, since their screens are also used from the English
web console.

**No `expo-localization`.** The device locale is probed in
`src/lib/i18n-preferences.ts` from first-party sources only — iOS
`I18nManager.localeIdentifier` / `SettingsManager`, Android
`I18nManager.languageIdentifier`, then `Intl.DateTimeFormat().resolvedOptions().locale`
(full Intl ships in Hermes on the SDK-57 line), then `navigator.language` on
web. Adding a dependency would mean version-locking it to the SDK-57 line per
`docs/mobile-expo-sdk.md` for something `Intl` already does. **Phase 3a adds
zero dependencies.**

### Switching: instant, persisted, no restart

`t()` reads the active locale at call time, so a component only has to
_re-render_. `I18nProvider` (mounted in `app/_layout.tsx`, above `AuthProvider`)
holds the locale in context; every component that renders translated copy calls
`useTranslation()`, which subscribes it. `i18n-literals.spec.ts` fails the build
if a crew screen renders copy without subscribing — that is exactly the bug that
would otherwise make a switch "need a restart".

Nothing is remounted: navigation state, form input and the manifest scroll
position all survive a switch. The preference is written to AsyncStorage, so
the next cold start opens in the same language; a boot-time _default_ is applied
without persisting, so it can never overwrite a deliberate choice.

One rule for contributors, because it is easy to get wrong: **never destructure
copy into a module-level constant.** `const { sent } = crewCopy.sos` at import
time captures one locale forever. `crewCopy` is now a table of getters for
exactly this reason, and `trip-status-style.ts` / `ManifestList.tsx` were
changed to read at call time (the latter's filter list became a function).

### The server-string boundary (read before calling the i18n "incomplete")

Two classes of string are **deliberately never translated**:

1. **Data.** Student names, route/bus codes, stop names, school names,
   registration numbers, admission numbers, coordinates. Translating data is
   wrong; it renders as the server sent it. Placeholders (`{name}`, `{route}`,
   `{status}`) carry data into translated sentences and stay untouched.
2. **Server-supplied English.** API error `message`s, `EMERGENCY_TYPE_LABELS` /
   `EMERGENCY_STATUS_LABELS`, `*_document_type_label`, the GPS `lastReason`,
   the offline queue's `lastError`, and the **support counters** on the Help
   screen — the four panel counters ("Sent", "Rejected", "Dropped (offline)",
   "Invalid fix") pinned verbatim by `help-routing.spec.ts`, plus the
   diagnostics card's counter words (sent / accepted / rejected / pending /
   invalid / retried) and the runtime names (Expo Go / Development build)
   declared in `LOCALE_INVARIANT_KEYS` — because they are read aloud _to the
   support engineer_, who works in English, and the screen says so.

Where the server supplies a **known error code**, the app swaps in its own
copy. `KNOWN_ERROR_CODES` in `src/lib/i18n.ts` maps the codes the server
actually emits — verified against `web/src/server/http/response-envelope.ts`
(`HTTP_<status>`, `INTERNAL_SERVER_ERROR`), `rate-limit.constants.ts`
(`RATE_LIMIT_EXCEEDED`) and `api/health.ts` (`SERVICE_NOT_READY`). The rules, in
`localizeApiError`:

| Server gave                  | The app shows                                                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| known code (not 403)         | the app's own localised copy                                                                                                                                                 |
| `HTTP_403` + a message       | **the server's message verbatim** — the 403 taxonomy in `docs/mobile-operations.md` forbids masking it; the localised string is only the fallback when the server sends none |
| **unknown** code + a message | the message **as-is**, plus a visible `Server code XYZ` note                                                                                                                 |
| status `0` (no network)      | the localised offline line — the action was saved and will sync                                                                                                              |
| nothing                      | `common.error`                                                                                                                                                               |

An unknown code is never guessed at and never hidden: the crew sees the server's
words and the raw code, so a support call still has the exact identifier.

`getApiErrorMessage` in `src/lib/errors.ts` is **unchanged** — its English
sentences are pinned by `errors.spec.ts`. `getLocalizedApiError` is an additive
twin for the surfaces that want localisation (manifest board/drop, SOS send,
SOS cancel).

### Clipping: the guard and the measured reality

Hindi is longer, so fixed-width text can clip. This environment cannot run a
device, so the guard is a **character budget per key** derived from the
container (`src/lib/i18n-budget.ts`, 46 budgeted keys), enforced by
`i18n-clipping.spec.ts`. Placeholders are stripped before measuring — a
student's name is the same length in every language; only the chrome around it
is translated. The budget errs strict, which is the safe direction: `.length`
counts Devanagari combining matras that add no glyph width.

| kind           | container                                                | budget |
| -------------- | -------------------------------------------------------- | ------ |
| `tab`          | bottom tab bar, 4 across, 13px                           | 12     |
| `chip`         | filter-chip label (`numberOfLines={1}`, ` · N` appended) | 11     |
| `badge`        | summary/signal badge, row wraps, capped at 2 lines       | 16     |
| `statusWord`   | the 28px word on the status card                         | 16     |
| `buttonRow`    | two `flex:1` buttons side by side, may wrap              | 18     |
| `buttonWide`   | two-button row with longer wording (cancel flow)         | 22     |
| `bannerButton` | offline-banner actions, `flexWrap` row                   | 16     |
| `buttonFull`   | full-width 64px field button with an icon                | 22     |
| `label`        | `KeyValue` label — full-width row above its value        | 20     |

**A measured correction to the folklore.** "Hindi runs 20–30% longer" is not
what this dictionary says: summed over the 286 Phase-3a keys, Hindi chrome is ~5%
_shorter_ than English by code-unit count, because matras compress and Hindi
compounds. What is real — and what actually clips — is **per-key** growth, up
to **2.25×** on a short label (`stops.arrivals` 8 → 18). So the per-key budget
is the load-bearing guard, and `growthCeiling` is a backstop with an absolute-
slack term for short strings, where a percentage is meaningless.

Two strings were shortened to fit rather than widening a container:
`sos.holdLabel` (`दबाकर रखें — SOS भेजें`, 22) and the Hindi ETA line.

### The grep gate

`i18n-literals.spec.ts` is a source scanner in the family of
`help-routing.spec.ts` and `legibility.spec.ts` — the repo has no Jest/Vitest,
and a filesystem assertion is the only thing that stops the next screen from
reintroducing a raw `'Loading…'`. It scans `app/(crew)/**` **and**
`src/features/crew/**/*.tsx` and fails on:

- a raw literal in a **UI prop** (`label`, `title`, `description`,
  `placeholder`, `message`, `accessibilityLabel`, `accessibilityHint`,
  `confirmLabel`, `cancelLabel`, `hint`) — the strings a user reads or a screen
  reader speaks;
- raw **JSX text** between tags;
- any other **prose-looking** literal.

The allowlist is categories, not get-outs: icon glyphs, style/layout enums,
route paths and tab names, data and enum values, symbols and codes, the four
support counters above, and the dictionary modules themselves. It also asserts
the scan is not silently empty (≥6 crew screens, ≥8 crew components) and that
every crew screen and the crew layout call `useTranslation()`.

**Localised accessibility too**: `accessibilityLabel` / `accessibilityHint` and
the `AccessibilityInfo.announceForAccessibility` strings all come from the
dictionary — a screen reader announces in the same language the screen shows.

### Guard specs added in Phase 3a (all under `npm --prefix mobile test`)

| Spec                        | Pins                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `i18n.spec.ts` (21)         | resolution order (saved → role/device → `en`), crew-default-English (a saved choice always wins), tag normalisation, interpolation (an unknown placeholder stays visible, never `undefined`), subscribe/notify, persist-on-choice vs no-persist-on-default, a failing store is non-fatal, `pluralKey`, the whole server-string boundary table |
| `i18n-parity.spec.ts` (9)   | **0 missing / 0 extra** keys, no empty values, identical placeholder names _and_ counts, complete `.one`/`.other` pairs, every key identical to English in any locale declared in `LOCALE_INVARIANT_KEYS`, distinct status words in every locale, ✓/✕/⏳ glyphs survive translation                                                           |
| `i18n-clipping.spec.ts` (6) | all 46 budgeted keys fit in **both** locales, no key grows past `growthCeiling`, the per-key growth envelope, the single-line filter chip is fed only budgeted keys, the tab bar stays four labelled actions                                                                                                                                  |
| `i18n-literals.spec.ts` (5) | **0** hardcoded English UI literals on crew screens _and_ crew components, every copy-rendering screen subscribes to the locale, the scan is not empty                                                                                                                                                                                        |

The Phase-1 and Phase-2 guards still pass **unchanged**: `contrast.spec.ts`,
`legibility.spec.ts` (Hindi included — 0 text under 16px on crew surfaces),
`help-routing.spec.ts`, `crew-copy.spec.ts`, `trip-status-style.spec.ts`,
`manifest-row.spec.ts`, `hold-to-confirm.spec.ts`, `sos-flow.spec.ts`.
`crew-copy.ts` kept its exact shape, so Phase 2's call sites and its spec needed
no edits.

---

## Phase 3b — Voice feedback + haptics

Phase 1 made the screen readable, Phase 2 made it one job per screen, Phase 3a
made it Hindi. Phase 3b is for the moment the driver **is not looking at the
screen at all**: the phone is on a cradle or in a hand at arm's length, the bus
is loud, the sun is on the glass, and a conductor is tapping through forty
students. The question the app has to answer without being read is _"did that
tap count?"_

So a confirmed action now arrives on four channels at once: the row flashes
green, the line of text updates, the screen reader announces it, and — new here
— the phone **says it and buzzes**. Nothing was taken away; voice is the fourth
channel, not a replacement for any of the first three.

### What it says

Every phrase is first name + what happened + when, 6–9 words, because that is
what survives engine noise:

These are the exact strings the modules produce (printed from `voicePhrase()`,
not paraphrased):

| Event                | Hindi line — Latin _fallback_ (no `hi-IN` voice) | English voice line                         |
| -------------------- | ------------------------------------------------ | ------------------------------------------ |
| Board confirmed      | _Ramesh ka boarding ho gaya, 7:42 subah_         | _Ramesh has boarded, 7:42 in the morning_  |
| Drop confirmed       | _Priya utar gaya, 3:10 dopahar_                  | _Priya has got off, 3:10 in the afternoon_ |
| Rapid boards summary | _5 bachche chadh gaye_                           | _5 students boarded_                       |
| Trip → BOARDING      | _Boarding shuru ho gayi_                         | _Boarding started_                         |
| Trip → IN_PROGRESS   | _Trip shuru, dhyan se chalaiye_                  | _Trip started, drive safe_                 |
| Trip → COMPLETED     | _Trip poori hui, shukriya_                       | _Trip complete, well done_                 |
| SOS delivered        | _Emergency alert school ko chala gaya_           | _Emergency alert sent to school_           |
| SOS queued offline   | _Network nahi hai, alert dobara bheja jayega_    | _No network, emergency alert will retry_   |
| Offline queue synced | _7 save kiye kaam bhej diye gaye_                | _7 saved actions have been sent_           |
| GPS on / off         | _Location bhejna chalu / band_                   | _Location sharing on / off_                |
| Next stop (batch 3C) | _Agla stop: Shivaji Chowk, 12 bachche_           | _Next stop: Shivaji Chowk, 12 students_    |
| Approaching (3C)     | _Shivaji Chowk pahunchne wale hain, 12 bachche_  | _Approaching Shivaji Chowk, 12 students_   |

One known rough edge, flagged rather than hidden: the drop line uses the
masculine _utar gaya_ for every student. Hindi verb agreement is gendered
(_utar gayi_ for a girl) and the attendance payload carries no gender field,
so a correct choice is not available to the client. Options were a wrong
gender half the time, a clumsy neutral construction, or adding a field to the
API — out of scope for a feedback layer. Left as-is and noted for whoever owns
the student schema.

### Which voice the phone speaks (batch 3C)

Phase 3b spoke Latin-script Hinglish on **every** device, because a budget
Android in service often has an English voice and no `hi-IN` one. That was the
right fallback and the wrong ceiling — a phone that _can_ speak Marathi was
still being handed romanised Marathi and asked to read it as English. Batch 3C
makes the **device** decide, once:

| the phone has `hi-IN` / `mr-IN`                    | spoken line                                   | tag handed to the engine                                  |
| -------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| **yes**                                            | `voice.native.*` — real Devanagari            | `hi-IN` / `mr-IN`, with the exact voice identifier pinned |
| **no**                                             | `voice.*` — Latin Hinglish / Marathi-in-Latin | `en-IN`, with the best English voice pinned               |
| **not measured yet** (cold start, probe in flight) | `voice.*` — the Latin fallback                | `en-IN`, and no hint (an unmeasured phone is not accused) |

So the same event says, in Hindi:

| mode                   | `voicePhrase({ type: 'board.confirmed', … })`            |
| ---------------------- | -------------------------------------------------------- |
| native voice installed | _रमेश बस में चढ़ गया, 7:42 सुबह_ through `hi-IN`         |
| no native voice        | _Ramesh ka boarding ho gaya, 7:42 subah_ through `en-IN` |

and in Marathi _रमेश बसमध्ये चढला, 7:42 सकाळी_ / _Ramesh bas madhe aaun gele,
7:42 subah_. The **screen** is Devanagari in both modes (Phase 3a, unchanged):
a screen is read, a speaker is heard, and only the second one depends on what
the phone has installed.

Three rules make this safe rather than clever, all pinned by spec:

- **the tag always matches the script.** `hi-IN` with Latin text garbles, and
  `en-IN` with Devanagari garbles — the bug in both directions. The resolver
  picks the pair together, never separately.
- **detection happens once per process.** `Speech.getAvailableVoicesAsync()` is
  a native round-trip (on iOS it even needs a silent warm-up before it answers
  at all), so it runs once in `crew-feedback-native.ts`, is parsed by the pure
  `parseVoiceCapabilities()` and cached. Resolving a plan afterwards is a
  `Map.get`, so an announcement costs no I/O and no UI-thread work — the app
  did not get slower to make it speak properly.
- **the fallback is explained, not silent.** When the app's language has no
  voice on a _measured_ phone, Help → Sound & vibration shows one dismissible
  row: "_{language} voice not installed — announcements are spoken in English.
  Install the {language} voice under Android Settings → Text-to-speech
  output._" It disappears for good once the voice exists.

Voice copy lives in two parallel namespaces — `voice.*` (Latin) and
`voice.native.*` (native script), 19 keys each, never reused for anything on
screen — so nobody can shorten a screen label and change what the bus hears,
and nobody can "fix" a fallback line into Devanagari and silently break audio
on the phones that need it. English has one script, so its two rows are the
same sentence; a spec pins that equality so the pair cannot drift, and another
pins that every pair carries the same placeholders (the resolver picks a key at
runtime, so a drifting `{name}` would be read aloud).

Still free and on-device: `expo-speech` drives the OS engine and no paid voice
API is involved anywhere in this path.

### The throttle: latest-wins, never a queue

A conductor boarding a full bus generates events far faster than a voice can
speak them. The rule is **latest-wins with a 600 ms floor**, and the pending
slot holds exactly **one** item (`VOICE_PENDING_CAPACITY = 1`):

- an announcement inside the gap **replaces** whatever was waiting — it does
  not line up behind it;
- so the voice can never run behind the screen, which is the specific failure
  that makes a talking app useless: hearing student #3 while tapping #21;
- when replacements pile up, the one that eventually speaks is the **summary**
  ("_5 bachche chadh gaye_") rather than a stale single name;
- `Speech.stop()` precedes every `Speech.speak()`, so a new announcement cuts
  the old one off instead of waiting for it;
- SOS bypasses all of it (`PRIORITY_EVENTS`) and clears the pending slot. If
  the driver pressed the emergency button, that is the sentence that gets said.

Measured, one tap every 25 ms for a second: **40 board events produce 3
announcements** — _"Student0 has boarded, just now"_, then _"24 students
boarded"_, then _"15 students boarded"_ — with a maximum pending depth of
**1**. The spec pins ≤ 6 rather than exactly 3 so a copy change cannot make it
flaky, and pins ≥ 2 so a future "fix" cannot silence the feature entirely.
Haptics are deliberately **not** throttled at that rate — 40 boards give 40
taps, because a tap per action is the whole point of a tap.

### Next-stop announcements (batch 3C)

The crew's other eyes-off moment is the one _before_ the doors open: which stop
is next, and how many children are on it. Batch 3A made `eta.next_stop`
server-authoritative (the progress frontier, so a missed visit cannot stick the
trip at a stop it already passed), which made the fact trustworthy enough to
say out loud. So the phone now says it — for **both** roles, because the
conductor boards and drops the same children the driver carries:

- **when the next stop changes** — _"Next stop: Shivaji Chowk, 12 students"_;
- **again when the bus is nearly there** — _"Approaching Shivaji Chowk, 12
  students"_ — at `eta_minutes <= 2` **or** `distance_meters <= 400`, because
  `eta_minutes` is null without a GPS fix and is rounded _up_ to whole minutes.

`next-stop-announcer.ts` is the policy and it is **edge-triggered**: an ETA push
arrives every few seconds with a new distance, and a level-triggered announcer
would talk continuously. Two remembered stop ids — one per fact — make each
stop two sentences at most, and a new trip forgets them, so an evening run on
the same route still announces its first stop. If a stop is _already_ close when
it becomes next, only the approaching line is spoken: one fact, one sentence.

It reuses what the trip screen already has, so the announcement and the "kids at
next stop" card cannot disagree, and it fetches nothing: the same summary object
and the same `eta.next_stop`. Two refusals keep it honest — a stop whose count
is **still loading** is waited for rather than announced as zero, and a stop
with **no name** is not announced at all (a hole in a sentence is a bug you can
hear). It reports through the one dispatcher, so the Voice switch, the 600 ms
floor, latest-wins and `Speech.stop()`-before-`speak()` all apply unchanged: a
stop line can neither talk over a boarding burst nor queue behind one. A light
haptic accompanies it, which also answers a question a driver cannot ask at the
wheel — was that the phone, or the road?

One announcer, one call site (`app/(crew)/trip.tsx`, the screen both roles run),
zero role branches: `crew-feedback-wiring.spec.ts` fails the build if a
per-role copy appears or if the announcer starts reading the role.

### The progress frontier belongs to one trip (T1)

Everything above reads the server's `next_stop`, and the screen adds one thing
of its own: a **client frontier** so a late, out-of-order push cannot walk the
driver backward inside a run. That frontier used to live in a `useRef` on the
trip screen — and the trip screen **never unmounts between trips**. When the
morning run completed, `pickCrewTrip` selected the next run on the following
reload and the new run was derived with the previous run's frontier:

- a finished 6-stop run followed by a 5-stop run gave _"no candidates ahead of
  frontier 6"_ — **no next stop at all**: the Navigate button disappeared, the
  "kids at next stop" card emptied, the voice went quiet, and the server's own
  `next_stop` was rejected as _"behind frontier, ignored"_;
- a smaller stale frontier was worse, because it looked plausible: the new run
  opened on its **second** stop and the bus drove past a stop full of children.

Only an app force-close recovered. The frontier is therefore **scoped to a trip
id** (`features/crew/trip-progress.ts`, spec'd by `trip-progress.spec.ts`): the
state carries the trip it was measured on, a trip switch resets it to zero on
the first render, and the screen derives the next state in a memo and stores it
from an effect — nothing is mutated during a render, and an unchanged frontier
keeps its object identity so an ETA push cannot churn re-renders.

Two neighbouring leaks in the same moment were closed with it, because both
feeds outlive a trip switch: an **ETA payload** whose `trip_id` is not the trip
on screen is treated as "no ETA yet" (the live hook keeps the previous trip's
payload until the new snapshot lands, and two runs can share a route), and the
**stop list** is only used when it was loaded for the route the trip actually
runs. The server's `next_stop` remains the source of truth throughout; the
client frontier is a safety net for one trip, never a memory across trips.

### Never blocks, never fails an action

Speech and haptics are reporting, never gating. `feedback.on()` returns `void`,
nothing is ever `await`ed on the speech path, and every native call is wrapped
so a throw is counted and swallowed. A phone with no TTS engine, no haptic
motor, or a `Speech.speak` that throws on an unsupported language records a
boarding **exactly** the same way a healthy phone does. `crew-feedback.spec.ts`
proves it by making the driver throw on every call and asserting the board
result is unchanged; `crew-feedback-wiring.spec.ts` greps the source so nobody
can add an `await` later.

### Privacy: what the bus is allowed to hear

A voice announcement is heard by every student on board, not just the person
holding the phone. The deny-list is enforced in code and asserted by spec:
**never** a medical note, a phone number, a guardian name or contact, the SOS
detail message, or a full name with admission number. A first name and a time
is the whole payload — enough for the crew member who just tapped, useless to
anyone else.

Batch 3C did not widen that payload. A next-stop event carries a **stop name**
(school data) and an **aggregate count** — no student field exists in the type,
so `SPOKEN_STUDENT_FIELDS` is still `['first_name']` and a spec asserts it.
Naming the twelve children waiting at Shivaji Chowk would have put four
families' names on a speaker; the manifest screen already shows them to the
person whose job it is. Two nets stay in front of the engine: a count is capped
at 999 so a corrupt payload cannot become a six-digit read-out, and
`isSpeakable()` still drops anything that looks like an identifier.

### Settings

Help & support → **Sound & vibration**: two switches, Voice and Vibration,
64px rows with icon + label, state written in words as well as shown by colour.
Two rather than one because they break independently (no TTS engine ≠ no haptic
motor) and a driver should be able to silence the talking without losing the
buzz. Defaults are a role decision, mounted where the role is known: crew get
both on, `SCHOOL_ADMIN`/`PARENT` get voice off. Saved to AsyncStorage under
`sbt.mobile.sound` with the same adapter pattern Phase 3a used for the locale,
and applied on cold start before the first announcement can fire.

Under the switches, batch 3C adds one **conditional, dismissible** row: when
the phone was measured and has no voice for the app's language, the card names
the missing voice in its own script (हिन्दी / मराठी), says that announcements
are therefore spoken in English, and says where to install one. It is advice on
a settings card rather than a dialog mid-run, it is one-time (dismissible, and
per-session — it is not a preference and cannot overwrite one), and it
disappears for good the moment the voice exists.

### Where the feedback comes from

One module owns the policy; the surfaces only report facts:

| Surface                                              | Reports                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `ManifestList`                                       | `board.confirmed` / `drop.confirmed`                                      |
| `TripStatusActions`                                  | `trip.boarding` / `trip.inProgress` / `trip.completed`, `action.rejected` |
| `SosPanel`                                           | `sos.fired` / `sos.queued`                                                |
| `HoldToConfirmButton`                                | `sos.holdStart`                                                           |
| `GpsShareStrip`                                      | `gps.on` / `gps.off`                                                      |
| `OfflineSyncBanner`                                  | `offline.synced`                                                          |
| `useNextStopAnnouncements` (trip screen, both roles) | `stop.next` / `stop.approaching` — batch 3C                               |

Each is a single `feedback.on({ type: … })` — no surface knows what a haptic
pattern or a voice phrase is, and a spec fails the build if one starts to. Two
of them report a **state transition** rather than a button press
(`GpsShareStrip`, `ManifestList`) precisely so the phone cannot announce
something the server refused.

### Deliberately not done

- **No durable voice queue.** Announcements are disposable. An action that
  happened 40 seconds ago is not worth saying, and a queue that survives a
  restart would talk about a trip that already ended.
- **`features/crew/offline/*` is zero-touch.** The sync summary is derived from
  the state the banner already subscribes to. The queue, the idempotency
  lifecycle in `SosSession`, GPS validation and socket reconnect gained no
  feedback code at all — asserted in both directions by spec.
- **`hold-to-confirm.ts` untouched.** The 900 ms hold, the early-release
  cancel, the single-fire guarantee are byte-identical; the tick is fired by
  the component at press-in.
- **No audio assets, no cloud TTS, no new screens, no native config.** Two
  dependencies, both Expo-Go compatible, no `app.json` change.

### Guard specs (Phase 3b, extended by batch 3C — all under `npm --prefix mobile test`)

| Spec                                | Pins                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crew-voice.spec.ts` (62)           | **3C**: the two namespaces (Latin fallback Devanagari-free, native lines Devanagari in `hi`/`mr`, English's pair pinned equal, placeholders identical), voice-tag parsing (`hi_IN`, `hin-IND`, region/quality preference), the resolver in all four device states, the hint rule, next-stop phrases in every locale × mode. **3b**: phrase shape and the 6–9 word budget in every locale, time-of-day wording, `t()` read at call time (a language switch changes the **next** announcement), the privacy deny-list, throttle latest-wins + summary |
| `next-stop-announcer.spec.ts` (21)  | **3C**: one announcement per fact per stop (a whole run replayed push by push), the approaching thresholds, an already-close stop announced once, no announcement for an in-flight count or a nameless stop, trip scoping, the capped/floored count, and that every event it can emit is speakable                                                                                                                                                                                                                                                  |
| `crew-haptics.spec.ts` (12)         | the event → pattern table, 40 boards ⇒ 40 taps, `sos.fired` (success) distinct from `sos.queued` (warning), missing native API is not a crash, **3C**: a next-stop announcement is an unthrottled light tap                                                                                                                                                                                                                                                                                                                                         |
| `crew-feedback.spec.ts` (29)        | role defaults, the full role × (voice, vibration) × on/off matrix with **zero** native calls when off, persistence and cold start, non-blocking, a throwing driver never changes a result, **3C**: the same dispatcher upgrades to the native voice once measured, next-stop events obey the Voice switch and the one-item slot, and the native seam grew no probe                                                                                                                                                                                  |
| `crew-feedback-wiring.spec.ts` (20) | only the native wrapper imports `expo-speech`/`expo-haptics`, no `await` on the speech path, every surface reports, no surface touches patterns or phrases, zero-touch boundaries hold, **3C**: only the wrapper calls `getAvailableVoicesAsync`, the probe is memoised, a failed probe is not cached as an answer, one announcer for both roles with no role branch                                                                                                                                                                                |
| `crew-feedback.sim.spec.ts` (17)    | the **real** native wrapper against mocked `expo-speech`/`expo-haptics`: exact spoken strings, `stop`-before-`speak`, settings gating, a no-TTS-engine device, **3C**: one probe for two callers, Devanagari + `hi-IN` + the exact voice identifier reaching `Speech.speak`, Latin + `en-IN` when the locale has no voice, and the `voice` key omitted (not `undefined`) when there is no identifier                                                                                                                                                |
| `trip-progress.spec.ts` (17)        | **T1**: the frontier is scoped to a trip — a completed 6-stop run followed by a 5-stop run opens on the **first** stop (not "no candidates ahead of frontier 6", not the second stop), monotonicity still holds inside one trip, a stale ETA payload is dropped, stops from another route are dropped, the state machine never retreats and keeps its identity when nothing moved, plus a source guard that the trip screen holds no `frontierRef` and mutates nothing during render                                                                |

---

## Reliability & runtime awareness (this branch)

The client-visible half of the reliability/runtime effort: the app stops
_pretending_ where the platform can't deliver, and says what it can't do in
the driver's language. Everything below is client-side presentation +
build-time config; API contracts, the lifecycle controller, the offline queue
and the i18n layer are untouched.

### The app knows which runtime it is

`src/lib/runtime-environment.ts` is a **pure** module that turns the installed
SDK facts into two capability questions, with no native module import (so it
is testable in Node and can never throw the way `expo-constants` does outside
the app):

- **Can this runtime run the background location task?** — No in the Expo Go
  app (the OS background task + Android foreground service do not run there);
  yes in a development build.
- **Is the map engine present?** (`nativeMapAvailable`) — No in the Expo Go app
  **on any platform** (the MapLibre engine is a custom native module the Expo
  Go shell does not carry); yes in a development build. There is no key to
  configure — the tiles are OpenFreeMap's public OpenStreetMap instance.

The detection is honest about its own limits: an unknown/missing SDK version
yields an "unknown" runtime, not a guess, and every consumer treats "unknown"
as "say we don't know", never as "all good".

### Maps: a labelled panel instead of a blank box

`src/features/map/map-surface-mode.ts` decides, per map surface, between
rendering the map and showing a labelled **"the map needs a development
build"** panel. The panel is a first-class screen state (not an error): it
names the runtime, explains that Expo Go cannot load the map engine, and
points at the fix (install a development build — no key or account is
involved; the map is MapLibre over OpenFreeMap's public OpenStreetMap tiles,
see `docs/live-tracking-map.md` → "Map provider policy"). `BusMap.tsx` and
`DriverTripMap.tsx` both route through it, so the parent Track screen and the
driver Trip screen say the same true thing. A development build renders the
map on every platform — the panel is Expo Go only.

### GPS start failures are visible, and the tap fixes them

`gps-strip-action.ts` now decides the strip's single tap from the same facts as
`evaluateGpsPermissions`, so a refused start is never left as a bare "Retry":

- **Stop** while running (the only honest primary tap while fixes are produced,
  whatever the OS says);
- **Open location settings** when the OS location switch is off **or** the
  foreground permission is permanently denied (only the OS settings screen can
  fix either — a retry or an in-app prompt can't);
- **Ask for location permission** when the request was refused but can be asked
  again (the start left the coarse state `undetermined`); a grant there
  completes the start the driver already asked for — explicit intent, never the
  auto-start `GpsPermissionRecovery` is forbidden from doing;
- **Retry** only when the start failed for another reason (e.g. the server
  could not be reached).

The lifecycle's failure message renders as a **second line** on the strip
(danger tone, `accessibilityLiveRegion="polite"`), so `Sharing ❌` is never
left to be guessed. `crewTrackingStatusLine()` layers the stop context on the
status copy for two cases — a server-refused trip names the status that ended
sharing (`lastStopTripStatus`), an exhausted reconnect budget names the school
server via `apiHost()` (`host:port` only, so a token in the query or userinfo
can never reach the screen).

### A diagnostics card for support

The Help screen gains an always-available **"Diagnostics (for support)"** card
(both crew roles, with or without a trip), built by
`src/features/crew/crew-diagnostics.ts` from the lifecycle snapshot: app
runtime, API host, live-tracking socket, connection, location services,
foreground + background permission (with the development-build reason where the
runtime can't run the task), what is sharing, last stop + server status,
recovery attempts + last reason, last error + when, and the delivery counters
(sent = accepted + rejected + throttled). Two invariants are spec-pinned: no
JWT-shaped string or secret in **any** row (a token in the URL query string or
in userinfo), and the counter arithmetic. Server words (reasons, statuses)
render verbatim; the counter words are locale-invariant like the four panel
counters.

### Build-time warnings are aimed, not shouted

`app.config.js` prints its missing-Maps-key / missing-`google-services.json`
warnings **only for native Android builds** (`isNativeAndroidBuild`: the exact
command tokens `prebuild` / `run:android`, minus an explicit iOS target, or a
non-iOS EAS build) and **exactly once** per process (`warnOnce` — a module set
plus an `SBT_APP_CONFIG_*` env marker, so "once" survives the require-cache
clears Expo's reloads cause). `expo start --go` / `expo export` / iOS builds
print nothing — in the Expo Go case the app already says the honest thing at
runtime (the map panel, the gated background toggle), so a build-time warning
would only scare.

### Guard specs (all under `npm --prefix mobile test`)

| Spec                                  | Pins                                                                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime-environment.spec.ts` (13)    | the pure Expo Go / dev-build capability facts, the SDK-version detection, and "unknown" never masquerading as "all good"                                                                 |
| `map-surface-mode.spec.ts` (5)        | which map surfaces show the labelled development-build panel instead of a blank map, and only in the Expo Go + no-key case                                                               |
| `gps-strip-action.spec.ts` (extended) | the strip tap: Share GPS / Stop / Retry **plus** the repair actions — settings for services-off or permanent denial, in-app request for a refused-but-askable prompt, running stays Stop |
| `tracking-status.spec.ts` (extended)  | `crewTrackingStatusLine` names the server status for a refused trip and the `host:port` for a gave-up reconnect, and `apiHost()` drops query/userinfo so a token can't reach the line    |
| `crew-diagnostics.spec.ts` (8)        | the support readout: no JWT-shaped string or secret in any row (token in query or userinfo), counter arithmetic, runtime names, null handling                                            |
| `app-config-warnings.spec.ts` (11)    | build-time warnings: exactly once per missing fact for native Android builds, silent for Expo Go / export / iOS; a set key is injected but never logged                                  |
