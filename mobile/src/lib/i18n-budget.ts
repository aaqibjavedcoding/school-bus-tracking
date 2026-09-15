import type { TranslationKey } from './i18n.ts';

/**
 * Per-key length budgets — the machine-checked half of "a longer translation
 * must not be cut off".
 *
 * **Why a character budget and not a pixel measurement.** This environment
 * cannot run a device or take a screenshot, and a `measureInWindow()`
 * assertion would only ever execute on a phone in someone's hand — i.e. never
 * in CI. A character budget is the honest, checkable proxy: derived from the
 * container a key renders in (font size × available width), it fails the build
 * when a translation grows past what that container was designed against.
 *
 * It errs **strict**, which is the safe direction. A JS `.length` counts every
 * Devanagari code unit including combining matras — `'बाकी'.length === 4` for
 * what a reader sees as three glyphs — so the budget under-allows relative to
 * real rendered width rather than over-allowing it.
 *
 * ### Measured growth in this dictionary (not the folklore)
 *
 * The usual "Hindi runs 20–30% longer" heuristic is **not** what the numbers
 * say here: summed over all keys, Hindi chrome is ~5% *shorter* than English
 * by code-unit count, because matras compress and Hindi compounds. What is
 * real is **per-key** growth — up to **2.25×** on a short label
 * (`stops.arrivals` 8 → 18) — and that is precisely what clips. So the
 * per-key budget below is the load-bearing guard, and `growthCeiling` is a
 * backstop with an absolute-slack term for short strings, where a percentage
 * is meaningless.
 *
 * ### Derivation
 *
 * Assuming a 360 dp-wide low-end Android, `spacing.md` (16 dp) screen padding
 * and the Phase-1 type scale:
 *
 * | kind | where | text width | px | budget |
 * | --- | --- | --- | --- | --- |
 * | `tab` | bottom tab bar, 4 across, icon above the label | ~90 dp | 13 | 12 |
 * | `chip` | filter-chip label (a ` · N` count is appended) | ~107 dp | 16 | 11 |
 * | `badge` | summary/signal badge, row wraps — capped at 2 lines | ~160 dp | 16 | 16 |
 * | `statusWord` | the 28px word on the status card | ~296 dp | 28 | 16 |
 * | `buttonRow` | two `flex:1` buttons side by side, may wrap to 2 lines | ~98 dp | 16 | 18 |
 * | `buttonWide` | a two-button row with longer wording, wraps freely | ~140 dp | 16 | 22 |
 * | `bannerButton` | offline-banner actions, `flexWrap` row | ~300 dp | 16 | 16 |
 * | `buttonFull` | full-width 64px field button with an icon | ~256 dp | 20 | 22 |
 * | `label` | `KeyValue` label — full-width row above its value | ~296 dp | 16 | 20 |
 *
 * Anything not listed is covered by `growthCeiling` alone.
 */

export type BudgetKind =
  | 'tab'
  | 'chip'
  | 'badge'
  | 'statusWord'
  | 'buttonRow'
  | 'buttonWide'
  | 'bannerButton'
  | 'buttonFull'
  | 'label';

const BUDGET_BY_KIND: Record<BudgetKind, number> = {
  tab: 12,
  chip: 11,
  badge: 16,
  statusWord: 16,
  buttonRow: 18,
  buttonWide: 22,
  bannerButton: 16,
  buttonFull: 22,
  label: 20,
};

/**
 * Long-string growth allowance. Generous on purpose — the per-key budgets are
 * what protect the tight containers; this catches a translation that simply
 * balloons.
 */
export const GROWTH_LIMIT = 1.5;

/**
 * Absolute headroom for short strings, where a ratio is meaningless: English
 * `Retry` (5) becomes `फिर कोशिश करें` (14), which is 2.8× but perfectly fine
 * on a wrapping banner button. The ceiling is `max(ratio, en + slack)`.
 */
export const GROWTH_ABSOLUTE_SLACK = 12;

/**
 * The constrained keys — every string that renders in a fixed-width,
 * single-line or wrap-sensitive container on a crew surface. Adding a
 * chip/badge/tab/button label to a crew screen means adding its key here;
 * `i18n-clipping.spec.ts` fails otherwise only if the new string is too long,
 * so this list is what keeps the guard honest rather than lucky.
 */
export const CONSTRAINED_KEYS: Readonly<Record<string, BudgetKind>> = {
  // Bottom tab bar (4 across, 13px).
  'nav.tab.drive': 'tab',
  'nav.tab.trip': 'tab',
  'nav.tab.manifest': 'tab',
  'nav.tab.students': 'tab',
  'nav.tab.stops': 'tab',
  'nav.tab.sos': 'tab',

  // 28px state word on the giant status card.
  'status.scheduled': 'statusWord',
  'status.boarding': 'statusWord',
  'status.inProgress': 'statusWord',
  'status.completed': 'statusWord',
  'status.cancelled': 'statusWord',

  // Manifest filter chips — `numberOfLines={1}`, a " · N" count is appended.
  'manifest.filter.all': 'chip',
  'manifest.filter.waiting': 'chip',
  'manifest.filter.boarded': 'chip',
  'manifest.filter.dropped': 'chip',

  // Manifest summary badges.
  'manifest.summary.total': 'badge',
  'manifest.summary.pending': 'badge',
  'manifest.summary.boarded': 'badge',
  'manifest.summary.dropped': 'badge',

  // GPS signal / network / permission chips.
  'gps.tierGood': 'badge',
  'gps.tierWeak': 'badge',
  'gps.tierStale': 'badge',
  'gps.network': 'badge',
  'gps.location': 'badge',
  'gps.badgeSharing': 'badge',
  'gps.badgeOff': 'badge',

  // Two `flex:1` buttons sharing a row.
  'trip.link.manifestDriver': 'buttonRow',
  'trip.link.manifestConductor': 'buttonRow',
  'trip.link.stops': 'buttonRow',
  'offline.syncNow': 'bannerButton',
  'offline.retry': 'bannerButton',
  'offline.dismiss': 'bannerButton',

  // A two-button row with longer wording (cancel flow) — wraps freely.
  'trip.cancel.confirm': 'buttonWide',
  'trip.cancel.keep': 'buttonWide',

  // Full-width 64px field buttons.
  'trip.action.boarding': 'buttonFull',
  'trip.action.inProgress': 'buttonFull',
  'trip.action.completed': 'buttonFull',
  'gps.share': 'buttonFull',
  'gps.stopSharing': 'buttonFull',
  'sos.holdLabel': 'buttonFull',

  // `KeyValue` label — a full-width row above its value.
  'trip.detail.route': 'label',
  'trip.detail.scheduled': 'label',
  'trip.detail.date': 'label',
  'trip.detail.bus': 'label',
  'trip.detail.role': 'label',
  'trip.detail.connection': 'label',
};

/** The budget for one key, or `null` when only the growth rule applies. */
export function budgetFor(key: TranslationKey): { kind: BudgetKind; maxChars: number } | null {
  const kind = CONSTRAINED_KEYS[key];
  if (!kind) return null;
  return { kind, maxChars: BUDGET_BY_KIND[kind] };
}

/**
 * The growth ceiling for a key, from its English chrome length: the greater of
 * the ratio allowance and an absolute slack, so short labels are judged on
 * absolute characters and long prose on proportion.
 */
export function growthCeiling(englishChromeLength: number): number {
  return Math.max(
    Math.ceil(englishChromeLength * GROWTH_LIMIT),
    englishChromeLength + GROWTH_ABSOLUTE_SLACK,
  );
}
