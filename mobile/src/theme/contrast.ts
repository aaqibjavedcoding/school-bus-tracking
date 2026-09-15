import { colors } from '@school-bus-tracking/design-tokens';

/**
 * WCAG 2.x contrast math, pure and dependency-free so the ratios the UI
 * relies on are pinned by `contrast.spec.ts` under plain `node --test`.
 *
 * Why this exists: the app's earlier primary button rendered white text on
 * `primary[500]` — a 2.15:1 ratio that fails every WCAG threshold. Rather
 * than fixing that one pair by eye, every text/background and
 * control/surface pair the mobile UI ships is asserted here, so a future
 * palette tweak that drops a pair below AA fails the test suite loudly.
 */

/** Relative luminance of an `#rrggbb` colour (0..1), per WCAG 2.x. */
export function relativeLuminance(hex: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    throw new Error(`relativeLuminance expects a #rrggbb colour, got "${hex}"`);
  }
  const channels = [0, 1, 2].map((index) => {
    const raw = parseInt(match[1]!.slice(index * 2, index * 2 + 2), 16) / 255;
    return raw <= 0.04045 ? raw / 12.92 : Math.pow((raw + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** Contrast ratio between two `#rrggbb` colours (1..21). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA normal text, AA large/bold text, and non-text UI component floors. */
export const AA_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;
export const AA_UI_COMPONENT = 3;

export interface ContrastPair {
  /** What ships in the UI, e.g. "primary button label". */
  name: string;
  foreground: string;
  background: string;
  /** Minimum ratio this pair must keep. */
  minimum: number;
}

export const WHITE = '#ffffff';

/**
 * The pairs the mobile UI depends on. `contrast.spec.ts` asserts every row;
 * this list doubles as the contrast table quoted in `docs/mobile-ux.md` and
 * in PR descriptions — one source of truth, machine-checked.
 */
export const CONTRAST_PAIRS: ContrastPair[] = [
  // Filled action buttons (label on solid surface).
  {
    name: 'primary action label',
    foreground: WHITE,
    background: colors.primary[700],
    minimum: AA_TEXT,
  },
  {
    name: 'success action label',
    foreground: WHITE,
    background: colors.secondary[700],
    minimum: AA_TEXT,
  },
  {
    name: 'danger action label',
    foreground: WHITE,
    background: colors.status.danger,
    minimum: AA_TEXT,
  },
  {
    name: 'info action label',
    foreground: WHITE,
    background: colors.status.info,
    minimum: AA_TEXT,
  },
  // Outlined / subtle buttons.
  {
    name: 'secondary button label',
    foreground: colors.neutral[800],
    background: WHITE,
    minimum: AA_TEXT,
  },
  {
    name: 'ghost button label',
    foreground: colors.neutral[700],
    background: colors.neutral[100],
    minimum: AA_TEXT,
  },
  // Badge tones (text on tinted background).
  {
    name: 'badge neutral',
    foreground: colors.neutral[700],
    background: colors.neutral[100],
    minimum: AA_TEXT,
  },
  { name: 'badge info', foreground: '#0369a1', background: '#e0f2fe', minimum: AA_TEXT },
  { name: 'badge warning', foreground: '#b45309', background: '#fef3c7', minimum: AA_TEXT },
  {
    name: 'badge success',
    foreground: colors.secondary[800],
    background: '#dcfce7',
    minimum: AA_TEXT,
  },
  { name: 'badge danger', foreground: '#b91c1c', background: '#fee2e2', minimum: AA_TEXT },
  // Controls against a page background.
  {
    name: 'interactive border on white',
    foreground: colors.neutral[500],
    background: WHITE,
    minimum: AA_UI_COMPONENT,
  },
  {
    name: 'placeholder text',
    foreground: colors.neutral[500],
    background: WHITE,
    minimum: AA_UI_COMPONENT,
  },
  {
    name: 'active chip label',
    foreground: WHITE,
    background: colors.primary[700],
    minimum: AA_TEXT,
  },
  { name: 'active tab tint', foreground: colors.primary[700], background: WHITE, minimum: AA_TEXT },
  { name: 'toast success', foreground: WHITE, background: colors.secondary[700], minimum: AA_TEXT },
  { name: 'toast danger', foreground: WHITE, background: colors.status.danger, minimum: AA_TEXT },
  {
    name: 'muted text on screen',
    foreground: colors.neutral[600],
    background: colors.neutral[50],
    minimum: AA_TEXT,
  },
];

/**
 * The regression this layer prevents, kept as a documented anti-example:
 * white on the old `primary[500]` button surface.
 */
export const OLD_PRIMARY_BUTTON_RATIO = () => contrastRatio(WHITE, colors.primary[500]);
