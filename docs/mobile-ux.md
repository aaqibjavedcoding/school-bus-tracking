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
   - `text.body` 16 (floor for anything that carries information), `text.secondary` 14
     (short labels only), `text.title` 20, `text.numeric` 24, `text.statusWord` 28.
   - `touch.compact` 44 (dense admin rows only), `touch.target` 56 (every
     button's default), `touch.field` 64 (crew field actions: start trip,
     board, SOS, share GPS).
   - `surface.actionPrimary` = `primary[700]`, `actionSuccess` = `secondary[700]`,
     `actionDanger` = `status.danger`, `actionInfo` = `status.info`,
     `borderInteractive` / `placeholder` = `neutral[500]` — every filled action
     surface reaches WCAG AA with its label (measured table below).
3. **Machine-checked guards** (run in `npm --prefix mobile test`):
   - `theme/contrast.spec.ts` pins every text/background pair below and the
     regression marker for the old primary button.
   - `theme/legibility.spec.ts` scans the source tree: **0 text under 16px on
     crew surfaces** (`app/(crew)`, `src/features/crew`,
     `src/features/tracking`) and a 14px floor app-wide.

## Measured contrast (computed by `contrast.spec.ts`, not by eye)

| Pair                                                  | Background                | Foreground              | Ratio       | WCAG floor |
| ----------------------------------------------------- | ------------------------- | ----------------------- | ----------- | ---------- |
| primary action label                                  | `#b45309` (primary-700)   | white                   | **5.02:1**  | 4.5:1      |
| success action label                                  | `#15803d` (secondary-700) | white                   | **5.01:1**  | 4.5:1      |
| danger action label                                   | `#dc2626` (status.danger) | white                   | **4.83:1**  | 4.5:1      |
| info action label                                     | `#2563eb` (status.info)   | white                   | **5.17:1**  | 4.5:1      |
| secondary button label                                | white                     | `#1e293b`               | **14.63:1** | 4.5:1      |
| ghost button label                                    | `#f1f5f9`                 | `#334155`               | **9.45:1**  | 4.5:1      |
| badge neutral / ghost                                 | `#f1f5f9`                 | `#334155`               | **9.45:1**  | 4.5:1      |
| badge info                                            | `#e0f2fe`                 | `#0369a1`               | **5.17:1**  | 4.5:1      |
| badge warning                                         | `#fef3c7`                 | `#b45309`               | **4.51:1**  | 4.5:1      |
| badge success                                         | `#dcfce7`                 | `#166534`               | **6.49:1**  | 4.5:1      |
| badge danger                                          | `#fee2e2`                 | `#b91c1c`               | **5.30:1**  | 4.5:1      |
| interactive border (inputs, chips, secondary buttons) | white                     | `#64748b` (neutral-500) | **4.76:1**  | 3:1        |
| placeholder text                                      | white                     | `#64748b` (neutral-500) | **4.76:1**  | 3:1        |
| active chip / active tab tint                         | white                     | `#b45309` (primary-700) | **5.02:1**  | 4.5:1      |
| toast success                                         | `#15803d`                 | white                   | **5.01:1**  | 4.5:1      |
| toast danger                                          | `#dc2626`                 | white                   | **4.83:1**  | 4.5:1      |
| muted text on screen background                       | `#f8fafc`                 | `#475569`               | **7.24:1**  | 4.5:1      |

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
  `primary[700]` / `neutral[500]` (both AA).
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
- The brand-amber buttons are now dark amber with readable white text
  (2.15:1 → 5.02:1); green means "good to go" everywhere.
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
   driving-time story: `Sharing ✅ / ❌` + last-update time + one **Retry**
   (or Stop) tap + a "GPS details & support" link.
4. Driver navigation card (button is now `secondary` — the lifecycle action
   stays the only filled primary on the screen).
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
background-sharing switch, and the permission-recovery UI. Framed as what it
is: numbers the crew reads _with the support team_, not while driving. A
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
| `BOARDING`    | `#15803d` (secondary-700) | BOARDING    | people         | **5.02:1**          |
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

`mobile/src/lib/i18n.en.ts` is the **source of truth**: **286 keys**, flat and
dotted (`manifest.confirmBoard`, `gps.tierGood`, `error.HTTP_409`).
`mobile/src/lib/i18n.hi.ts` is typed as `Dictionary` — the same key set with
widened values — so a missing or extra Hindi key is a **compile** error before
it is ever a runtime one.

| Group                                                | Keys    | Covers                                                                   |
| ---------------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| `nav.*`, `role.*`                                    | 20      | tab labels, screen titles, role words                                    |
| `status.*`, `attendance.label.*`, `boarding.label.*` | 16      | trip/attendance vocabulary, incl. the 28px card words                    |
| `trip.*`                                             | 39      | trip screen, "More details", lifecycle actions, cancel flow              |
| `manifest.*`                                         | 42      | board/drop, filters, summary badges, search, a11y labels + announcements |
| `sos.*`                                              | 39      | hold-to-confirm, status line, details sheet, cancel flow                 |
| `gps.*` (incl. `gps.recovery.*`)                     | 44      | sharing strip + panel, permission recovery                               |
| `offline.*`                                          | 15      | sync banner (with `.one`/`.other` plural pairs)                          |
| `stops.*`, `eta.*`, `navigate.*`, `connection.*`     | 21      | stops screen, ETA views, navigation hand-off, live chip                  |
| `help.*`, `settings.*`                               | 13      | Help screen + the language switch                                        |
| `login.*`                                            | 13      | sign-in labels (the flow/endpoint is untouched)                          |
| `common.*`, `time.*`                                 | 10      | shared chrome, relative time, minutes                                    |
| `error.*`                                            | 14      | known server error codes + the unknown-code prefix                       |
| **total**                                            | **286** | the groups above are exhaustive — every key is in exactly one            |

### Resolution order

Implemented once, in `resolveInitialLocale` (`src/lib/i18n.ts`), and pinned by
`i18n.spec.ts`:

1. **saved preference** (AsyncStorage key `sbt.mobile.locale`) — an explicit
   choice always wins;
2. **role default** — `DRIVER`/`CONDUCTOR` → **`hi`**; everyone else → the
   device locale;
3. **`en`** — an unsupported or absent device locale falls back to the source
   of truth rather than to a guess.

The deliberate consequence: **a crew member on an English-locale phone still
opens in Hindi**, because "crew default = Hindi" is the product rule and the
switch on the Help screen is the escape hatch. Admins and parents follow the
device, since their screens are also used from the English web console.

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
   the offline queue's `lastError`, and the **four support counters** on the
   Help screen ("Sent", "Rejected", "Dropped (offline)", "Invalid fix") — those
   last are pinned verbatim by `help-routing.spec.ts` because they are read
   aloud _to the support engineer_, who works in English, and the screen says
   so.

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
what this dictionary says: summed over all 286 keys, Hindi chrome is ~5%
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

| Spec                        | Pins                                                                                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `i18n.spec.ts` (21)         | resolution order (saved → role/device → `en`), crew-default-Hindi, tag normalisation, interpolation (an unknown placeholder stays visible, never `undefined`), subscribe/notify, persist-on-choice vs no-persist-on-default, a failing store is non-fatal, `pluralKey`, the whole server-string boundary table |
| `i18n-parity.spec.ts` (9)   | **0 missing / 0 extra** keys, no empty values, identical placeholder names _and_ counts, complete `.one`/`.other` pairs, every `hi === en` key declared in `LOCALE_INVARIANT_KEYS`, distinct status words in both locales, ✓/✕/⏳ glyphs survive translation                                                   |
| `i18n-clipping.spec.ts` (6) | all 46 budgeted keys fit in **both** locales, no key grows past `growthCeiling`, the per-key growth envelope, the single-line filter chip is fed only budgeted keys, the tab bar stays four labelled actions                                                                                                   |
| `i18n-literals.spec.ts` (5) | **0** hardcoded English UI literals on crew screens _and_ crew components, every copy-rendering screen subscribes to the locale, the scan is not empty                                                                                                                                                         |

The Phase-1 and Phase-2 guards still pass **unchanged**: `contrast.spec.ts`,
`legibility.spec.ts` (Hindi included — 0 text under 16px on crew surfaces),
`help-routing.spec.ts`, `crew-copy.spec.ts`, `trip-status-style.spec.ts`,
`manifest-row.spec.ts`, `hold-to-confirm.spec.ts`, `sos-flow.spec.ts`.
`crew-copy.ts` kept its exact shape, so Phase 2's call sites and its spec needed
no edits.
