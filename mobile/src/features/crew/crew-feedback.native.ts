import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import {
  FEEDBACK_STORAGE_KEY,
  configureFeedbackAdapters,
  configureFeedbackStore,
  feedback,
  type FeedbackPreferences,
} from './crew-feedback.ts';

/**
 * The **only** file in the crew feedback layer that touches a native module
 * (`expo-speech`, `expo-haptics`, AsyncStorage, `Platform`). Everything the
 * layer decides lives in the pure modules; this file just hands the decisions
 * to the OS and reports when an utterance ends.
 *
 * Imported for its side effects from `app/_layout.tsx`, the same way
 * `features/crew/location-task.ts` registers the background-location task —
 * no provider, no context, nothing for a screen to remember.
 *
 * ### Permission-free (verified against the installed packages)
 *
 * - `node_modules/expo-haptics/android/src/main/AndroidManifest.xml` declares
 *   `<uses-permission android:name="android.permission.VIBRATE"/>`. Android
 *   merges a library's manifest into the app's at build time, and `VIBRATE` is
 *   a **normal** (install-time) permission — so there is nothing to add to
 *   `app.json` and no runtime prompt.
 * - `node_modules/expo-speech/android/src/main/AndroidManifest.xml` contributes
 *   the `android.intent.action.TTS_SERVICE` `<queries>` intent, merged the same
 *   way. Speech needs no permission at all; it uses the OS TTS engine.
 *
 * Both modules ship in **Expo Go** on the SDK-57 line, so the dev flow
 * (`scripts/expo-start.mjs`) needs no dev build for Phase 3b.
 *
 * ### Degradation is silent, by design
 *
 * Three things can go wrong on a real device and none of them may reach the
 * crew member's action:
 *
 * 1. **`Platform.OS === 'web'`** — `react-native-web` has no haptics and the
 *    web TTS path is a different API; the adapters become no-ops. CI's Android
 *    export is the only build that matters, but a web bundle must not crash.
 * 2. **The native module is missing** (an old dev build, a stripped Expo Go) —
 *    each call is guarded on the function existing.
 * 3. **The device has no TTS engine, or no voice for the tag** — `Speech.speak`
 *    rejects/errors asynchronously. It is never awaited; `onError` only settles
 *    the throttle gate so the next phrase can play.
 *
 * This is the same principle the push layer and the server's notification
 * pipeline follow (README §19.6): *a delivery failure never fails the
 * operation.*
 */

/**
 * The guards are **functions, not module constants**, so the check runs on
 * every call: `Platform.OS` never changes at runtime on a device, but reading
 * it lazily is what makes the web no-op and the "module missing" fallback
 * assertable from `crew-feedback.sim.spec.ts` instead of merely documented.
 */
const isWeb = (): boolean => Platform.OS === 'web';

/** True when a callable actually exists — guards a stripped/dev build. */
function available(candidate: unknown): boolean {
  return typeof candidate === 'function';
}

const speechReady = (): boolean => !isWeb() && available(Speech?.speak);
const hapticsReady = (): boolean => !isWeb() && available(Haptics?.impactAsync);

const impactStyle = (style: 'light' | 'medium') =>
  style === 'medium' ? Haptics.ImpactFeedbackStyle?.Medium : Haptics.ImpactFeedbackStyle?.Light;

const notificationType = (type: 'success' | 'warning' | 'error') =>
  type === 'warning'
    ? Haptics.NotificationFeedbackType?.Warning
    : type === 'error'
      ? Haptics.NotificationFeedbackType?.Error
      : Haptics.NotificationFeedbackType?.Success;

/** Run a native call and swallow everything. Never awaited by a caller. */
function attempt(run: () => unknown): void {
  if (isWeb()) return;
  try {
    const result = run();
    // `expo-haptics` and `Speech.stop()` return promises; a rejection is a
    // device that cannot buzz/speak, which is exactly the case we degrade on.
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Swallowed on purpose — see the module note.
  }
}

/**
 * Install the adapters and the preference store, then apply the cold-start
 * preference. Idempotent: importing twice (HMR, a second layout) is harmless.
 *
 * The adapters are always installed — each one decides at call time whether
 * the platform can honour it — so "no native module here" degrades to silence
 * rather than to a missing adapter a caller has to reason about.
 */
export function installCrewFeedback(): void {
  configureFeedbackAdapters({
    voice: {
      stop: () => {
        if (speechReady()) attempt(() => Speech.stop());
      },
      speak: (text, options) => {
        if (!speechReady()) return;
        attempt(() =>
          Speech.speak(text, {
            language: options.language,
            rate: options.rate,
            pitch: options.pitch,
            // Any terminal callback settles the throttle gate. If the OS fires
            // none of them the gate simply stays "speaking" and the next
            // routine event is suppressed — quieter, never louder.
            onDone: options.onSettled,
            onStopped: options.onSettled,
            onError: options.onSettled,
          }),
        );
      },
    },
    haptics: {
      impact: (style) => {
        if (hapticsReady()) attempt(() => Haptics.impactAsync(impactStyle(style)));
      },
      notification: (type) => {
        if (hapticsReady()) attempt(() => Haptics.notificationAsync(notificationType(type)));
      },
      selection: () => {
        if (hapticsReady()) attempt(() => Haptics.selectionAsync());
      },
    },
  });

  configureFeedbackStore({
    read: () => AsyncStorage.getItem(FEEDBACK_STORAGE_KEY),
    write: (prefs: FeedbackPreferences) =>
      AsyncStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(prefs)),
  });

  // Fire-and-forget: the first paint uses the safe defaults (voice off), and
  // the saved choice lands a microtask later — before any crew action exists.
  void feedback.loadPersisted();
}

installCrewFeedback();
