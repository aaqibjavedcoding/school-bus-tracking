import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { configureFeedbackDrivers, type FeedbackDrivers } from './crew-feedback.ts';
import { HapticPattern } from './crew-haptics.ts';
import {
  configureVoiceCapabilities,
  parseVoiceCapabilities,
  type VoiceCapabilitySet,
  type VoiceUtterance,
} from './crew-voice.ts';

/**
 * **The only file in Phase 3b that imports a native module.**
 *
 * Everything else — the phrases, the throttle, the haptic vocabulary, the
 * preference matrix, the voice-plan resolution — is pure and spec-covered.
 * This is the thin wrapper the brief asks for: no decisions, no policy. The
 * one piece of state it holds is the **cached** capability probe
 * ({@link detectVoiceCapabilities}), which exists precisely so no other layer
 * ever has to ask the engine a question mid-announcement.
 *
 * Mirrors `lib/i18n-preferences.ts` from Phase 3a: the pure core declares a
 * seam (`configureFeedbackDrivers`), and exactly one module fills it in.
 * That is why `crew-feedback.ts` and friends load under plain `node --test`
 * while the app still gets real speech.
 *
 * **Web is a no-op.** `react-native-web` has no haptics engine, and a browser
 * tab that starts talking is a bug, not a feature. `expo-speech` does have a
 * web path, but the crew app on web is a development convenience, so the
 * whole layer is disabled rather than half-working — and CI's Android export
 * is not the only place this must not crash.
 *
 * **No native configuration.** Neither module needs an `app.json` plugin, an
 * Android permission or an iOS usage string: `expo-speech` drives the OS TTS
 * service, and `expo-haptics` uses the taptic/vibration APIs that do not
 * require `VIBRATE` (see the `performAndroidHapticsAsync` note in the Expo
 * docs). Both are in the Expo Go runtime, so the QR-code dev flow is
 * unchanged — no development build required.
 */

/** iOS/Android `NotificationFeedbackType` for our three notification patterns. */
const NOTIFICATION_TYPE: Partial<Record<HapticPattern, Haptics.NotificationFeedbackType>> = {
  [HapticPattern.success]: Haptics.NotificationFeedbackType.Success,
  [HapticPattern.warning]: Haptics.NotificationFeedbackType.Warning,
  [HapticPattern.error]: Haptics.NotificationFeedbackType.Error,
};

const nativeDrivers: FeedbackDrivers = {
  /**
   * Fire-and-forget by construction: `Speech.speak` returns `void`, and the
   * failure path is the `onError` callback rather than a rejected promise.
   * Nothing here is awaited, so a device with no TTS engine costs the caller
   * nothing but a no-op.
   */
  speak(utterance: VoiceUtterance): void {
    Speech.speak(utterance.text, {
      language: utterance.language,
      // Pinning the voice identifier is what actually selects it on Android
      // (`options.voice` → `TextToSpeech.setVoice`), whose `language` option is
      // region-tag-shy. The key is *omitted* rather than set to `undefined`
      // when there is no identifier: iOS throws on a voice it cannot resolve,
      // and a key that is absent cannot be resolved wrongly. Every identifier
      // here came from this process's own probe, so it is valid by
      // construction.
      ...(utterance.voiceId ? { voice: utterance.voiceId } : {}),
      rate: utterance.rate,
      // `pitch` deliberately omitted — the engine default is the right one.
      onError: () => undefined,
    });
  },

  stopSpeaking(): void {
    // Returns a promise on some platforms; the dispatcher attaches the
    // `.catch`, so a stop on an idle engine can never surface as a rejection.
    void Speech.stop();
  },

  haptic(pattern: HapticPattern): void {
    if (pattern === HapticPattern.light) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    if (pattern === HapticPattern.selection) {
      void Haptics.selectionAsync();
      return;
    }
    const type = NOTIFICATION_TYPE[pattern];
    if (type) void Haptics.notificationAsync(type);
  },
};

/**
 * Install the real drivers. Called once from `FeedbackProvider`; calling it
 * again just replaces the same adapter.
 *
 * On web (and anywhere the modules are missing from the runtime) this leaves
 * the built-in no-op drivers in place, so `feedback.on(...)` stays a
 * statement about intent that costs nothing.
 */
export function installFeedbackDrivers(): void {
  if (Platform.OS === 'web') return;
  // A device whose runtime lacks the module (an old dev build, a stripped
  // bundle) must degrade to silence, not to a red screen on first board.
  if (typeof Speech.speak !== 'function' || typeof Haptics.impactAsync !== 'function') return;
  configureFeedbackDrivers(nativeDrivers);
}

// ── Voice capability probe (once per process, cached) ──────────────────────

/** How long the iOS warm-up may take before detection answers without it. */
const VOICE_PROBE_WARMUP_MS = 1_500;

/** The memoised probe. `null` until the first call; `null` again if it fails. */
let capabilityProbe: Promise<VoiceCapabilitySet | null> | null = null;

/**
 * **Ask the engine what it can speak — exactly once.**
 *
 * The result is parsed by the pure {@link parseVoiceCapabilities} and handed
 * to the policy layer through {@link configureVoiceCapabilities}, so every
 * later utterance resolves its language and voice from a `Map` in memory. No
 * announcement ever waits on this native round-trip, and none ever triggers
 * one: the promise is memoised, and two callers (the provider's mount and a
 * later re-mount) share a single probe.
 *
 * Resolves to `null` — "not measured" — on web, in a runtime without the
 * module, or on a probe that threw. `null` keeps the voice channel on the
 * Latin/`en-IN` fallback and suppresses the install hint, because a phone we
 * could not measure is not a phone we may accuse of missing a voice.
 *
 * A *failure* is not cached as an answer: the memo is cleared so a later mount
 * gets one more try.
 */
export function detectVoiceCapabilities(): Promise<VoiceCapabilitySet | null> {
  // Nothing to ask on web (where the whole voice layer is a deliberate no-op)
  // or in a runtime that lacks the module. Both answer "not measured" rather
  // than "measured, nothing installed" — an unasked engine is not a missing
  // voice, and saying so would put a wrong hint on the settings card.
  if (Platform.OS === 'web' || typeof Speech.getAvailableVoicesAsync !== 'function') {
    return Promise.resolve(null);
  }
  if (capabilityProbe === null) {
    capabilityProbe = probeEngineVoices()
      .then((records) => {
        const installed = parseVoiceCapabilities(records);
        configureVoiceCapabilities(installed);
        return installed;
      })
      .catch(() => {
        capabilityProbe = null;
        return null;
      });
  }
  return capabilityProbe;
}

/**
 * The native round-trip, with the one platform quirk handled.
 *
 * iOS answers with an **empty list** until its speech synthesizer has been
 * used once, which would read as "this iPhone has no Hindi voice" and put the
 * crew into the fallback forever. So an empty first answer *on iOS* buys one
 * silent warm-up and one re-probe — bounded, never a loop, and never on
 * Android, where an empty list genuinely means no voices.
 */
async function probeEngineVoices(): Promise<Speech.Voice[]> {
  const first = await Speech.getAvailableVoicesAsync();
  if (first.length > 0 || Platform.OS !== 'ios') return first;
  await warmUpSynthesizer();
  return Speech.getAvailableVoicesAsync();
}

/** One inaudible utterance so iOS initialises its synthesizer. */
function warmUpSynthesizer(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      Speech.speak(' ', { volume: 0, onDone: settle, onError: settle, onStopped: settle });
    } catch {
      settle();
    }
    // An engine that never calls back must not hang capability detection: the
    // fallback is already the safe answer, so giving up costs nothing.
    setTimeout(settle, VOICE_PROBE_WARMUP_MS);
  });
}
