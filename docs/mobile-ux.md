# Mobile UX — legibility system

How the Expo app presents itself to its least-technical users first: drivers and
conductors who read the screen at arm's length, in daylight, sometimes through
gloves. This document is the map of the system introduced by the mobile
legibility pass (Phase 1): the tokens, the measured contrast, and — just as
importantly — what was deliberately **not** changed.

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

## Deliberately NOT done (and why)

- **Shared `design-tokens` values unchanged** — the web console depends on
  them; mobile-specific choices live only in `mobile/src/theme/`.
- **Telemetry moved, not deleted** — the GPS diagnostics counters
  (rejected/dropped/invalid) stay exactly where they are in Phase 1; moving
  them to a Help/Support surface is Phase 2 scope. Phase 1 only makes the
  panel legible.
- **No screen restructuring** — the giant one-state-per-screen crew trip card,
  hold-to-confirm SOS with haptics/voice, and the full-row tap board/drop are
  Phase 2/3. This pass is legibility + contrast + touch only.
- **No new dependencies** — `Animated` is built in; `expo-haptics` /
  `expo-speech` arrive with Phase 3, keeping every merge small and reviewable.
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
