import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { surface, touch } from '../theme/tokens.ts';

/**
 * The one set of metrics every dropdown / option list in the mobile app is
 * built from.
 *
 * Before this module existed each picker styled its own rows, and the shared
 * `Select` ended up with `paddingVertical: spacing.xs + 2` and **no separator
 * at all** — a list of drivers or conductors rendered as a plain wall of text
 * ("aaqib / junaid / raja / danish") with nothing telling the eye where one
 * option stops and the next starts.
 *
 * The rules below are the fix, stated once so every surface agrees:
 *
 * - **every row is separated** by a hairline rule (`dividerColor`, drawn at
 *   `StyleSheet.hairlineWidth` and inset to the label so it never spans the
 *   full card) — subtle by construction: a 1px neutral-200 line cannot read
 *   as heavy;
 * - **every row is comfortable to hit** — `rowMinHeight` is the shared 40dp
 *   pressable floor (`touch.target`), with `rowPaddingVertical` of breathing
 *   room on top of it, so a row grows with a two-line label instead of
 *   clipping it;
 * - **left/right spacing is one number** (`rowPaddingHorizontal`) shared by
 *   the label, the trailing tick and the divider inset, so nothing lines up
 *   by accident;
 * - **the selected row is unmistakable** three ways at once — tint, weight +
 *   colour, and a trailing tick — because colour alone is not an accessible
 *   cue;
 * - **type stays at the standard body step** (`typography.fontSizes.sm` = 14),
 *   which is also the floor `theme/legibility.spec.ts` enforces app-wide.
 *
 * Deliberately dependency-free (no `react-native` import) so the values can be
 * pinned by `option-list.spec.ts` under plain `node --test`.
 */
export const optionList = {
  /** Row floor: the shared 40dp pressable target. */
  rowMinHeight: touch.target,
  /** Vertical room inside a row, on top of the floor above. */
  rowPaddingVertical: spacing.sm,
  /**
   * The single left/right inset for the whole list: label, trailing tick and
   * divider all start and stop here.
   */
  rowPaddingHorizontal: spacing.sm,
  /** Gap between the label and the trailing tick. */
  rowGap: spacing.sm,
  /** Corner radius of the row's selected/pressed tint. */
  rowRadius: borderRadius.md,
  /** Option label size — the standard 14dp body step, never smaller. */
  labelSize: typography.fontSizes.sm,
  /** Option label colour: neutral-700 keeps a calm, even list. */
  labelColor: colors.neutral[700],
  /** Selected label: the shared action green, at 700 weight. */
  labelColorSelected: surface.actionPrimary,
  /** Selected row tint (secondary-50) — visible, never loud. */
  rowBackgroundSelected: colors.secondary[50],
  /** Pressed row tint, so a tap is felt before the sheet closes. */
  rowBackgroundPressed: colors.neutral[100],
  /**
   * Separator colour. The *width* is `StyleSheet.hairlineWidth` at the call
   * site — the one value that has to come from the platform.
   */
  dividerColor: colors.neutral[200],
  /** The divider starts at the label, not at the card edge. */
  dividerInset: spacing.sm,
  /** Trailing tick on the selected row. */
  tickColor: surface.actionPrimary,
  tickSize: 18,
} as const;
