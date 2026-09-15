import { VoiceThrottle, type CrewFeedbackEvent, type VoiceUtterance } from './crew-voice.ts';
import { HapticThrottle, HapticPattern, hapticFor } from './crew-haptics.ts';

/**
 * **The one dispatch point for crew feedback** (Phase 3b).
 *
 * ### Why one module and not two
 *
 * `crew-voice.ts` and `crew-haptics.ts` are *policies* — "what would be said"
 * and "what would be felt". This module is the *dispatcher*, and there is
 * exactly one of it on purpose:
 *
 * - **the event→feedback mapping has one home.** A call site reports what
 *   happened (`feedback.on({ type: 'board.confirmed', … })`) and never
 *   decides how it is expressed. Two dispatchers would mean every new event
 *   is wired twice and the second wiring is the one that gets forgotten;
 * - **the two channels share state.** "Voice is speaking" and "a buzz just
 *   fired" are the same burst; the throttles have to see the same event
 *   stream to stay coherent;
 * - **one preference surface.** `SoundSettings` gates both, so "voice off,
 *   vibration on" is a single readable statement instead of two modules
 *   agreeing by coincidence;
 * - **one place to prove the negative.** "Voice off ⇒ zero `Speech` calls"
 *   is asserted against this module's injected drivers, so it holds for
 *   every call site at once.
 *
 * The split that *is* worth keeping is pure-vs-native, not voice-vs-haptics:
 * nothing here imports `expo-speech` or `expo-haptics`. Native lives behind
 * {@link FeedbackDrivers}, installed once by `crew-feedback-native.ts` (which
 * is also where the `Platform.OS === 'web'` no-op lives). Same seam
 * `configureLocaleStore` uses in Phase 3a, for the same reason: this file
 * loads under plain `node --test`.
 *
 * ### Two rules that are not negotiable
 *
 * 1. **Feedback never blocks the UI.** Every driver call is fire-and-forget.
 *    There is no `await` on a speech or haptic path anywhere in this module,
 *    and `speak()` is typed to return `void` so one cannot be added by
 *    accident. A board is recorded whether or not the phone can talk.
 * 2. **Feedback never fails an action.** Every driver call is wrapped; a
 *    throwing or rejecting native module is swallowed and counted. Same
 *    principle as push delivery and the locale write — the delivery of a
 *    confirmation must never become the failure of the thing it confirms.
 */

// ── Native seam ────────────────────────────────────────────────────────────

/**
 * The entire native surface of Phase 3b: two speech calls and one haptic.
 *
 * `speak` returns `void`, not `Promise<void>` — `Speech.speak` is genuinely
 * synchronous-fire, and typing it this way makes "don't await speech" a
 * compile-time property rather than a code-review habit.
 */
export interface FeedbackDrivers {
  speak(utterance: VoiceUtterance): void;
  stopSpeaking(): void;
  haptic(pattern: HapticPattern): void;
}

/**
 * No device, no crash. This is also the shape `Platform.OS === 'web'`
 * installs, and the default under `node --test`, so an un-configured module
 * is silent rather than broken.
 */
const NOOP_DRIVERS: FeedbackDrivers = {
  speak: () => undefined,
  stopSpeaking: () => undefined,
  haptic: () => undefined,
};

let drivers: FeedbackDrivers = NOOP_DRIVERS;

/** Install the native drivers (called once from `crew-feedback-native.ts`). */
export function configureFeedbackDrivers(next: FeedbackDrivers | null): void {
  drivers = next ?? NOOP_DRIVERS;
}

// ── Preferences ────────────────────────────────────────────────────────────

/** The two switches on the Help screen. */
export interface SoundSettings {
  voice: boolean;
  vibration: boolean;
}

/**
 * Crew defaults: **both on**. The phase exists so a driver knows their tap
 * registered without reading — defaulting it off would ship the feature to
 * nobody.
 */
export const CREW_SOUND_DEFAULTS: SoundSettings = { voice: true, vibration: true };

/**
 * Office defaults: **voice off, vibration on**.
 *
 * A school admin has the app open on a desk beside other people; a phone
 * announcing every boarding is the definition of a setting they would
 * immediately hunt for. Vibration stays on because it is private and it is
 * the ordinary feedback any app gives. Same reasoning as Phase 3a's
 * role-based locale default, and the switch is in the same place.
 */
export const OFFICE_SOUND_DEFAULTS: SoundSettings = { voice: false, vibration: true };

/** Roles that get {@link CREW_SOUND_DEFAULTS}, matched against `UserRole`. */
export const VOICE_DEFAULT_ON_ROLES: readonly string[] = ['DRIVER', 'CONDUCTOR'];

/** The default settings for a role (`null` before login → office). */
export function defaultSoundSettings(role: string | null | undefined): SoundSettings {
  return role != null && VOICE_DEFAULT_ON_ROLES.includes(role)
    ? { ...CREW_SOUND_DEFAULTS }
    : { ...OFFICE_SOUND_DEFAULTS };
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

/** A scheduler, injected so specs drive time instead of waiting for it. */
export interface FeedbackScheduler {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface FeedbackDispatcherOptions {
  now?: () => number;
  scheduler?: FeedbackScheduler;
}

/**
 * Counters for the things that are *supposed* to be invisible. A swallowed
 * native failure still has to be observable somewhere, or "silently degrade"
 * becomes "silently broken" — this is the same role `CrewLocationStats`
 * plays for dropped GPS fixes, and the Help screen is where it would surface.
 */
export interface FeedbackStats {
  spoken: number;
  /** Utterances dropped by the throttle (coalesced or superseded). */
  coalesced: number;
  hapticsFired: number;
  /** Native calls that threw or rejected. Never fatal, always counted. */
  failures: number;
}

export class FeedbackDispatcher {
  private settings: SoundSettings = { ...OFFICE_SOUND_DEFAULTS };
  private readonly voiceThrottle = new VoiceThrottle();
  private readonly hapticThrottle = new HapticThrottle();
  private readonly now: () => number;
  private readonly scheduler: FeedbackScheduler;
  private flushHandle: unknown = null;
  private stats: FeedbackStats = { spoken: 0, coalesced: 0, hapticsFired: 0, failures: 0 };

  constructor(options: FeedbackDispatcherOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.scheduler = options.scheduler ?? {
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }

  getSettings(): SoundSettings {
    return { ...this.settings };
  }

  /**
   * Apply preferences. Turning voice **off** stops anything in flight and
   * drops the pending slot — "off" has to mean silent *now*, not silent
   * after the current sentence.
   */
  setSettings(next: SoundSettings): void {
    const wasVoice = this.settings.voice;
    this.settings = { ...next };
    if (wasVoice && !next.voice) {
      this.cancelFlush();
      this.voiceThrottle.reset();
      this.safely(() => drivers.stopSpeaking());
    }
  }

  getStats(): FeedbackStats {
    return { ...this.stats };
  }

  /**
   * **The API every call site uses.** Reports a fact; returns nothing;
   * cannot throw; cannot be awaited into a critical path.
   */
  on(event: CrewFeedbackEvent): void {
    this.vibrate(event);
    this.announce(event);
  }

  /** Stop everything (logout, unmount). */
  reset(): void {
    this.cancelFlush();
    this.voiceThrottle.reset();
    this.hapticThrottle.reset();
    this.safely(() => drivers.stopSpeaking());
  }

  private vibrate(event: CrewFeedbackEvent): void {
    if (!this.settings.vibration) return;
    const pattern = hapticFor(event);
    if (!this.hapticThrottle.allow(pattern, this.now())) return;
    this.stats.hapticsFired += 1;
    this.safely(() => drivers.haptic(pattern));
  }

  private announce(event: CrewFeedbackEvent): void {
    if (!this.settings.voice) return;
    const decision = this.voiceThrottle.offer(event, this.now());
    if (decision.kind === 'speak') {
      this.utter(decision.utterance);
      return;
    }
    if (decision.kind === 'defer') {
      this.stats.coalesced += 1;
      this.scheduleFlush(decision.afterMs);
    }
  }

  private scheduleFlush(afterMs: number): void {
    if (this.flushHandle !== null) return; // one timer, never a pile
    this.flushHandle = this.scheduler.setTimeout(() => {
      this.flushHandle = null;
      if (!this.settings.voice) return;
      const decision = this.voiceThrottle.flush(this.now());
      if (decision.kind === 'speak') this.utter(decision.utterance);
      else if (decision.kind === 'defer') this.scheduleFlush(decision.afterMs);
    }, afterMs);
  }

  private cancelFlush(): void {
    if (this.flushHandle === null) return;
    this.scheduler.clearTimeout(this.flushHandle);
    this.flushHandle = null;
  }

  /**
   * Latest-wins: stop, then speak. `Speech.speak` appends to the engine's own
   * queue, so without the `stop` the eighth child's name would still be
   * playing two stops later — the stop is what makes the newest fact the one
   * you hear.
   */
  private utter(utterance: VoiceUtterance): void {
    this.stats.spoken += 1;
    this.safely(() => drivers.stopSpeaking());
    this.safely(() => drivers.speak(utterance));
  }

  /**
   * Run a native call so that nothing it does can reach the caller: a throw
   * is caught, and a returned promise (`impactAsync`) gets its own `.catch`,
   * because an unhandled rejection is a crash on some RN configurations.
   * Counted, never rethrown, never awaited.
   */
  private safely(call: () => unknown): void {
    try {
      const result = call();
      if (isPromiseLike(result)) {
        result.then(undefined, () => {
          this.stats.failures += 1;
        });
      }
    } catch {
      this.stats.failures += 1;
    }
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

// ── App-wide instance ──────────────────────────────────────────────────────

/**
 * The shared dispatcher. A module-level singleton is right here (and wrong
 * for copy): it holds *timing* state, not locale state, and the throttle only
 * works if every crew surface feeds the same one — a per-screen instance
 * would let the manifest and the trip screen talk over each other.
 */
export const feedback = new FeedbackDispatcher();
