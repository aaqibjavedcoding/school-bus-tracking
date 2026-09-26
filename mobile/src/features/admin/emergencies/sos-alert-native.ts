import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { installSosAlertDrivers } from './sos-alert.ts';

/**
 * **The only file of the admin SOS alert that imports a native module.**
 *
 * The policy — when the loop runs, what it says, how the mute and the cap
 * behave — lives in `sos-alert.ts`, pure and spec-covered. This wrapper only
 * fills the driver seam, mirroring `crew-feedback-native.ts`:
 *
 * - **Vibration** is the `Error` notification pattern — the urgent buzz the
 *   crew app already reserves for "this needs you now" (`crew-haptics.ts`),
 *   unmistakable against the light taps of ordinary confirmations;
 * - **Speech** is one short English line (the admin mobile section is
 *   English-only, like the web admin console) through the device's own TTS
 *   engine — free, on-device, no voice API, no bundled audio asset;
 * - **Web is a no-op**, exactly as in the crew layer: no haptics engine in a
 *   browser, and a tab that starts talking is a bug.
 *
 * No new dependency, no `app.json` plugin, no permission strings: both
 * modules are already in the app (`expo-haptics`, `expo-speech`) and run in
 * the Expo Go shell, so the QR-code dev flow is unchanged. A bundled siren
 * *sound* is deliberately out of scope — it would need `expo-av` /
 * `expo-audio` and a native rebuild (documented in `docs/mobile-ux.md`).
 */
export function installNativeSosAlertDrivers(): void {
  if (Platform.OS === 'web') {
    return;
  }
  installSosAlertDrivers({
    vibrate: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
    speak: (text) => {
      Speech.speak(text, {
        language: 'en-IN',
        // Fire-and-forget by construction: a device with no TTS engine
        // reports through `onError` and the loop simply stays haptic-only.
        onError: () => undefined,
      });
    },
    stopSpeaking: () => {
      // Returns a promise on some platforms; a stop on an idle engine can
      // never surface as a rejection.
      void Speech.stop();
    },
  });
}
