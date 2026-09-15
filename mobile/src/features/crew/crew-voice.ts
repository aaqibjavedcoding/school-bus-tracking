import { getLocale, t, type Locale, type TranslationKey } from '../../lib/i18n.ts';

/**
 * Voice feedback (Phase 3b) — the **pure** half: which event says what, in
 * which language, at what rate, and whether the device should be interrupted
 * or stay quiet.
 *
 * This file imports no React Native and no Expo module, so every rule below is
 * pinned by `crew-voice.spec.ts` under plain `node --test`. The single native
 * call (`Speech.stop()` → `Speech.speak()`) lives in `crew-feedback.native.ts`
 * behind the injectable seam, exactly the way `i18n.ts` keeps AsyncStorage out
 * of the core and `i18n-preferences.ts` wires it in.
 *
 * ### Why the spoken channel is Latin-script Hinglish (and the screen is not)
 *
 * The written UI is Devanagari and stays Devanagari. The *spoken* channel is a
 * different medium with a different constraint: `expo-speech` hands the string
 * to whatever TTS engine the device has. Budget Android devices — the hardware
 * this app is built for — very often ship **no `hi-IN` voice at all**. A
 * Devanagari string given to the default English voice is not "Hindi with an
 * accent", it is unreadable noise, which is worse than silence because the
 * driver cannot tell whether the app spoke at all. The same content written in
 * Latin script ("Ramesh ka boarding ho gaya") is pronounced intelligibly by the
 * device's default voice *and* matches the language the driver actually speaks.
 *
 * So: **two channels, two scripts, on purpose.** `voice.*` keys hold the spoken
 * text (Latin Hinglish in `hi`, English in `en`); `feedback.*` keys hold the
 * written labels for the settings rows (Devanagari in `hi`). Neither is a
 * translation gap — `docs/mobile-ux.md` → Phase 3b documents the split and
 * `i18n-parity.spec.ts` still enforces key parity across both.
 *
 * ### The rules this module owns
 *
 * 1. **Language follows the UI locale**, resolved by the same order Phase 3a
 *    established (saved preference → role default → `en`) — but read through
 *    `getLocale()` **at call time**. Freezing a phrase or a language tag at
 *    module scope would reproduce the exact bug `trip-status-style.ts` and
 *    `ManifestList.tsx` were fixed for in 3a, and `crew-voice.spec.ts` pins it.
 * 2. **The bus never becomes a queue.** Forty students board in a minute; the
 *    gate below caps announcements per burst, suppresses the rest and offers a
 *    single summary ("5 students boarded") instead. Its state is counters and
 *    timestamps — there is no array to grow.
 * 3. **Privacy is structural, not hopeful.** The payload types accept a first
 *    name and a clock time; nothing else. `voicePrivacyViolations()` is the
 *    belt-and-braces check that runs on the final string.
 */

// ── Events ────────────────────────────────────────────────────────────────

/**
 * Every event the crew app announces. Adding one means adding a `voice.*` key
 * to **both** dictionaries (`i18n-parity.spec.ts` fails otherwise) and a row
 * to `VOICE_KEYS`.
 */
export type VoiceEventKind =
  | 'board.done'
  | 'board.queued'
  | 'board.summary'
  | 'drop.done'
  | 'drop.queued'
  | 'drop.summary'
  | 'trip.boarding'
  | 'trip.inProgress'
  | 'trip.completed'
  | 'sos.sent'
  | 'sos.queued'
  | 'sync.done'
  | 'gps.on'
  | 'gps.off'
  | 'action.failed'
  | 'action.conflict'
  | 'test';

/**
 * The **only** data the voice layer is allowed to carry.
 *
 * Deliberately not `TripStudentAttendanceResponse`: a manifest row also holds
 * `admission_number`, `last_name`, `student_id`, stop and trip ids. Passing the
 * whole record in would make "no PII in the voice payload" a matter of
 * discipline at every call site instead of a property of the type. The
 * whitelisting mapper below is the only bridge.
 */
export interface VoiceStudentPayload {
  /** First name only — never the full name, never with an admission number. */
  firstName: string;
  /** A clock time the crew already sees on the row ("7:42 AM"). */
  time: string;
}

export interface VoiceCountPayload {
  count: number;
}

export type VoicePayload = VoiceStudentPayload | VoiceCountPayload | null;

/**
 * Whitelist mapper: a full attendance record (or anything shaped like it) in,
 * the two speakable fields out. The discarded fields are the point.
 */
export function voiceStudentEvent(
  source: { first_name: string; last_name?: string; admission_number?: string },
  time: string,
): VoiceStudentPayload {
  const firstName = typeof source.first_name === 'string' ? source.first_name.trim() : '';
  return { firstName: firstName.length > 0 ? firstName : '—', time };
}

// ── Copy ──────────────────────────────────────────────────────────────────

const VOICE_KEYS: Record<VoiceEventKind, TranslationKey> = {
  'board.done': 'voice.board.done',
  'board.queued': 'voice.board.queued',
  'board.summary': 'voice.board.summary',
  'drop.done': 'voice.drop.done',
  'drop.queued': 'voice.drop.queued',
  'drop.summary': 'voice.drop.summary',
  'trip.boarding': 'voice.trip.boarding',
  'trip.inProgress': 'voice.trip.inProgress',
  'trip.completed': 'voice.trip.completed',
  'sos.sent': 'voice.sos.sent',
  'sos.queued': 'voice.sos.queued',
  'sync.done': 'voice.sync.done',
  'gps.on': 'voice.gps.on',
  'gps.off': 'voice.gps.off',
  'action.failed': 'voice.action.failed',
  'action.conflict': 'voice.action.conflict',
  test: 'voice.test',
};

/**
 * `SpeechOptions.language` per UI locale — a **hint** to the OS, not a filter.
 *
 * Because the text is Latin-script, a device without the tagged voice falls
 * back to its default engine and is still understood. (Devanagari text under
 * that same fallback is the failure mode this design avoids.) A third locale
 * is one entry here plus two dictionary values — nothing else changes.
 */
export const VOICE_LANGUAGE_TAGS: Record<Locale, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
};

/**
 * Slightly slower than natural speech. A bus is loud and the phrases are
 * short; 0.95 costs ~5% duration and measurably improves intelligibility on
 * small speakers. Pitch stays at the platform default (1.0) — a shifted pitch
 * reads as a different person, which is confusing for a confirmation cue.
 */
export const VOICE_RATE = 0.95;
export const VOICE_PITCH = 1;

/** The language tag for the locale active **right now**. */
export function voiceLanguageFor(locale: Locale = getLocale()): string {
  return VOICE_LANGUAGE_TAGS[locale] ?? VOICE_LANGUAGE_TAGS.en;
}

/**
 * The spoken phrase for an event, built at call time.
 *
 * `t()` is read here — never at module scope — so a language switch changes
 * the *next* announcement without a restart (see the module note).
 */
export function voicePhraseFor(kind: VoiceEventKind, payload: VoicePayload = null): string {
  const key = VOICE_KEYS[kind];
  if (isStudentPayload(payload)) {
    // A typed cast is unavoidable at the `t()` boundary (its params type is
    // derived per key); the values themselves are the whitelisted two.
    return t(key as 'voice.board.done', { name: payload.firstName, time: payload.time });
  }
  if (isCountPayload(payload)) {
    return t(key as 'voice.board.summary', { count: payload.count });
  }
  return t(key as 'voice.test');
}

function isStudentPayload(payload: VoicePayload): payload is VoiceStudentPayload {
  return payload !== null && 'firstName' in payload;
}

function isCountPayload(payload: VoicePayload): payload is VoiceCountPayload {
  return payload !== null && 'count' in payload;
}

// ── Privacy ───────────────────────────────────────────────────────────────

export interface VoicePrivacyPattern {
  name: string;
  test: RegExp;
}

/**
 * The deny-list. A spoken phrase is broadcast into a bus full of children and
 * whoever else is standing at the stop, so it may never carry:
 *
 * - a **phone number** (guardian or staff) — a caller id read aloud is a
 *   data breach in a public space;
 * - a **medical note** or any free-text detail — those are the SOS `message`
 *   and the student health fields;
 * - a **guardian contact / relationship** string;
 * - an **admission number**, and never the full name *plus* one — the
 *   combination is what identifies a child outside the school;
 * - an **email** or any other credential-shaped token.
 *
 * `voicePrivacyViolations` is the runtime backstop; the payload types above
 * are the primary control (you cannot interpolate a field you were never
 * handed). `crew-voice.spec.ts` asserts both, including with a full attendance
 * record as the input.
 */
export const VOICE_DENY_PATTERNS: readonly VoicePrivacyPattern[] = [
  { name: 'phone', test: /(?:\+\d{1,3}[\s-]?)?(?:\d[\s-]?){8,}\d/ },
  { name: 'email', test: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  { name: 'admissionNumber', test: /\b[A-Z]{0,4}[-/]?\d{4,}\b/ },
  {
    name: 'medicalOrGuardianDetail',
    test: /\b(?:medical|medicine|allerg|asthma|inhaler|guardian|parent contact|emergency contact|blood group)\b/i,
  },
];

/** Names of the deny-list rules a string trips (empty = speakable). */
export function voicePrivacyViolations(text: string): string[] {
  const hits: string[] = [];
  for (const pattern of VOICE_DENY_PATTERNS) {
    if (pattern.test.test(text)) hits.push(pattern.name);
  }
  return hits;
}

/** True when the string carries nothing on the deny-list. */
export function isSpeakable(text: string): boolean {
  return voicePrivacyViolations(text).length === 0;
}

// ── Throttle / interrupt gate ─────────────────────────────────────────────

/**
 * Minimum gap between two *non-critical* announcements. Inside the
 * acceptance-criteria window (500–700 ms); at 600 ms the shortest phrase
 * (~1.6 s at rate 0.95) has room to be cut off cleanly by the next one.
 */
export const VOICE_MIN_GAP_MS = 600;

/** A burst window: the sliding span the announcement cap is counted over. */
export const VOICE_BURST_WINDOW_MS = 10_000;

/**
 * Hard cap on spoken announcements inside one burst — the "≤N" of the
 * acceptance criteria. Six covers a stop where the conductor calls a handful
 * of names and still leaves the bus quiet during a 40-student boarding.
 */
export const VOICE_MAX_ANNOUNCEMENTS_PER_BURST = 6;

/** Suppressed same-kind events that make a summary worth saying. */
export const VOICE_SUMMARY_THRESHOLD = 5;

/**
 * Events that always get through, interrupting whatever is playing: an
 * emergency, a lifecycle change or a failure is exactly the moment the driver
 * is *not* looking at the screen. Everything else yields to them.
 */
export const VOICE_CRITICAL_EVENTS: ReadonlySet<VoiceEventKind> = new Set([
  'sos.sent',
  'sos.queued',
  'trip.boarding',
  'trip.inProgress',
  'trip.completed',
  'action.failed',
  'action.conflict',
  'sync.done',
]);

/** Events whose repeats collapse into one summary instead of N phrases. */
const COALESCE_GROUP: Partial<Record<VoiceEventKind, 'board' | 'drop'>> = {
  'board.done': 'board',
  'board.queued': 'board',
  'drop.done': 'drop',
  'drop.queued': 'drop',
};

export type VoiceGateAction =
  /** Speak now. */
  | 'speak'
  /** Stop the current utterance first, then speak (latest wins). */
  | 'interrupt'
  /** Say nothing; the event is counted for a possible summary. */
  | 'suppress';

export interface VoiceDecision {
  action: VoiceGateAction;
  /** The phrase for a `speak`/`interrupt`, `null` when suppressed. */
  phrase: string | null;
  language: string;
  rate: number;
  pitch: number;
}

export interface VoiceGateSnapshot {
  speaking: boolean;
  lastSpokenAt: number | null;
  burstStartedAt: number | null;
  burstSpoken: number;
  suppressedBoard: number;
  suppressedDrop: number;
}

/**
 * The throttle, as pure time arithmetic on synthetic clocks.
 *
 * **State is O(1) by construction**: four counters/timestamps and no
 * collection, so a queue literally cannot grow — the spec asserts that
 * structurally rather than trusting the comment. The policy:
 *
 * - **idle** → speak;
 * - **already speaking** → a critical event interrupts (latest wins), a
 *   routine one is suppressed and counted;
 * - **inside `VOICE_MIN_GAP_MS`** of the last phrase → suppressed and counted;
 * - **more than `VOICE_MAX_ANNOUNCEMENTS_PER_BURST` in the burst window** →
 *   suppressed and counted, however idle the device is;
 * - `drainSummary()` turns ≥`VOICE_SUMMARY_THRESHOLD` suppressed events of one
 *   kind into a single "5 students boarded" phrase.
 */
export class VoiceGate {
  private speaking = false;
  private lastSpokenAt: number | null = null;
  private burstStartedAt: number | null = null;
  private burstSpoken = 0;
  private suppressedBoard = 0;
  private suppressedDrop = 0;

  /** Decide what to do with one event at `now`. Pure: no timers, no I/O. */
  decide(kind: VoiceEventKind, payload: VoicePayload, now: number): VoiceDecision {
    const critical = VOICE_CRITICAL_EVENTS.has(kind);
    const base = { language: voiceLanguageFor(), rate: VOICE_RATE, pitch: VOICE_PITCH };

    this.rollBurst(now);
    const group = COALESCE_GROUP[kind];

    const tooSoon = this.lastSpokenAt !== null && now - this.lastSpokenAt < VOICE_MIN_GAP_MS;
    const burstFull = this.burstSpoken >= VOICE_MAX_ANNOUNCEMENTS_PER_BURST;

    if (this.speaking) {
      if (critical)
        return this.markSpoken(now, { action: 'interrupt', ...base, ...phrase(kind, payload) });
      this.countSuppressed(group);
      return { action: 'suppress', ...base, ...phrase(null, null) };
    }
    if (!critical && (tooSoon || burstFull)) {
      this.countSuppressed(group);
      return { action: 'suppress', ...base, ...phrase(null, null) };
    }
    return this.markSpoken(now, { action: 'speak', ...base, ...phrase(kind, payload) });
  }

  /**
   * The utterance finished (or was interrupted). Called from the adapter's
   * `onDone`/`onStopped`/`onError`; a missing callback only makes the gate
   * *more* conservative, never louder.
   */
  settle(): void {
    this.speaking = false;
  }

  /** Forget the burst state — a new boarding wave starts a fresh budget. */
  reset(): void {
    this.burstStartedAt = null;
    this.burstSpoken = 0;
    this.suppressedBoard = 0;
    this.suppressedDrop = 0;
  }

  /**
   * The one summary owed for the suppressed events, or `null`. Returns the
   * decision *and* clears the counter, so a summary is said once.
   */
  drainSummary(now: number, enabled: boolean): VoiceDecision | null {
    const group =
      this.suppressedBoard >= VOICE_SUMMARY_THRESHOLD
        ? 'board'
        : this.suppressedDrop >= VOICE_SUMMARY_THRESHOLD
          ? 'drop'
          : null;
    if (!group || !enabled) return null;
    // Only the drained group is cleared, so a bus that boarded *and* dropped a
    // rush of students says one summary for each rather than dropping one.
    const count = group === 'board' ? this.suppressedBoard : this.suppressedDrop;
    if (group === 'board') this.suppressedBoard = 0;
    else this.suppressedDrop = 0;
    this.rollBurst(now);
    return this.markSpoken(now, {
      action: this.speaking ? 'interrupt' : 'speak',
      language: voiceLanguageFor(),
      rate: VOICE_RATE,
      pitch: VOICE_PITCH,
      ...phrase(group === 'board' ? 'board.summary' : 'drop.summary', { count }),
    });
  }

  /** Counters only — see the class note. No collection is reachable. */
  snapshot(): VoiceGateSnapshot {
    return {
      speaking: this.speaking,
      lastSpokenAt: this.lastSpokenAt,
      burstStartedAt: this.burstStartedAt,
      burstSpoken: this.burstSpoken,
      suppressedBoard: this.suppressedBoard,
      suppressedDrop: this.suppressedDrop,
    };
  }

  private markSpoken(now: number, decision: VoiceDecision): VoiceDecision {
    this.speaking = true;
    this.lastSpokenAt = now;
    if (this.burstStartedAt === null) this.burstStartedAt = now;
    this.burstSpoken += 1;
    return decision;
  }

  private rollBurst(now: number): void {
    if (this.burstStartedAt !== null && now - this.burstStartedAt >= VOICE_BURST_WINDOW_MS) {
      this.burstStartedAt = null;
      this.burstSpoken = 0;
    }
  }

  private countSuppressed(group: 'board' | 'drop' | undefined): void {
    if (group === 'board') this.suppressedBoard += 1;
    if (group === 'drop') this.suppressedDrop += 1;
  }
}

/** `phrase` as a spreadable object; `null` kind → no phrase (suppressed). */
function phrase(kind: VoiceEventKind | null, payload: VoicePayload): { phrase: string | null } {
  return { phrase: kind === null ? null : voicePhraseFor(kind, payload) };
}
