import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { en } from './i18n.en.ts';
import {
  CREW_DEFAULT_LOCALE,
  DEFAULT_LOCALE,
  KNOWN_ERROR_CODES,
  SERVER_MESSAGE_WINS,
  applyResolvedLocale,
  configureLocaleStore,
  getLocale,
  interpolate,
  isSupportedLocale,
  loadPersistedLocale,
  localeForRole,
  localizeApiError,
  normalizeLocaleTag,
  placeholderNames,
  pluralKey,
  resolveInitialLocale,
  setLocale,
  subscribeLocale,
  t,
} from './i18n.ts';

/**
 * The i18n core: resolution order, interpolation, switching and the
 * server-string boundary. Everything here runs in plain Node — the module has
 * no React Native import, which is itself part of the contract.
 */

/** In-memory stand-in for AsyncStorage, so persistence is testable here. */
function memoryStore(initial: string | null = null) {
  let value = initial;
  const writes: string[] = [];
  return {
    writes,
    adapter: {
      read: async () => value,
      write: async (locale: string) => {
        value = locale;
        writes.push(locale);
      },
    },
  };
}

describe('normalizeLocaleTag', () => {
  test('accepts a supported language from any region casing', () => {
    assert.equal(normalizeLocaleTag('hi'), 'hi');
    assert.equal(normalizeLocaleTag('hi-IN'), 'hi');
    assert.equal(normalizeLocaleTag('hi_IN'), 'hi');
    assert.equal(normalizeLocaleTag('HI-in'), 'hi');
    assert.equal(normalizeLocaleTag('en-US'), 'en');
  });

  test('rejects an unsupported language instead of guessing a neighbour', () => {
    assert.equal(normalizeLocaleTag('mr-IN'), null);
    assert.equal(normalizeLocaleTag(''), null);
    assert.equal(normalizeLocaleTag(null), null);
    assert.equal(normalizeLocaleTag(undefined), null);
    assert.equal(isSupportedLocale('mr'), false);
  });
});

describe('resolution order: saved → device (per role) → en', () => {
  test('a saved preference wins over both the device and the role', () => {
    assert.equal(
      resolveInitialLocale({ saved: 'en', device: 'hi-IN', role: 'DRIVER' }),
      'en',
      'an explicit choice must survive a Hindi device and a crew role',
    );
    assert.equal(resolveInitialLocale({ saved: 'hi', device: 'en-US', role: 'PARENT' }), 'hi');
  });

  test('crew default to Hindi even on an English-locale device', () => {
    assert.equal(CREW_DEFAULT_LOCALE, 'hi');
    assert.equal(resolveInitialLocale({ saved: null, device: 'en-US', role: 'DRIVER' }), 'hi');
    assert.equal(resolveInitialLocale({ saved: null, device: 'en-US', role: 'CONDUCTOR' }), 'hi');
  });

  test('admin and parent follow the device locale', () => {
    assert.equal(resolveInitialLocale({ saved: null, device: 'hi-IN', role: 'PARENT' }), 'hi');
    assert.equal(
      resolveInitialLocale({ saved: null, device: 'en-GB', role: 'SCHOOL_ADMIN' }),
      'en',
    );
    assert.equal(localeForRole('SCHOOL_ADMIN', 'mr-IN'), DEFAULT_LOCALE);
  });

  test('an unknown/absent device falls back to English, never to a guess', () => {
    assert.equal(resolveInitialLocale({ saved: null, device: 'mr-IN', role: 'PARENT' }), 'en');
    assert.equal(resolveInitialLocale({ saved: null, device: null, role: null }), 'en');
    assert.equal(DEFAULT_LOCALE, 'en');
  });

  test('a corrupt saved value is ignored, not trusted', () => {
    assert.equal(resolveInitialLocale({ saved: 'klingon', device: 'hi-IN', role: 'DRIVER' }), 'hi');
  });
});

describe('placeholders', () => {
  test('lists every placeholder in order', () => {
    assert.deepEqual(placeholderNames(en['manifest.confirmBoard']), ['name', 'time']);
    assert.deepEqual(placeholderNames(en['manifest.board']), []);
  });

  test('interpolates named values and leaves an unknown one visible', () => {
    assert.equal(
      interpolate('{name} ✓ {time}', { name: 'Ramesh', time: '7:42 AM' }),
      'Ramesh ✓ 7:42 AM',
    );
    assert.equal(
      interpolate('{name} ✓ {time}', { name: 'Ramesh' }),
      'Ramesh ✓ {time}',
      'a missing value stays a visible placeholder — never "undefined"',
    );
  });

  test('t() interpolates from the active locale', () => {
    setLocale('en', { persist: false });
    assert.equal(
      t('manifest.confirmBoard', { name: 'Ramesh', time: '7:42 AM' }),
      'Ramesh ✓ 7:42 AM',
    );
    setLocale('hi', { persist: false });
    assert.equal(
      t('manifest.confirmBoard', { name: 'Ramesh', time: '7:42 AM' }),
      'Ramesh ✓ 7:42 AM',
    );
    assert.equal(t('manifest.announceBoard', { name: 'Ramesh' }), 'Ramesh चढ़ गया');
    setLocale('en', { persist: false });
  });
});

describe('locale switching', () => {
  test('setLocale notifies subscribers so the UI re-renders in place', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeLocale((locale) => seen.push(locale));
    setLocale('hi', { persist: false });
    assert.equal(getLocale(), 'hi');
    assert.deepEqual(seen, ['hi']);
    unsubscribe();
    setLocale('en', { persist: false });
    assert.deepEqual(seen, ['hi'], 'an unsubscribed listener is not called');
  });

  test('an explicit switch persists; a role default does not', async () => {
    const store = memoryStore(null);
    configureLocaleStore(store.adapter);

    setLocale('hi');
    assert.deepEqual(store.writes, ['hi'], 'the user’s choice is saved');

    store.writes.length = 0;
    applyResolvedLocale({ saved: null, device: 'en-US', role: 'DRIVER' });
    assert.deepEqual(store.writes, [], 'a boot-time default never overwrites a saved choice');
    configureLocaleStore(null);
  });

  test('a failing store write is not fatal — the switch still applies', async () => {
    configureLocaleStore({
      read: async () => {
        throw new Error('disk gone');
      },
      write: async () => {
        throw new Error('disk gone');
      },
    });
    assert.doesNotThrow(() => setLocale('hi'));
    assert.equal(getLocale(), 'hi');
    assert.equal(await loadPersistedLocale(), null);
    setLocale('en', { persist: false });
    configureLocaleStore(null);
  });
});

describe('pluralKey', () => {
  test('picks the .one / .other sibling', () => {
    assert.equal(pluralKey('offline.pending', 1), 'offline.pending.one');
    assert.equal(pluralKey('offline.pending', 0), 'offline.pending.other');
    assert.equal(pluralKey('offline.pending', 5), 'offline.pending.other');
    assert.equal(t(pluralKey('offline.pending', 1), { count: 1 }), en['offline.pending.one']);
    assert.equal(t(pluralKey('offline.syncing', 3), { count: 3 }), 'Syncing 3 actions…');
  });
});

describe('server-string boundary (localizeApiError)', () => {
  test('a known code is replaced with the app’s own copy', () => {
    setLocale('hi', { persist: false });
    const result = localizeApiError({ code: 'HTTP_409', message: 'Already boarded', status: 409 });
    assert.equal(result.localized, true);
    assert.equal(result.codeNote, null);
    assert.equal(result.message, t('error.HTTP_409'));
    setLocale('en', { persist: false });
  });

  test('HTTP_403 keeps the server’s own message — the documented taxonomy', () => {
    assert.ok(SERVER_MESSAGE_WINS.has('HTTP_403'));
    const result = localizeApiError({
      code: 'HTTP_403',
      message: 'Insufficient role permissions',
      status: 403,
    });
    assert.equal(result.message, 'Insufficient role permissions');
    assert.equal(result.localized, false, 'a 403 must never be masked by generic copy');
  });

  test('HTTP_403 with no server message falls back to the localised copy', () => {
    const result = localizeApiError({ code: 'HTTP_403', message: null, status: 403 });
    assert.equal(result.message, t('error.HTTP_403'));
    assert.equal(result.localized, true);
  });

  test('an unknown code is passed through AS-IS with the raw code shown', () => {
    const result = localizeApiError({
      code: 'BUS_WINDOW_OVERLAP',
      message: 'Run overlaps the 07:10 window',
      status: 422,
    });
    assert.equal(result.message, 'Run overlaps the 07:10 window');
    assert.equal(result.localized, false);
    assert.equal(result.codeNote, `${t('error.unknownCodePrefix')} BUS_WINDOW_OVERLAP`);
    assert.match(result.codeNote ?? '', /BUS_WINDOW_OVERLAP/, 'the raw code is never hidden');
  });

  test('status 0 (no network) gets the localised offline line', () => {
    const result = localizeApiError({ code: null, message: null, status: 0 });
    assert.equal(result.message, t('error.networkOffline'));
    assert.equal(result.localized, true);
  });

  test('nothing at all falls back to common.error', () => {
    assert.equal(localizeApiError({}).message, t('common.error'));
  });

  test('every known code maps to a real dictionary key', () => {
    for (const [code, key] of Object.entries(KNOWN_ERROR_CODES)) {
      assert.ok(key in en, `${code} maps to a missing key ${key}`);
    }
  });
});
