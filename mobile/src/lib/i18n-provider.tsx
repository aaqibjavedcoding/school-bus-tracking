import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  applyResolvedLocale,
  getLocale,
  isSupportedLocale,
  loadPersistedLocale,
  localeForRole,
  normalizeLocaleTag,
  setLocale,
  subscribeLocale,
  t,
  type Locale,
  type TranslationKey,
  type ParamsFor,
} from './i18n.ts';
import { installLocaleStore, readDeviceLocale } from './i18n-preferences.ts';

/**
 * React glue over the pure i18n core.
 *
 * **How the instant re-render works.** `t()` reads the active locale at call
 * time, so a component only needs to *re-render* to pick up a switch. React
 * re-renders a subtree when a context it consumes changes, so the rule is:
 *
 * > every component that renders translated text calls `useTranslation()`.
 *
 * `i18n-literals.spec.ts` enforces that for the crew surfaces — a screen that
 * renders `t(...)` or `crewCopy` without subscribing would silently keep the
 * old language until the next navigation, which is exactly the bug this
 * guards against. Nothing is remounted: navigation state, form input and the
 * manifest scroll position all survive a language switch.
 */

const LocaleContext = createContext<Locale>('en');

/** Bound, type-safe translator for the active locale. */
export type Translator = <K extends TranslationKey>(
  key: K,
  ...params: [ParamsFor<K>] extends [never] ? [] : [Readonly<Record<ParamsFor<K>, string | number>>]
) => string;

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(() => getLocale());

  useEffect(() => {
    installLocaleStore();
    const unsubscribe = subscribeLocale((next) => setLocaleState(next));
    let cancelled = false;
    // Cold start: saved preference → device locale → `en`. AsyncStorage is
    // async, so the very first paint can be the default; the switch below is
    // in-place and costs no navigation state.
    void (async () => {
      const saved = await loadPersistedLocale();
      if (cancelled) return;
      applyResolvedLocale({ saved, device: readDeviceLocale(), role: null });
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
};

/** The active locale — subscribing to it is what makes a screen re-render. */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/**
 * Subscribe the calling component to locale changes and hand back `t`.
 * Use this in every component that renders translated text.
 */
export function useTranslation(): Translator {
  useLocale();
  return t as Translator;
}

/**
 * Apply the role-based default once the signed-in role is first known.
 *
 * Crew (DRIVER/CONDUCTOR) default to Hindi, everyone else to the device
 * locale. An explicit saved preference always wins, and the default is
 * applied **without** persisting — so a crew member's cold start is Hindi,
 * while a deliberate switch to English on the Help screen survives forever.
 */
export function useRoleLocaleDefault(role: string | null | undefined): void {
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !role) return;
    applied.current = true;
    void (async () => {
      const saved = normalizeLocaleTag(await loadPersistedLocale());
      if (saved && isSupportedLocale(saved)) return;
      const resolved = localeForRole(role, readDeviceLocale());
      if (resolved !== getLocale()) setLocale(resolved, { persist: false });
    })();
  }, [role]);
}
