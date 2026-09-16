import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { en } from './i18n.en.ts';
import { CONSTRAINED_KEYS, budgetFor, growthCeiling } from './i18n-budget.ts';
import { SUPPORTED_LOCALES, dictionary, type TranslationKey } from './i18n.ts';

/**
 * The clipping guard: "Hindi runs 20–30% longer, so nothing may be cut off".
 *
 * What this can and cannot do, stated plainly: it cannot render a screen, so
 * it measures **characters** against a per-key budget derived from the
 * container (`i18n-budget.ts`). That catches the class of bug that actually
 * ships — a translated chip/badge/tab/button label too long for the fixed
 * width it was designed against — in CI, on every run, with no device.
 *
 * Data placeholders are stripped before measuring, because a student's name or
 * a stop's name is the same length in every language; only the *chrome* around
 * it is translated.
 */

const mobileRoot = `${process.cwd()}/`;
const read = (path: string): string => readFileSync(`${mobileRoot}${path}`, 'utf8');

/** Length of a template with its `{placeholders}` removed. */
const chromeLength = (value: string): number => value.replace(/\{[^}]*\}/g, '').trim().length;

const enKeys = Object.keys(en) as TranslationKey[];
const otherLocales = SUPPORTED_LOCALES.filter((locale) => locale !== 'en');

describe('per-key length budget (fixed-width / single-line containers)', () => {
  test('every constrained key fits its container in every locale', () => {
    const over: string[] = [];
    for (const key of Object.keys(CONSTRAINED_KEYS) as TranslationKey[]) {
      const budget = budgetFor(key);
      assert.ok(budget, `${key} is listed but has no budget`);
      for (const locale of SUPPORTED_LOCALES) {
        const length = chromeLength(dictionary(locale)[key]);
        if (length > budget!.maxChars) {
          over.push(`${locale}:${key} ${length}>${budget!.maxChars} (${budget!.kind})`);
        }
      }
    }
    assert.deepEqual(over, [], `over budget: ${over.join('; ')}`);
  });

  test('no translation grows past the global allowance (every locale)', () => {
    const over: string[] = [];
    for (const locale of otherLocales) {
      const dict = dictionary(locale);
      for (const key of enKeys) {
        const ceiling = growthCeiling(chromeLength(en[key]));
        const length = chromeLength(dict[key]);
        if (length > ceiling) {
          over.push(`${locale}:${key} en=${chromeLength(en[key])} ${locale}=${length}>${ceiling}`);
        }
      }
    }
    assert.deepEqual(over, [], `translation grew too far: ${over.join(', ')}`);
  });

  /**
   * The aggregate "Hindi is 20–30% longer" folklore is **false for this
   * dictionary** — summed chrome is ~5% *shorter* in Hindi, because matras are
   * combining marks that `.length` counts without adding glyph width. What is
   * real, and what actually clips, is **per-key** growth: measured here so the
   * assertion documents the distribution instead of a guess. If a future edit
   * pushes the tail past 2.5×, the tight containers are in trouble even when
   * the averages look fine.
   */
  for (const locale of otherLocales) {
    test(`per-key growth stays inside the measured envelope (${locale})`, () => {
      const dict = dictionary(locale);
      const rows = enKeys.map((key) => ({
        key,
        en: chromeLength(en[key]),
        other: chromeLength(dict[key]),
        delta: chromeLength(dict[key]) - chromeLength(en[key]),
      }));
      const grown = rows.filter((row) => row.delta > 0);

      assert.ok(
        grown.length >= 40,
        `expected a substantial number of keys to grow in ${locale}, saw ${grown.length} — is the guard vacuous?`,
      );

      // A ratio only means something once the English is long enough to
      // have one; what matters for the short labels is the absolute delta.
      const ratiable = grown.filter((row) => row.en >= 6);
      const worst = [...ratiable].sort((a, b) => b.other / b.en - a.other / a.en)[0]!;
      const worstRatio = worst.other / worst.en;
      assert.ok(
        worstRatio <= 2.5,
        `${worst.key} grew ${worst.en}→${worst.other} (${worstRatio.toFixed(2)}×), past the measured 2.25× envelope`,
      );

      const widest = [...grown].sort((a, b) => b.delta - a.delta)[0]!;
      assert.ok(
        widest.delta <= 20,
        `${widest.key} grew by ${widest.delta} characters (${widest.en}→${widest.other})`,
      );
    });
  }
});

describe('single-line containers on crew surfaces are budgeted', () => {
  test('the filter-chip label (numberOfLines={1}) is fed only budgeted keys', () => {
    // `FilterChips` renders its option label on one line, and the manifest
    // feeds it the filter names plus a " · N" count — the tightest row in the
    // crew app. Assert the wiring and the budget together.
    const chips = read('src/components/ui.tsx');
    const singleLine = /filterSummaryText[\s\S]{0,200}numberOfLines=\{1\}/.test(chips);
    assert.ok(singleLine, 'FilterChips still renders its label on one line');

    const manifestList = read('src/features/crew/ManifestList.tsx');
    for (const key of [
      'manifest.filter.all',
      'manifest.filter.waiting',
      'manifest.filter.boarded',
      'manifest.filter.dropped',
    ] as TranslationKey[]) {
      assert.equal(
        budgetFor(key)?.kind,
        'chip',
        `${key} feeds a single-line chip and must carry a 'chip' budget`,
      );
      assert.ok(manifestList.includes(key), `${key} is no longer wired into ManifestList`);
    }
  });

  test('crew rows that flash/confirm keep the name and time in one measured line', () => {
    // The "Ramesh ✓ 7:42 AM" confirmation is data + a glyph; only the offline
    // variant adds translated chrome, and it is budgeted via the growth rule.
    for (const locale of otherLocales) {
      const dict = dictionary(locale);
      for (const key of ['manifest.queuedBoard', 'manifest.queuedDrop'] as TranslationKey[]) {
        assert.ok(
          chromeLength(dict[key]) <= growthCeiling(chromeLength(en[key])),
          `${locale}:${key} grew past the allowance`,
        );
      }
    }
  });

  test('the crew tab bar has exactly four visible labels, each inside the tab budget', () => {
    const layout = read('app/(crew)/_layout.tsx');
    // Four visible tabs (Help is registered with `href: null`), so exactly four
    // `tabBarLabel` props — Phase 2's "the bar stays four crew actions".
    assert.equal(
      layout.match(/tabBarLabel:/g)?.length ?? 0,
      4,
      'the crew bar must stay at four labelled actions',
    );
    for (const key of [
      'nav.tab.drive',
      'nav.tab.trip',
      'nav.tab.manifest',
      'nav.tab.students',
      'nav.tab.stops',
      'nav.tab.sos',
    ] as TranslationKey[]) {
      assert.equal(budgetFor(key)?.kind, 'tab', `${key} is a tab label and needs a 'tab' budget`);
    }
  });
});
