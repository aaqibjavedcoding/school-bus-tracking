/**
 * Haptics (Phase 3b) — the **pure** half: which event vibrates, with which
 * pattern, and when the module must stay completely silent.
 *
 * Like `crew-voice.ts` this file touches no native module; the three
 * `expo-haptics` calls live in `crew-feedback.native.ts` behind the injectable
 * seam, and `crew-haptics.spec.ts` pins the mapping under plain `node --test`.
 *
 * ### The vocabulary (three patterns, no more)
 *
 * A driver cannot read a haptic "sentence", so the whole system uses three
 * distinguishable shapes and reuses them consistently:
 *
 * | pattern            | meaning                                  | events                                       |
 * | ------------------ | ---------------------------------------- | -------------------------------------------- |
 * | `impact light`     | **your tap registered**                  | board, drop, queued, GPS on/off               |
 * | `impact medium`    | **the trip state changed**               | BOARDING, IN_PROGRESS, COMPLETED              |
 * | `notification …`   | **an outcome you must know without reading** | success (SOS sent, sync done), warning (SOS queued), error (rejected / offline) |
 * | `selection`        | **a control moved**                      | the hold tick, a settings toggle              |
 *
 * ### Why SOS fires `notification success` and not `warning`
 *
 * The haptic confirms the *delivery*, and a delivered SOS is a success — the
 * emergency itself is already carried by the voice line and the on-screen
 * "SOS sent ✅". Using `warning` here would collide with the pattern reserved
 * for "this did **not** go through", which is the one distinction a stressed
 * driver must never have to think about. So: **sent → success, queued
 * (offline) → warning, rejected → error.** Three states, three patterns.
 *
 * ### Permission note (verified, not assumed)
 *
 * `node_modules/expo-haptics/android/src/main/AndroidManifest.xml` declares
 * `<uses-permission android:name="android.permission.VIBRATE"/>`, and Android
 * merges a library manifest into the app's at build time — so **no `app.json`
 * change is needed**. `VIBRATE` is a normal (install-time) permission, so
 * there is no runtime prompt either. `expo-speech`'s manifest contributes the
 * `TTS_SERVICE` `<queries>` intent the same way.
 */

/** Every event that can vibrate. Superset of the voice events (hold tick +
 *  settings toggle have no spoken form). */
export type HapticsEventKind =
  | 'board.done'
  | 'board.queued'
  | 'drop.done'
  | 'drop.queued'
  | 'trip.boarding'
  | 'trip.inProgress'
  | 'trip.completed'
  | 'sos.hold'
  | 'sos.sent'
  | 'sos.queued'
  | 'sos.failed'
  | 'sync.done'
  | 'gps.on'
  | 'gps.off'
  | 'action.failed'
  | 'action.conflict'
  | 'toggle'
  | 'test';

/** `expo-haptics` `ImpactFeedbackStyle` values this module may use. */
export type HapticsImpactStyle = 'light' | 'medium';

/** `expo-haptics` `NotificationFeedbackType` values this module may use. */
export type HapticsNotificationType = 'success' | 'warning' | 'error';

export type HapticsPattern =
  | { call: 'impact'; style: HapticsImpactStyle }
  | { call: 'notification'; type: HapticsNotificationType }
  | { call: 'selection' };

/**
 * The whole mapping, as data. `crew-feedback.ts` reads it; nothing else
 * decides a vibration, so the table is the single place to review.
 */
export const HAPTICS_PATTERNS: Readonly<Record<HapticsEventKind, HapticsPattern>> = {
  'board.done': { call: 'impact', style: 'light' },
  'board.queued': { call: 'impact', style: 'light' },
  'drop.done': { call: 'impact', style: 'light' },
  'drop.queued': { call: 'impact', style: 'light' },
  'trip.boarding': { call: 'impact', style: 'medium' },
  'trip.inProgress': { call: 'impact', style: 'medium' },
  'trip.completed': { call: 'impact', style: 'medium' },
  'sos.hold': { call: 'selection' },
  'sos.sent': { call: 'notification', type: 'success' },
  'sos.queued': { call: 'notification', type: 'warning' },
  'sos.failed': { call: 'notification', type: 'error' },
  'sync.done': { call: 'notification', type: 'success' },
  'gps.on': { call: 'impact', style: 'light' },
  'gps.off': { call: 'impact', style: 'light' },
  'action.failed': { call: 'notification', type: 'error' },
  'action.conflict': { call: 'notification', type: 'error' },
  toggle: { call: 'selection' },
  test: { call: 'notification', type: 'success' },
};

/**
 * The pattern for an event, or `null` when the module must not touch the
 * native layer at all.
 *
 * The `enabled` check is here rather than in the caller on purpose: "vibration
 * off ⇒ **zero** native calls" is a property of this module, asserted by a spy
 * in `crew-haptics.spec.ts`, and it cannot be forgotten at a call site.
 */
export function hapticsFor(kind: HapticsEventKind, enabled: boolean): HapticsPattern | null {
  if (!enabled) return null;
  return HAPTICS_PATTERNS[kind] ?? null;
}
