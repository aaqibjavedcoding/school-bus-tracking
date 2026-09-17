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
  errorKeyForStatus,
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

  test('accepts Marathi, the regional-language rollout batch 1', () => {
    assert.equal(normalizeLocaleTag('mr'), 'mr');
    assert.equal(normalizeLocaleTag('mr-IN'), 'mr');
    assert.equal(isSupportedLocale('mr'), true);
  });

  test('rejects an unsupported language instead of guessing a neighbour', () => {
    assert.equal(normalizeLocaleTag('ta-IN'), null);
    assert.equal(normalizeLocaleTag(''), null);
    assert.equal(normalizeLocaleTag(null), null);
    assert.equal(normalizeLocaleTag(undefined), null);
    assert.equal(isSupportedLocale('ta'), false);
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

  test('crew default to English, whatever the device locale (product rule)', () => {
    assert.equal(CREW_DEFAULT_LOCALE, 'en');
    assert.equal(resolveInitialLocale({ saved: null, device: 'en-US', role: 'DRIVER' }), 'en');
    assert.equal(resolveInitialLocale({ saved: null, device: 'hi-IN', role: 'DRIVER' }), 'en');
    assert.equal(resolveInitialLocale({ saved: null, device: 'mr-IN', role: 'CONDUCTOR' }), 'en');
  });

  test('admin and parent follow the device locale', () => {
    assert.equal(resolveInitialLocale({ saved: null, device: 'hi-IN', role: 'PARENT' }), 'hi');
    assert.equal(
      resolveInitialLocale({ saved: null, device: 'en-GB', role: 'SCHOOL_ADMIN' }),
      'en',
    );
    // A Marathi-locale parent gets Marathi — regional locales are device-resolved.
    assert.equal(resolveInitialLocale({ saved: null, device: 'mr-IN', role: 'PARENT' }), 'mr');
    assert.equal(localeForRole('SCHOOL_ADMIN', 'ta-IN'), DEFAULT_LOCALE);
  });

  test('an unknown/absent device falls back to English, never to a guess', () => {
    assert.equal(resolveInitialLocale({ saved: null, device: 'ta-IN', role: 'PARENT' }), 'en');
    assert.equal(resolveInitialLocale({ saved: null, device: null, role: null }), 'en');
    assert.equal(DEFAULT_LOCALE, 'en');
  });

  test('a corrupt saved value is ignored, not trusted', () => {
    // Crew role falls back to the crew default (en), not to the device locale.
    assert.equal(
      resolveInitialLocale({ saved: 'klingon', device: 'hi-IN', role: 'DRIVER' }),
      'en',
    );
    // Non-crew roles fall back to the device locale.
    assert.equal(resolveInitialLocale({ saved: 'klingon', device: 'hi-IN', role: 'PARENT' }), 'hi');
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

  test('a code-less status still becomes the locale’s own sentence', () => {
    setLocale('hi', { persist: false });
    const result = localizeApiError({ code: null, message: null, status: 500 });
    assert.equal(result.message, t('error.HTTP_500'));
    assert.equal(result.localized, true);
    assert.equal(result.codeNote, null);

    const notFound = localizeApiError({ code: null, message: null, status: 404 });
    assert.equal(notFound.message, t('error.HTTP_404'));
    setLocale('en', { persist: false });
  });

  test('every 5xx shares the “server could not complete” copy', () => {
    assert.equal(errorKeyForStatus(500), 'error.HTTP_500');
    assert.equal(errorKeyForStatus(502), 'error.HTTP_500');
    assert.equal(errorKeyForStatus(504), 'error.HTTP_500');
    assert.equal(errorKeyForStatus(418), null);
  });

  test('a diagnostic is never passed through as the server’s message', () => {
    const result = localizeApiError({
      code: null,
      message: 'Request failed with status 401',
      status: 401,
    });
    assert.equal(result.message, t('error.HTTP_401'));
    assert.doesNotMatch(result.message, /request failed|HTTP/i);
  });

  test('an unknown code keeps the code visible but drops the diagnostic', () => {
    const result = localizeApiError({
      code: 'BUS_WINDOW_OVERLAP',
      message: 'Request failed with status 422',
      status: 422,
    });
    assert.equal(result.message, t('error.HTTP_422'));
    assert.equal(result.codeNote, `${t('error.unknownCodePrefix')} BUS_WINDOW_OVERLAP`);
  });

  test('the localised 5xx copy carries no status code', () => {
    for (const locale of ['en', 'hi', 'mr'] as const) {
      setLocale(locale, { persist: false });
      assert.doesNotMatch(t('error.HTTP_500'), /HTTP\s*\d/i);
      assert.doesNotMatch(t('error.HTTP_503'), /HTTP\s*\d/i);
      setLocale('en', { persist: false });
    }
  });
});
