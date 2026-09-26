import type { CrewFeedbackEvent, CrewFeedbackEventType } from './crew-voice.ts';

/**
 * Haptic **vocabulary** (Phase 3b) — pure, React-free, native-free.
 *
 * Like `crew-voice.ts`, this module only decides *which* pattern an event
 * deserves. `crew-feedback.ts` dispatches it and `crew-feedback-native.ts`
 * makes the one `expo-haptics` call. That split is what lets
 * `crew-haptics.spec.ts` assert the whole matrix under `node --test`, and
 * what makes "haptics off ⇒ zero native calls" a provable statement rather
 * than a hopeful one.
 *
 * ### The vocabulary, and why each mapping
 *
 * The rule is the same one Phase 1/2 used for colour: **a pattern means a
 * class of outcome, consistently, everywhere**. A driver learns three
 * feelings, not eleven.
 *
 * | felt as            | means                        | events                                    |
 * | ------------------ | ---------------------------- | ----------------------------------------- |
 * | light tap          | "recorded"                   | board / drop, trip transitions, next stop |
 * | error buzz         | "that did not happen"        | rejection, 409, network failure           |
 * | success buzz       | "the big thing went through" | SOS delivered, offline queue drained      |
 * | selection tick     | "I am registering your input"| SOS hold started, GPS toggled             |
 *
 * ### SOS fired → `success`, not `warning`
 *
 * A deliberate call, and worth stating because it reads backwards at first.
 * The haptic answers *"did my alert get out?"*, not *"is everything fine?"*.
 * The emergency is already obvious to the person holding the phone; what they
 * cannot see, one-handed and under stress, is whether the request left the
 * device. `Success` is the unambiguous "yes, delivered" pattern — and it is
 * distinct from the `Warning` pattern used by {@link HapticPattern.warning},
 * which is reserved for `sos.queued`: **not yet delivered, will retry**.
 * Mapping both to warning would erase the only distinction that matters at
 * that moment.
 */

/**
 * The five patterns the app speaks in. Mapped to native in one place.
 *
 * A frozen const object rather than a TS `enum`: the repo's test runner is
 * `node --experimental-strip-types`, which cannot strip an `enum` (it emits
 * runtime code). Same reason `crew-action-meta.ts` models its closed sets as
 * unions — and the call sites read identically.
 */
export const HapticPattern = {
  /** `impactAsync(Light)` — something was recorded. */
  light: 'light',
  /** `notificationAsync(Success)` — a significant action completed. */
  success: 'success',
  /** `notificationAsync(Warning)` — accepted but not yet delivered. */
  warning: 'warning',
  /** `notificationAsync(Error)` — it did not happen. */
  error: 'error',
  /** `selectionAsync()` — input registered; the lightest thing available. */
  selection: 'selection',
} as const;

export type HapticPattern = (typeof HapticPattern)[keyof typeof HapticPattern];

/**
 * Event → pattern. Exhaustive over `CrewFeedbackEventType` by construction:
 * the `Record` type makes a new event a **compile error** here, which is the
 * point — a feedback event with no declared haptic is a decision someone has
 * to make, not a default to fall into.
 */
export const HAPTIC_BY_EVENT: Readonly<Record<CrewFeedbackEventType, HapticPattern>> = {
  'board.confirmed': HapticPattern.light,
  'drop.confirmed': HapticPattern.light,
  'action.rejected': HapticPattern.error,
  'trip.boarding': HapticPattern.light,
  'trip.inProgress': HapticPattern.light,
  'trip.completed': HapticPattern.light,
  'sos.holdStart': HapticPattern.selection,
  'sos.fired': HapticPattern.success,
  'sos.queued': HapticPattern.warning,
  'offline.synced': HapticPattern.success,
  'gps.on': HapticPattern.selection,
  'gps.off': HapticPattern.selection,
  // Batch 3C: a next-stop announcement is information the crew did not ask
  // for, so it gets the lightest "something happened" tap — a buzz that
  // confirms the announcement is the phone's own, not a pothole.
  'stop.next': HapticPattern.light,
  'stop.approaching': HapticPattern.light,
  // N7 proximity: the doors-soon alert is the one announcement the crew must
  // notice over road noise, so it gets the same tap — the voice line (and the
  // card it points at) carries the information.
  'stop.near': HapticPattern.light,
  // A crew-marked stop the server confirmed: the crew *asked* for this one
  // and is waiting to know it landed, so it gets the significant-action
  // pattern rather than the lightest tap — the same buzz a completed trip
  // transition earns, because it is the same kind of receipt.
  'stop.recorded': HapticPattern.success,
  // A skip is recorded, not achieved: accepted, but nobody was served.
  'stop.skipped': HapticPattern.warning,
};

/** The pattern for an event. Total — every event has one. */
export function hapticFor(event: CrewFeedbackEvent): HapticPattern {
  return HAPTIC_BY_EVENT[event.type];
}

/**
 * Patterns that are safe to fire repeatedly in a burst.
 *
 * Unlike speech, a light tap does **not** need throttling: it is ~10 ms of
 * motor, it cannot overlap audibly, and suppressing it would break the
 * one-tap-one-tap feedback loop that makes fast boarding possible — the
 * driver's thumb is the metronome. Only the long notification patterns are
 * gated, because two overlapping buzzes read as one confused vibration.
 *
 * `crew-haptics.spec.ts` pins this: 40 rapid boards ⇒ 40 light taps, and
 * still ≤ a handful of announcements.
 */
export const UNTHROTTLED_PATTERNS: readonly HapticPattern[] = [
  HapticPattern.light,
  HapticPattern.selection,
];

/** Minimum gap between two *notification* patterns (ms). */
export const HAPTIC_MIN_GAP_MS = 300;

export function isUnthrottled(pattern: HapticPattern): boolean {
  return UNTHROTTLED_PATTERNS.includes(pattern);
}

/**
 * Tiny gate for the long patterns. Pure, injected clock, no timers — a
 * `VoiceThrottle` for the motor, minus the coalescing (a dropped buzz needs
 * no summary).
 */
export class HapticThrottle {
  private lastAt: number | null = null;
  /** Field, not a parameter property — `--experimental-strip-types` limitation. */
  private readonly minGapMs: number;

  constructor(minGapMs: number = HAPTIC_MIN_GAP_MS) {
    this.minGapMs = minGapMs;
  }

  /** Whether this pattern should fire now. */
  allow(pattern: HapticPattern, now: number): boolean {
    if (isUnthrottled(pattern)) return true;
    if (this.lastAt !== null && now - this.lastAt < this.minGapMs) return false;
    this.lastAt = now;
    return true;
  }

  reset(): void {
    this.lastAt = null;
  }
}
