import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { defaultSoundSettings, feedback, type SoundSettings } from './crew-feedback.ts';
import { installFeedbackDrivers } from './crew-feedback-native.ts';
import { loadSoundSettings, saveSoundSettings } from './feedback-preferences.ts';

/**
 * React glue over the pure feedback dispatcher — the direct counterpart of
 * `lib/i18n-provider.tsx`, and deliberately shaped the same way.
 *
 * Responsibilities, all of them thin:
 *
 * 1. install the native drivers once (no-op on web);
 * 2. **cold start**: saved preference → role default → apply. A saved choice
 *    always wins, and a role default is applied *without* persisting, so it
 *    can never overwrite a deliberate one;
 * 3. hand the Help screen a setter that updates the dispatcher immediately
 *    and writes in the background.
 *
 * The settings live in context so the Help screen's switches re-render; the
 * *dispatcher* keeps its own copy because `feedback.on(...)` is called from
 * event handlers that have no React context.
 */

interface SoundContextValue {
  settings: SoundSettings;
  setSettings: (next: SoundSettings) => void;
  /** False until the saved preference has been read — the switches wait. */
  ready: boolean;
}

const SoundContext = createContext<SoundContextValue>({
  settings: defaultSoundSettings(null),
  setSettings: () => undefined,
  ready: false,
});

export const FeedbackProvider: React.FC<{
  /** The signed-in role, or `null` before login — decides the default. */
  role: string | null;
  children: React.ReactNode;
}> = ({ role, children }) => {
  const [settings, setSettingsState] = useState<SoundSettings>(() => feedback.getSettings());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    installFeedbackDrivers();
  }, []);

  // Cold start / role change: saved preference wins, otherwise the role
  // default. Re-runs when the role first becomes known (login), exactly like
  // `useRoleLocaleDefault`.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await loadSoundSettings();
      if (cancelled) return;
      const next = saved ?? defaultSoundSettings(role);
      feedback.setSettings(next);
      setSettingsState(next);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  // Stop any announcement in flight when the crew session ends.
  useEffect(() => () => feedback.reset(), []);

  const setSettings = useCallback((next: SoundSettings) => {
    feedback.setSettings(next);
    setSettingsState(next);
    // Fire-and-forget, like the locale write: a failed save must never leave
    // the switch looking untouched.
    void saveSoundSettings(next);
  }, []);

  const value = useMemo<SoundContextValue>(
    () => ({ settings, setSettings, ready }),
    [settings, setSettings, ready],
  );

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
};

/** The live sound settings plus the setter the Help screen's switches use. */
export function useSoundSettings(): SoundContextValue {
  return useContext(SoundContext);
}
