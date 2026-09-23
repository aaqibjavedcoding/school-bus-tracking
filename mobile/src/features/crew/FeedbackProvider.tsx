import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { defaultSoundSettings, feedback, type SoundSettings } from './crew-feedback.ts';
import { detectVoiceCapabilities, installFeedbackDrivers } from './crew-feedback-native.ts';
import { voiceCapabilities, type VoiceCapabilitySet } from './crew-voice.ts';
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
 *    and writes in the background;
 * 4. run the **one** voice-capability probe (batch 3C) and publish its cached
 *    result, so the Sound card can explain a missing native voice. The probe
 *    is memoised in `crew-feedback-native.ts`; this component only holds the
 *    React-visible copy, and the dismissal of that hint is per-session state —
 *    never a preference, so it cannot overwrite one.
 *
 * The settings live in context so the Help screen's switches re-render; the
 * *dispatcher* keeps its own copy because `feedback.on(...)` is called from
 * event handlers that have no React context.
 */

/** The voice-capability half of the sound context. */
export interface VoiceSupport {
  /**
   * What the device was measured to speak, or `null` while un-probed (web, a
   * runtime without the module, or a probe still in flight).
   */
  capabilities: VoiceCapabilitySet | null;
  /** True once the crew member has dismissed the install hint this session. */
  nativeVoiceHintDismissed: boolean;
  /** Dismiss it — one-time means one-time. */
  dismissNativeVoiceHint(): void;
}

interface SoundContextValue {
  settings: SoundSettings;
  setSettings: (next: SoundSettings) => void;
  /** False until the saved preference has been read — the switches wait. */
  ready: boolean;
  voiceSupport: VoiceSupport;
}

const SoundContext = createContext<SoundContextValue>({
  settings: defaultSoundSettings(null),
  setSettings: () => undefined,
  ready: false,
  voiceSupport: {
    capabilities: null,
    nativeVoiceHintDismissed: false,
    dismissNativeVoiceHint: () => undefined,
  },
});

export const FeedbackProvider: React.FC<{
  /** The signed-in role, or `null` before login — decides the default. */
  role: string | null;
  children: React.ReactNode;
}> = ({ role, children }) => {
  const [settings, setSettingsState] = useState<SoundSettings>(() => feedback.getSettings());
  const [ready, setReady] = useState(false);
  // Seeded from the policy layer's cache, so a provider that mounts after the
  // probe (a re-mount, a second provider in a test) starts with the answer
  // instead of flashing the un-probed state.
  const [capabilities, setCapabilities] = useState<VoiceCapabilitySet | null>(voiceCapabilities);
  const [nativeVoiceHintDismissed, setNativeVoiceHintDismissed] = useState(false);

  useEffect(() => {
    installFeedbackDrivers();
    let cancelled = false;
    // Fire-and-forget, off the render path: the probe is one native
    // round-trip, memoised, and the voice channel keeps working (on the
    // Latin/`en-IN` fallback) for as long as it takes.
    void detectVoiceCapabilities().then((installed) => {
      if (!cancelled && installed !== null) setCapabilities(installed);
    });
    return () => {
      cancelled = true;
    };
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

  const dismissNativeVoiceHint = useCallback(() => setNativeVoiceHintDismissed(true), []);

  const voiceSupport = useMemo<VoiceSupport>(
    () => ({ capabilities, nativeVoiceHintDismissed, dismissNativeVoiceHint }),
    [capabilities, nativeVoiceHintDismissed, dismissNativeVoiceHint],
  );

  const value = useMemo<SoundContextValue>(
    () => ({ settings, setSettings, ready, voiceSupport }),
    [settings, setSettings, ready, voiceSupport],
  );

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
};

/** The live sound settings plus the setter the Help screen's switches use. */
export function useSoundSettings(): SoundContextValue {
  return useContext(SoundContext);
}
