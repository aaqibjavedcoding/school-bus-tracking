import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import { configureLocaleStore, type Locale } from './i18n.ts';

/**
 * The only place the i18n layer touches a React Native module.
 *
 * `i18n.ts` is deliberately dependency-free so it loads under plain
 * `node --test`; everything native lives here, in two tiny functions:
 *
 * 1. **persistence** — the language preference in AsyncStorage, injected into
 *    the core via `configureLocaleStore`;
 * 2. **the device locale probe** — no `expo-localization` (a new dependency
 *    would have to be version-locked to the SDK-57 line per
 *    `docs/mobile-expo-sdk.md`, and this needs nothing that exotic).
 */

/** AsyncStorage key of the saved language preference. */
export const LOCALE_STORAGE_KEY = 'sbt.mobile.locale';

interface AppleSettings {
  AppleLocale?: string;
  AppleLanguages?: string[];
}

/**
 * The device locale as the OS reports it (`hi-IN`, `en-US`, …), or `null`
 * when it cannot be read.
 *
 * Probed in order of trust, all of them first-party:
 *
 * 1. iOS `I18nManager.localeIdentifier` — the documented RN iOS value;
 * 2. iOS `SettingsManager.settings.AppleLocale` / `AppleLanguages[0]` — the
 *    same thing on builds where the I18nManager field is absent;
 * 3. Android `I18nManager.languageIdentifier` — RN's Android equivalent;
 * 4. `Intl.DateTimeFormat().resolvedOptions().locale` — the universal
 *    fallback; Hermes ships full Intl on the SDK-57 line, and this is also
 *    the correct answer on `react-native-web`;
 * 5. `navigator.language` on web when Intl somehow reports nothing usable.
 *
 * Every step is wrapped: an unreadable locale must never throw at boot, it
 * just falls through to the next rule in `resolveInitialLocale`.
 */
export function readDeviceLocale(): string | null {
  try {
    const i18nManager = NativeModules.I18nManager as
      { localeIdentifier?: string; languageIdentifier?: string } | undefined;
    if (i18nManager?.localeIdentifier) return i18nManager.localeIdentifier;

    const settings = NativeModules.SettingsManager as { settings?: AppleSettings } | undefined;
    const appleLocale = settings?.settings?.AppleLocale ?? settings?.settings?.AppleLanguages?.[0];
    if (appleLocale) return appleLocale;

    if (i18nManager?.languageIdentifier) return i18nManager.languageIdentifier;

    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.language) {
      return navigator.language;
    }

    const fromIntl = new Intl.DateTimeFormat().resolvedOptions().locale;
    return fromIntl && fromIntl.length > 0 ? fromIntl : null;
  } catch {
    return null;
  }
}

/**
 * Wire AsyncStorage into the i18n core. Called once from `I18nProvider`;
 * calling it twice is harmless (it just replaces the same adapter).
 */
export function installLocaleStore(): void {
  configureLocaleStore({
    read: () => AsyncStorage.getItem(LOCALE_STORAGE_KEY),
    write: (locale: Locale) => AsyncStorage.setItem(LOCALE_STORAGE_KEY, locale),
  });
}
