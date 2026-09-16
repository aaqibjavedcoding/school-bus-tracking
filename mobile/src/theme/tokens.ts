import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';

export const theme = {
  colors,
  spacing,
  borderRadius,
  typography,
};

export type Theme = typeof theme;

/**
 * Mobile-only legibility layer — semantic aliases ON TOP of the shared
 * `@school-bus-tracking/design-tokens` package.
 *
 * The shared package is also consumed by the web console, whose density must
 * not change, so nothing below edits the token scales; every value is a
 * *view* over those tokens chosen for the phone form factor:
 *
 * - **Standard density** (owner decision, 2026-09): the app reads like a
 *   normal consumer app (Instagram-class type scale) — body 14px, labels
 *   13px, titles 16px, the trip-carrying numbers 20px bold, the state word
 *   20px extra-bold. Legibility still holds through weight, spacing and
 *   contrast, not through oversized type. This scale is the **only** type
 *   scale in the app: the login screen reads standard-sized too, not a step
 *   larger than the rest of the product;
 * - gloved/rough taps need ≥56px targets, and the crew's primary field
 *   actions get 64px;
 * - every filled action surface is chosen to reach WCAG AA (≥4.5:1) with its
 *   label — see `contrast.ts` / `contrast.spec.ts`, which pin the ratios.
 */

/** Type scale for app screens. `secondary` (13) is the floor and only for
 *  short labels/hints — never for primary content. */
export const text = {
  /** Default reading size. Nothing below this carries information. */
  body: typography.fontSizes.sm, // 14
  /** Short labels / hints. */
  secondary: 13,
  /** Card/screen titles. */
  title: typography.fontSizes.base, // 16
  /** Numbers that carry the trip: counts, minutes, stop sequence. */
  numeric: typography.fontSizes.xl, // 20
  /** The one big state word on a crew status card (BOARDING). */
  statusWord: 20,
} as const;

/** Touch-target floors (React Native dp). */
export const touch = {
  /** Dense admin rows only — never used on crew screens. */
  compact: 44,
  /** Default pressable height. */
  target: 56,
  /** Crew field actions (start trip, board, SOS, share GPS). */
  field: 64,
} as const;

/**
 * Type scale for the **login screen only**.
 *
 * The login screen is not a special typographic surface any more — it reads
 * the **standard** in-app scale {@link text} above, so every role's mobile
 * experience (driver, conductor, parent, school admin) has one consistent
 * density. The values below are aliases onto the standard scale, kept as a
 * named table so the login screen and its spec pin the mapping in one place:
 *
 * - the card title and the input value are the standard `title`/`base` step
 *   (16 dp), not the oversized 24/18 dp of the pitched-up draft;
 * - the PIN digit is the standard `xl` step (20 dp), matching the
 *   trip-carrying numerals on the crew home screen — not the local 28 dp
 *   addition the shared scale has no step for;
 * - labels and secondary copy use the standard `secondary` step (13 dp).
 */
export const loginText = {
  /** Card title ("Sign in", "Enter your 4-digit PIN"). */
  cardTitle: text.title, // 16
  /** Field labels and tab labels. */
  label: text.secondary, // 13
  /** What the driver typed into a field. */
  inputValue: text.title, // 16
  /** One key on the PIN pad. */
  pinDigit: text.numeric, // 20
  /** Secondary copy: the card subtitle, a hint, the footer. */
  secondary: text.secondary, // 13
  /** The lockout countdown — the one number worth shouting. */
  countdown: typography.fontSizes['2xl'], // 24
} as const;

/**
 * Touch-target floors for the login screen.
 *
 * The login screen uses the shared in-app touch scale (`touch.target` = 56 dp
 * for tappable rows, the PIN pad keys are square and full-width). The values
 * below are aliases so the login screen and its spec keep naming the shared
 * floors instead of a login-only set.
 */
export const loginTouch = {
  /** Minimum height of a tappable row on the login screen. */
  min: touch.target,
  /** Language dropdown chip. */
  chip: touch.target,
  /** One row of the language menu. */
  menuRow: touch.target,
} as const;

/** Filled-action and border colours that pass WCAG AA against their content. */
export const surface = {
  /**
   * Solid primary button: **green** (white on secondary-700 = 5.01:1).
   * Product decision (owner, 2026-09): the action colour is green, not the
   * school-bus amber — the amber read as "dark orange" on the trip/map
   * screens. Amber (primary) stays the brand accent (badges, the
   * IN_PROGRESS state word, the brand mark); every primary/filled action
   * surface is green.
   */
  actionPrimary: colors.secondary[700],
  /** Solid success button (\"board\"-style confirmations): white on secondary-700 = 5.01:1. */
  actionSuccess: colors.secondary[700],
  /** Solid danger button: white on status.danger = 4.83:1. */
  actionDanger: colors.status.danger,
  /** Solid info button: white on status.info = 5.17:1. */
  actionInfo: colors.status.info,
  /**
   * Border for anything interactive (inputs, secondary buttons, chips):
   * neutral-500 on white = 4.76:1; decorative card borders may stay lighter.
   */
  borderInteractive: colors.neutral[500],
  /** Placeholder text: neutral-500 on white = 4.76:1 (neutral-400 was 2.56:1). */
  placeholder: colors.neutral[500],
} as const;

/** Icon sizes paired with the touch scale (handed to `@expo/vector-icons`). */
export const icon = {
  inline: 18,
  button: 22,
  field: 26,
} as const;

/**
 * Dynamic-type guard rails: system font scaling stays ON (accessibility),
 * but capped so an extra-large system font cannot blow up a screen's layout.
 * Spread onto every `Text`/`TextInput` that carries fixed chrome (buttons,
 * badges, tab-like rows). Body text outside those caps stays uncapped.
 */
export const fontScaleCaps = {
  /** Chips, badges, button labels. */
  label: { allowFontScaling: true as const, maxFontSizeMultiplier: 1.3 },
  /** Buttons keep their padding intact up to 1.5×. */
  button: { allowFontScaling: true as const, maxFontSizeMultiplier: 1.5 },
} as const;
