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
   *over* the shared tokens, picked for the phone:
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

| Pair | Background | Foreground | Ratio | WCAG floor |
| --- | --- | --- | --- | --- |
| primary action label | `#b45309` (primary-700) | white | **5.02:1** | 4.5:1 |
| success action label | `#15803d` (secondary-700) | white | **5.01:1** | 4.5:1 |
| danger action label | `#dc2626` (status.danger) | white | **4.83:1** | 4.5:1 |
| info action label | `#2563eb` (status.info) | white | **5.17:1** | 4.5:1 |
| secondary button label | white | `#1e293b` | **14.63:1** | 4.5:1 |
| ghost button label | `#f1f5f9` | `#334155` | **9.45:1** | 4.5:1 |
| badge neutral / ghost | `#f1f5f9` | `#334155` | **9.45:1** | 4.5:1 |
| badge info | `#e0f2fe` | `#0369a1` | **5.17:1** | 4.5:1 |
| badge warning | `#fef3c7` | `#b45309` | **4.51:1** | 4.5:1 |
| badge success | `#dcfce7` | `#166534` | **6.49:1** | 4.5:1 |
| badge danger | `#fee2e2` | `#b91c1c` | **5.30:1** | 4.5:1 |
| interactive border (inputs, chips, secondary buttons) | white | `#64748b` (neutral-500) | **4.76:1** | 3:1 |
| placeholder text | white | `#64748b` (neutral-500) | **4.76:1** | 3:1 |
| active chip / active tab tint | white | `#b45309` (primary-700) | **5.02:1** | 4.5:1 |
| toast success | `#15803d` | white | **5.01:1** | 4.5:1 |
| toast danger | `#dc2626` | white | **4.83:1** | 4.5:1 |
| muted text on screen background | `#f8fafc` | `#475569` | **7.24:1** | 4.5:1 |

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
- Where a visual element must stay small (banner ✕, search clear), its *hit
  area* was raised to ≥44px with `hitSlop`, keeping the visible icon compact.

## Deliberately NOT done (and why) — Phase 1 list, annotated where Phase 2 picked it up

- **Shared `design-tokens` values unchanged** — the web console depends on
  them; mobile-specific choices live only in `mobile/src/theme/`. *(Still
  true in Phase 2: the status-card colours alias existing token values.)*
- **Telemetry moved, not deleted** — the GPS diagnostics counters
  (rejected/dropped/invalid) stay exactly where they are in Phase 1; moving
  them to a Help/Support surface is Phase 2 scope. *(→ Done in Phase 2 —
  they now live on the Help/Support screen; see below.)*
- **No screen restructuring** — the giant one-state-per-screen crew trip card,
  hold-to-confirm SOS with haptics/voice, and the full-row tap board/drop are
  Phase 2/3. *(The trip card, hold-to-confirm SOS and full-row board/drop are
  now Phase 2; haptics/voice remain Phase 3.)*
- **No new dependencies** — `Animated` is built in; `expo-haptics` /
  `expo-speech` arrive with Phase 3, keeping every merge small and reviewable.
  *(Still true: Phase 2 added zero dependencies.)*
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
   colour *is* the state (mapping below); the state word at 28px bold with its
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
(type/message/location — the *after-the-fact* path; the default path needs zero
reading), recent alerts, cancel flow.

**Help & Support (`app/(crew)/help.tsx`, hidden tab — `href: null`, reached
from the trip screen)** — **the GPS telemetry moved here, nothing was
deleted**: the full `GpsSharePanel` with all four counters ("Sent",
"Rejected", "Dropped (offline)", "Invalid fix"), last fix + server reason, the
background-sharing switch, and the permission-recovery UI. Framed as what it
is: numbers the crew reads *with the support team*, not while driving. A
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

| Trip state | Card background | Word | Icon | White-word contrast |
| --- | --- | --- | --- | --- |
| `BOARDING` | `#15803d` (secondary-700) | BOARDING | people | **5.02:1** |
| `IN_PROGRESS` | `#b45309` (primary-700) | ON THE ROAD | navigate | **5.02:1** |
| `COMPLETED` | `#475569` (neutral-600) | COMPLETED | checkmark-done | **7.58:1** |
| `CANCELLED` | `#475569` (neutral-600) | CANCELLED | close-circle | **7.58:1** |
| `SCHEDULED` | `#475569` (neutral-600) | SCHEDULED | time | **7.58:1** |

- All values are **aliases of existing shared tokens** — `design-tokens` is
  untouched (Phase-1 rule).
- "Distinguishable from a metre away" is asserted as a **pairwise RGB
  distance ≥ 60** between the three distinct state colours — a plain, honest
  proxy, spelled out in the spec.
- **Colour is never the only cue**: every state also differs in its word
  *and* its icon (`crew-copy.ts` pins distinct words), so colour-vision
  deficiency changes nothing.
- The primary action's colour always hints the *next* state (grey card →
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
- Screen readers skip the hold: the accessibility *activate* action fires
  immediately (holding is a motor pattern, not an a11y one).
- The type/message sheet is optional and its confirm button is *also* a hold
  button — every path to the server goes through hold-to-confirm.

### Crew copy is i18n-ready (Phase 3 plug point)

Every Phase-2 string lives in `features/crew/crew-copy.ts` (flat, key-stable,
pure formatters for interpolated ones) — Phase 3's Hindi/voice layer replaces
this one module; Phase 2 ships English-only copy through it. Guarded by
`crew-copy.spec.ts` (non-empty, distinct uppercase status words).

### Guard specs added in Phase 2 (all under `npm --prefix mobile test`)

| Spec | Pins |
| --- | --- |
| `trip-status-style.spec.ts` | status→colour mapping, white-word ≥4.5:1 on every state, RGB-distance ≥60 between state colours, distinct word+icon per state, exactly one primary action per state |
| `hold-to-confirm.spec.ts` | 900 ms inside the 600–1200 ms window, single-fire + lock, early-release cancel, progress curve |
| `sos-flow.spec.ts` | same idempotency key across retries/double-press, key rotation only on server confirmation, queued-on-offline semantics |
| `manifest-row.spec.ts` | row ≥60px, glyph ≥60px, name 18px, ✓/✕ mapping, "Name ✓ time" confirmation from server timestamps, a11y labels + announcements, flash colour contrast |
| `help-routing.spec.ts` | telemetry counters **gone** from `trip.tsx`, **present** on `help.tsx`, help registered as a hidden tab, SOS fires only through hold-to-confirm |
| `crew-copy.spec.ts` | copy non-empty, status words distinct + uppercase |

The Phase-1 guards still pass unchanged: **0 text below 16px on crew
surfaces** (the new screens included) and every contrast pair — the three new
status-card pairs are rows in `theme/contrast.ts` → `contrast.spec.ts` → the
table above.
