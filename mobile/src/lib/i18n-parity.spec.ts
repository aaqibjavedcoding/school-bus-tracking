import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { en } from './i18n.en.ts';
import { hi } from './i18n.hi.ts';
import {
  LOCALE_INVARIANT_KEYS,
  SUPPORTED_LOCALES,
  dictionary,
  placeholderNames,
  type TranslationKey,
} from './i18n.ts';

/**
 * Dictionary parity — the acceptance criterion "0 missing, 0 extra", checked
 * at runtime.
 *
 * `i18n.hi.ts` is already typed as `Dictionary`, so the compiler catches a
 * missing key; this spec exists because a type can be defeated (a cast, a
 * generated file, a future third locale) and because the compiler says nothing
 * about **empty values**, **placeholder drift** or **plural pairs** — all of
 * which are real ways a localisation rots.
 */

const enKeys = Object.keys(en) as TranslationKey[];
const hiKeys = Object.keys(hi) as TranslationKey[];

describe('dictionary parity (en ↔ hi)', () => {
  test('both dictionaries are present and non-trivial', () => {
    assert.deepEqual([...SUPPORTED_LOCALES], ['en', 'hi']);
    assert.ok(enKeys.length >= 200, `expected a substantial key set, got ${enKeys.length}`);
  });

  test('every English key has a Hindi value — 0 missing', () => {
    const missing = enKeys.filter((key) => !(key in hi));
    assert.deepEqual(missing, [], `hi is missing: ${missing.join(', ')}`);
  });

  test('Hindi has no key English lacks — 0 extra', () => {
    const extra = hiKeys.filter((key) => !(key in en));
    assert.deepEqual(extra, [], `hi has extra keys: ${extra.join(', ')}`);
  });

  test('no value is empty or whitespace in either locale', () => {
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

  test('placeholder names and counts match exactly in both locales', () => {
    const drifted: string[] = [];
    for (const key of enKeys) {
      const fromEn = placeholderNames(en[key]).sort();
      const fromHi = placeholderNames(hi[key]).sort();
      if (fromEn.length !== fromHi.length || fromEn.some((n, i) => n !== fromHi[i])) {
        drifted.push(`${key} en=[${fromEn}] hi=[${fromHi}]`);
      }
    }
    assert.deepEqual(
      drifted,
      [],
      `placeholder drift (a Hindi string missing {time} renders "{time}"): ${drifted.join('; ')}`,
    );
  });

  test('every .one plural key has its .other sibling', () => {
    const ones = enKeys.filter((key) => key.endsWith('.one'));
    assert.ok(ones.length > 0, 'the plural pattern should be in use');
    const orphans = ones.filter((key) => !(`${key.slice(0, -'.one'.length)}.other` in en));
    assert.deepEqual(orphans, [], `.one keys without .other: ${orphans.join(', ')}`);
  });
});

describe('untranslated-copy guard', () => {
  /**
   * A Hindi value identical to the English one is either a legitimate
   * invariant (a brand, an acronym, a self-designation in its own script) or a
   * string nobody translated. Every one of them has to be declared, so the
   * second case cannot hide behind the first.
   */
  test('every key whose hi === en is declared locale-invariant', () => {
    const declared = new Set<string>(LOCALE_INVARIANT_KEYS);
    const identical = enKeys.filter((key) => hi[key] === en[key]);
    const undeclared = identical.filter((key) => !declared.has(key));
    assert.deepEqual(
      undeclared,
      [],
      `these look untranslated and are not in LOCALE_INVARIANT_KEYS: ${undeclared.join(', ')}`,
    );
    const stale = [...declared].filter(
      (key) => hi[key as TranslationKey] !== en[key as TranslationKey],
    );
    assert.deepEqual(stale, [], `declared invariant but now translated: ${stale.join(', ')}`);
  });

  test('the status words stay distinct in both locales', () => {
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
      assert.deepEqual(glyphs(hi[key]), glyphs(en[key]), `${key} lost a status glyph in Hindi`);
    }
  });
});
