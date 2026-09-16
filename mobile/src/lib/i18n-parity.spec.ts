import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { en } from './i18n.en.ts';
import {
  LOCALE_INVARIANT_KEYS,
  SUPPORTED_LOCALES,
  dictionary,
  placeholderNames,
  type Locale,
  type TranslationKey,
} from './i18n.ts';

/**
 * Dictionary parity — the acceptance criterion "0 missing, 0 extra", checked
 * at runtime, for **every** supported locale.
 *
 * Each dictionary is already typed `Dictionary`, so the compiler catches a
 * missing key; this spec exists because a type can be defeated (a cast, a
 * generated file, a future fourth locale) and because the compiler says
 * nothing about **empty values**, **placeholder drift** or **plural pairs** —
 * all of which are real ways a localisation rots.
 *
 * English is the source of truth: every other locale is measured against it.
 */

const enKeys = Object.keys(en) as TranslationKey[];
const otherLocales = SUPPORTED_LOCALES.filter((locale) => locale !== 'en');

describe('dictionary parity (en ↔ every other locale)', () => {
  test('all dictionaries are present and the locale list is exact', () => {
    assert.deepEqual([...SUPPORTED_LOCALES], ['en', 'hi', 'mr']);
    assert.ok(enKeys.length >= 200, `expected a substantial key set, got ${enKeys.length}`);
  });

  for (const locale of otherLocales) {
    test(`every English key has a ${locale} value — 0 missing`, () => {
      const dict = dictionary(locale);
      const missing = enKeys.filter((key) => !(key in dict));
      assert.deepEqual(missing, [], `${locale} is missing: ${missing.join(', ')}`);
    });

    test(`${locale} has no key English lacks — 0 extra`, () => {
      const dict = dictionary(locale) as Record<string, string>;
      const extra = Object.keys(dict).filter((key) => !(key in en));
      assert.deepEqual(extra, [], `${locale} has extra keys: ${extra.join(', ')}`);
    });
  }

  test('no value is empty or whitespace in any locale', () => {
    const empty: string[] = [];
    for (const locale of SUPPORTED_LOCALES) {
      const dict = dictionary(locale);
      for (const key of enKeys) {
        if (typeof dict[key] !== 'string' || dict[key].trim().length === 0) {
          empty.push(`${locale}:${key}`);
        }
      }
    }
    assert.deepEqual(empty, [], `empty values: ${empty.join(', ')}`);
  });

  for (const locale of otherLocales) {
    test(`placeholder names and counts match exactly in ${locale}`, () => {
      const dict = dictionary(locale);
      const drifted: string[] = [];
      for (const key of enKeys) {
        const fromEn = placeholderNames(en[key]).sort();
        const fromOther = placeholderNames(dict[key]).sort();
        if (fromEn.length !== fromOther.length || fromEn.some((n, i) => n !== fromOther[i])) {
          drifted.push(`${key} en=[${fromEn}] ${locale}=[${fromOther}]`);
        }
      }
      assert.deepEqual(
        drifted,
        [],
        `placeholder drift (a string missing {time} renders "{time}"): ${drifted.join('; ')}`,
      );
    });
  }

  test('every .one plural key has its .other sibling', () => {
    const ones = enKeys.filter((key) => key.endsWith('.one'));
    assert.ok(ones.length > 0, 'the plural pattern should be in use');
    const orphans = ones.filter((key) => !(`${key.slice(0, -'.one'.length)}.other` in en));
    assert.deepEqual(orphans, [], `.one keys without .other: ${orphans.join(', ')}`);
  });
});

describe('untranslated-copy guard', () => {
  /**
   * A value identical to the English one is either a legitimate invariant
   * (a brand, an acronym, a self-designation in its own script) or a string
   * nobody translated. Every one of them has to be declared in
   * LOCALE_INVARIANT_KEYS, so the second case cannot hide behind the first.
   */
  test('every key whose value equals English is declared locale-invariant (all locales)', () => {
    const declared = new Set<string>(LOCALE_INVARIANT_KEYS);
    const undeclaredByLocale = new Map<Locale, string[]>();
    for (const locale of otherLocales) {
      const dict = dictionary(locale);
      const identical = enKeys.filter((key) => dict[key] === en[key]);
      const undeclared = identical.filter((key) => !declared.has(key));
      if (undeclared.length > 0) undeclaredByLocale.set(locale, undeclared);
    }
    const report = [...undeclaredByLocale.entries()].map(([locale, keys]) => `${locale}: ${keys.join(', ')}`);
    assert.deepEqual(
      report,
      [],
      `these look untranslated and are not in LOCALE_INVARIANT_KEYS: ${report.join('; ')}`,
    );
    const stale: string[] = [];
    for (const locale of otherLocales) {
      for (const key of declared) {
        if (dictionary(locale)[key as TranslationKey] !== en[key as TranslationKey]) {
          stale.push(`${locale}:${key}`);
        }
      }
    }
    assert.deepEqual(stale, [], `declared invariant but now translated: ${stale.join(', ')}`);
  });

  test('the status words stay distinct in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const words = ['scheduled', 'boarding', 'inProgress', 'completed', 'cancelled'].map(
        (part) => dictionary(locale)[`status.${part}` as TranslationKey],
      );
      assert.equal(new Set(words).size, words.length, `${locale}: status words must be distinct`);
    }
  });

  test('the ✓/✕/⏳ status glyphs survive translation (colour is never the only cue)', () => {
    for (const key of ['manifest.confirmBoard', 'manifest.queuedBoard'] as TranslationKey[]) {
      const glyphs = (value: string): string[] => value.match(/[✓✕⏳]/g) ?? [];
      for (const locale of otherLocales) {
        assert.deepEqual(
          glyphs(dictionary(locale)[key]),
          glyphs(en[key]),
          `${key} lost a status glyph in ${locale}`,
        );
      }
    }
  });
});
