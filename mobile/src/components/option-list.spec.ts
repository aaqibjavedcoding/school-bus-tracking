import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { colors, spacing, typography } from '@school-bus-tracking/design-tokens';
import { AA_TEXT, AA_UI_COMPONENT, contrastRatio } from '../theme/contrast.ts';
import { surface, touch } from '../theme/tokens.ts';
import { optionList } from './option-list.ts';

/**
 * The contract behind "dropdowns must look like a list, not a wall of text".
 *
 * `option-list.ts` is the single source of the row metrics, so this spec does
 * two jobs:
 *
 * 1. **pin the values** to the design intent — a 40dp touch floor, the
 *    standard 14dp label, a hairline separator that is subtle *by contrast
 *    ratio* (not by opinion), and a selected row that still passes WCAG AA on
 *    its own tint;
 * 2. **pin the wiring** — every dropdown surface in the app must read those
 *    numbers from the module instead of restyling its own rows, which is how
 *    the shared `Select` drifted into `paddingVertical: spacing.xs + 2` with
 *    no separator at all in the first place.
 */

const read = (path: string): string => readFileSync(`${process.cwd()}/${path}`, 'utf8');

const FORMS = 'src/components/forms.tsx';
const LANGUAGE = 'src/components/LanguageSwitcher.tsx';
const MODULE = 'src/components/option-list.ts';

describe('option list metrics', () => {
  test('every row is a comfortable target with room to breathe', () => {
    // The shared pressable floor — never a bespoke smaller one.
    assert.equal(optionList.rowMinHeight, touch.target);
    assert.equal(optionList.rowMinHeight, 40);
    assert.ok(optionList.rowPaddingVertical >= spacing.sm, 'vertical padding on top of the floor');
    assert.equal(optionList.rowPaddingHorizontal, spacing.sm);
    assert.equal(optionList.rowGap, spacing.sm);
  });

  test('label, tick and divider share one left/right inset', () => {
    // "Consistent left/right spacing" is only true if it is one number.
    assert.equal(optionList.dividerInset, optionList.rowPaddingHorizontal);
  });

  test('labels stay at the standard body size, never smaller', () => {
    assert.equal(optionList.labelSize, typography.fontSizes.sm);
    assert.equal(optionList.labelSize, 14);
  });

  test('the separator is a hairline by contrast, not a rule', () => {
    assert.equal(optionList.dividerColor, colors.neutral[200]);
    // Subtle is measurable: a decorative separator sits far below the 3:1
    // non-text floor. Anything at or above it has become a heavy divider.
    assert.ok(
      contrastRatio(optionList.dividerColor, '#ffffff') < AA_UI_COMPONENT,
      'the divider must stay decorative against the white picker card',
    );
    assert.ok(
      contrastRatio(optionList.dividerColor, optionList.rowBackgroundSelected) < AA_UI_COMPONENT,
      'and against the selected row tint too',
    );
  });

  test('the selected row is clear and still legible on its own tint', () => {
    assert.equal(optionList.rowBackgroundSelected, colors.secondary[50]);
    assert.equal(optionList.labelColorSelected, surface.actionPrimary);
    assert.equal(optionList.tickColor, surface.actionPrimary);
    assert.ok(
      contrastRatio(optionList.labelColorSelected, optionList.rowBackgroundSelected) >= AA_TEXT,
      'selected label on the selected tint must pass WCAG AA',
    );
    assert.ok(
      contrastRatio(optionList.labelColor, '#ffffff') >= AA_TEXT,
      'unselected label on white must pass WCAG AA',
    );
    // Tint + weight + tick: colour is never the only cue.
    assert.notEqual(optionList.labelColorSelected, optionList.labelColor);
  });
});

describe('every dropdown reads the shared metrics', () => {
  test('the shared Select styles its rows from the module', () => {
    const forms = read(FORMS);
    assert.match(forms, /from '\.\/option-list'/, 'forms.tsx imports the shared module');
    for (const token of [
      'minHeight: optionList.rowMinHeight',
      'paddingVertical: optionList.rowPaddingVertical',
      'paddingHorizontal: optionList.rowPaddingHorizontal',
      'backgroundColor: optionList.dividerColor',
      'backgroundColor: optionList.rowBackgroundSelected',
      'fontSize: optionList.labelSize',
    ]) {
      assert.ok(forms.includes(token), `forms.tsx must style with ${token}`);
    }
    // The hairline width is the one platform value; it must stay a hairline.
    assert.match(forms, /height: StyleSheet\.hairlineWidth/);
    // The unstyled-wall-of-text row is gone for good. Scoped to the
    // `pickerRow` block: `selectControl` and `switchRow` legitimately keep
    // their own `spacing.xs + 2` and must not satisfy a lazy `[\s\S]*?`.
    const pickerRow = /\n {2}pickerRow: \{[^}]*\}/.exec(forms)?.[0] ?? '';
    assert.ok(pickerRow.length > 0, 'the picker stylesheet declares a `pickerRow` style');
    assert.ok(!pickerRow.includes('spacing.xs + 2'), 'the old 6dp row padding must not come back');
    assert.match(pickerRow, /minHeight: optionList\.rowMinHeight/);
  });

  test('the Select draws one separator between rows, never under the last', () => {
    const forms = read(FORMS);
    assert.match(forms, /styles\.pickerDivider/, 'a divider element exists');
    assert.match(
      forms,
      /index < visibleOptions\.length - 1/,
      'the divider is skipped on the final row',
    );
    assert.match(
      forms,
      /accessibilityState=\{\{ selected: active \}\}/,
      'and rows expose selection',
    );
  });

  test('the login language menu uses the same separator and padding', () => {
    const language = read(LANGUAGE);
    assert.match(language, /from '\.\/option-list'/, 'LanguageSwitcher imports the shared module');
    assert.match(language, /backgroundColor: optionList\.dividerColor/);
    assert.match(language, /height: StyleSheet\.hairlineWidth/);
    assert.match(language, /paddingVertical: optionList\.rowPaddingVertical/);
    // Still the login screen's own touch floor (pinned by login-screen.spec.ts).
    assert.match(language, /minHeight: loginTouch\.menuRow/);
  });

  test('the metrics live in one module, not copy-pasted into the surfaces', () => {
    const module = read(MODULE);
    assert.match(module, /export const optionList/, 'the module owns the table');

    // Neither surface may re-declare a row floor or label size of its own.
    // Scoped to the row style block: a lazy `[\s\S]*?` would happily run on to
    // the next style that *does* hardcode a number.
    const rowBlock = (file: string, name: string): string => {
      const block = new RegExp(`\\n {2}${name}: \\{[^}]*\\}`).exec(read(file))?.[0] ?? '';
      assert.ok(block.length > 0, `${file} declares a \`${name}\` style`);
      return block;
    };
    for (const [file, name] of [
      [FORMS, 'pickerRow'],
      [LANGUAGE, 'item'],
    ] as const) {
      const block = rowBlock(file, name);
      assert.doesNotMatch(block, /minHeight: \d/, `${file} hardcodes a row height`);
      assert.doesNotMatch(block, /paddingVertical: \d/, `${file} hardcodes row padding`);
    }
    assert.doesNotMatch(rowBlock(FORMS, 'pickerRowText'), /fontSize: \d/);
  });

  test('there is exactly one Select, so every screen gets the same dropdown', () => {
    // 23 call sites across the Driver, Conductor, Parent and School Admin
    // screens all mount this one component — a second definition would fork
    // the styling this spec exists to keep uniform.
    const definitions = [
      FORMS,
      LANGUAGE,
      'src/components/ui.tsx',
      'src/components/list.tsx',
    ].filter((file) => /export const Select\b/.test(read(file)));
    assert.deepEqual(definitions, [FORMS]);
    assert.match(read('src/components/index.ts'), /Select/);
  });
});
