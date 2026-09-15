import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { configureFeedbackDrivers, type FeedbackDrivers } from './crew-feedback.ts';
import { HapticPattern } from './crew-haptics.ts';
import type { VoiceUtterance } from './crew-voice.ts';

/**
 * **The only file in Phase 3b that imports a native module.**
 *
 * Everything else — the phrases, the throttle, the haptic vocabulary, the
 * preference matrix — is pure and spec-covered. This is the thin wrapper the
 * brief asks for: three functions, no decisions, no state.
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
