import { getLocale, t, type Locale, type StaticTranslationKey } from '../../lib/i18n.ts';

/**
 * Voice-feedback **policy** (Phase 3b) — pure, React-free, native-free.
 *
 * This module decides *what would be said*; it never says it. The single
 * native call (`Speech.speak` / `Speech.stop`) lives in
 * `crew-feedback-native.ts`, injected as a driver into `crew-feedback.ts`.
 * Everything below therefore runs under plain `node --test` and is pinned by
 * `crew-voice.spec.ts`.
 *
 * ---
 *
 * ### Why the Hindi voice copy is written in **Latin script** (Hinglish)
 *
 * This is the load-bearing decision of the whole phase, and it is a *device*
 * decision, not a linguistic one.
 *
 * `expo-speech` is a thin shim over the OS text-to-speech engine. On the
 * budget Android handsets this app is actually used on, a `hi-IN` voice is
 * frequently **not installed** — Google's Hindi voice data is an opt-in
 * download, and a phone that has never been asked to speak Hindi does not
 * have it. Hand a Devanagari string to such a device and the engine falls
 * back to its default (usually English) voice, which either spells the
 * code points out or emits nothing at all. Either way the driver hears
 * garbage at the exact moment they needed confirmation.
 *
 * A **Latin-script Hinglish** phrase — `"Ramesh ka boarding ho gaya"` — is
 * read correctly by the *default* voice that every device has, and it is the
 * register the crew actually speaks. So the voice channel is deliberately
 * decoupled from the written one:
 *
 * | channel        | `hi` locale renders          | why                                 |
 * | -------------- | ---------------------------- | ----------------------------------- |
 * | **written UI** | Devanagari (`i18n.hi.ts`)    | it is read; the script is the point |
 * | **voice**      | Latin Hinglish (`voice.*`)   | it is heard; the engine is the point |
 *
 * Two channels, one locale. The UI locale still *selects* which voice phrase
 * is used (resolution order unchanged — see `resolveInitialLocale`), it just
 * selects from the `voice.*` namespace instead of the screen copy.
 *
 * ### Which BCP-47 tag we hand the engine
 *
 * Derived from the **script the phrase is written in**, not from the language
 * it is in — see {@link VOICE_LANGUAGE_TAG}. Both phrase sets are Latin, so
 * both ask for `en-IN`: an Indian-English voice pronounces both "Ramesh has
 * boarded" and "Ramesh ka boarding ho gaya" with the right vowels, and where
 * `en-IN` is missing the generic English fallback still produces intelligible
 * words. Asking for `hi-IN` while handing it Latin text is precisely the
 * combination that garbles.
 *
 * ### Privacy
 *
 * A bus is a public space and the speaker is on. {@link SPOKEN_STUDENT_FIELDS}
 * is the entire set of student data allowed near this module, the input types
 * below cannot express anything else, and {@link isSpeakable} is a second,
 * runtime net. See `docs/mobile-ux.md` → "Phase 3b".
 */

// ── Language ───────────────────────────────────────────────────────────────

/**
 * UI locale → the BCP-47 tag handed to the TTS engine.
 *
 * Keyed by locale so a third locale is additive, but the *value* follows the
 * script of that locale's `voice.*` phrases. Today all three phrase sets are
 * Latin (English, Hinglish, Marathi-in-Latin), so all ask for `en-IN`; a
 * future locale that ships Devanagari (or Tamil-script) voice copy would
 * change its own row here and nothing else.
 */
export const VOICE_LANGUAGE_TAG: Readonly<Record<Locale, string>> = {
  en: 'en-IN',
  hi: 'en-IN',
  mr: 'en-IN',
};

/**
 * The tag for the **active** locale, read at call time.
 *
 * Phase 3a's lesson, repeated here because it is the same trap: a
 * module-level `const lang = VOICE_LANGUAGE_TAG[getLocale()]` would freeze
 * whatever locale happened to be active at import time and never pick up a
 * language switch. `crew-voice.spec.ts` pins the switch.
 */
export function voiceLanguageTag(): string {
  return VOICE_LANGUAGE_TAG[getLocale()];
}

/**
 * Speaking rate. Slightly under natural pace: the listener is driving, the
 * cabin is noisy, and the phrase carries a name they must recognise.
 * `pitch` is deliberately left at the engine default — every device tunes its
 * own, and overriding it is how synthesised speech starts sounding wrong.
 */
export const VOICE_RATE = 0.95;

// ── Utterance ──────────────────────────────────────────────────────────────

/** Exactly what the thin native wrapper needs. Nothing else travels. */
export interface VoiceUtterance {
  text: string;
  language: string;
  rate: number;
}

// ── Privacy ────────────────────────────────────────────────────────────────

/**
 * The **only** student fields that may reach the speaker, as a value so the
 * spec can assert the list rather than trusting a comment.
 *
 * Everything else about a student is either medical, contactable or
 * identifying, and a bus is a room full of other people's children:
 * medical notes, guardian names and phone numbers, any phone number at all,
 * the free-text detail of an emergency, and the
 * full-name-plus-admission-number pair that together identify a child to a
 * stranger. None of them is expressible in the event types below.
 */
export const SPOKEN_STUDENT_FIELDS: readonly string[] = ['first_name'];

/** Field names that must never appear in — or feed — a voice payload. */
export const VOICE_DENIED_FIELDS: readonly string[] = [
  'medical_notes',
  'medical_conditions',
  'guardian_name',
  'guardian_phone',
  'guardian_email',
  'phone',
  'phone_number',
  'emergency_contact',
  'emergency_message',
  'message',
  'address',
  'admission_number',
  'last_name',
];

/** A clock reading like `7:42` — stripped before counting digits. */
const CLOCK_PATTERN = /\b\d{1,2}:\d{2}\b/g;
/** `ADM-2024-0142`, `SBT/2024/0142` — an identifier, not a word. */
const IDENTIFIER_PATTERN = /[A-Za-z]{2,}[-/]\d{3,}/;
/**
 * Digits that survive the clock strip. A spoken count ("12 students") is two
 * or three; a phone number, an admission number or a registration is six or
 * more. Six is the line.
 */
const MAX_SPOKEN_DIGITS = 5;

/**
 * Last line of defence before the engine: `false` for anything that smells
 * like identifying data. The type system already makes it hard to get here —
 * this exists because "hard" is not "impossible", and the cost of being
 * wrong is a child's phone number read aloud on a full bus.
 *
 * A rejected utterance is **dropped silently**, never spoken and never
 * thrown: the action it was confirming has already succeeded.
 */
export function isSpeakable(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (IDENTIFIER_PATTERN.test(trimmed)) return false;
  const withoutClock = trimmed.replace(CLOCK_PATTERN, ' ');
  const digits = (withoutClock.match(/\d/g) ?? []).length;
  return digits <= MAX_SPOKEN_DIGITS;
}

/**
 * First token of a name, capped.
 *
 * "Phrase = first name + action + time" is a privacy rule wearing a brevity
 * costume: a first name identifies the child *to the crew who already know
 * them* and to nobody else on the bus. Surname and admission number are what
 * turn an announcement into a record, so they are cut here — even if a caller
 * passes the full name.
 */
export function spokenFirstName(name: string): string {
  return name.trim().split(/\s+/)[0]?.slice(0, 24) ?? '';
}

// ── Time ───────────────────────────────────────────────────────────────────

/** Day-part boundaries, shared by both locales' spoken clock. */
type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

function dayPart(hours: number): DayPart {
  if (hours < 12) return 'morning';
  if (hours < 16) return 'afternoon';
  if (hours < 20) return 'evening';
  return 'night';
}

/**
 * Typed with `StaticTranslationKey` (the placeholder-free subset, same device
 * Phase 3a used for `KNOWN_ERROR_CODES`) so `t(key)` stays fully checked at a
 * runtime-resolved key — no cast, and a day-part key that gained a
 * `{placeholder}` would be a compile error here.
 */
const DAY_PART_KEY: Readonly<Record<DayPart, StaticTranslationKey>> = {
  morning: 'voice.time.morning',
  afternoon: 'voice.time.afternoon',
  evening: 'voice.time.evening',
  night: 'voice.time.night',
};

/**
 * "7:42 subah" / "7:42 morning" — a spoken clock, not a printed one.
 *
 * Deliberately not `manifest-row.ts`'s `formatClock`: "AM"/"PM" is read by a
 * TTS engine as two letters, and "ay em" after a number is noise. A day-part
 * word is what a person says.
 *
 * An absent or unparseable timestamp falls back to `voice.time.now` rather
 * than to an empty string — "Ramesh boarded, now" is true and speakable;
 * "Ramesh boarded, " is a bug you can hear.
 */
export function spokenClock(iso: string | null | undefined): string {
  if (typeof iso !== 'string' || iso.length === 0) return t('voice.time.now');
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t('voice.time.now');
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const clock = `${hours12}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${clock} ${t(DAY_PART_KEY[dayPart(hours24)])}`;
}

// ── Events ─────────────────────────────────────────────────────────────────

/**
 * Everything the crew surfaces can report.
 *
 * Note what a student event carries: a name and a timestamp. There is no
 * field for an admission number, a guardian, a phone or a note, so the
 * privacy rule is enforced by the *shape* before any scanner runs —
 * `crew-voice.spec.ts` asserts exactly that.
 */
export type CrewFeedbackEvent =
  | { type: 'board.confirmed'; firstName: string; at?: string | null }
  | { type: 'drop.confirmed'; firstName: string; at?: string | null }
  /** A board/drop the server refused, or that never left the phone. */
  | { type: 'action.rejected' }
  | { type: 'trip.boarding' }
  | { type: 'trip.inProgress' }
  | { type: 'trip.completed' }
  /** Finger down on the SOS button — the hold has started, not fired. */
  | { type: 'sos.holdStart' }
  | { type: 'sos.fired' }
  | { type: 'sos.queued' }
  | { type: 'offline.synced'; count: number }
  | { type: 'gps.on' }
  | { type: 'gps.off' };

export type CrewFeedbackEventType = CrewFeedbackEvent['type'];

/**
 * Events that are **haptic-only**, and why each one is silent:
 *
 * - `action.rejected` — the failure already raises an `Alert` carrying the
 *   server's own words. Speaking over a dialog the driver is reading is
 *   noise, and the error buzz already says "that did not work".
 * - `sos.holdStart` — the finger is still down; nothing has happened yet.
 *   The tick is the whole message.
 */
export const SILENT_EVENTS: readonly CrewFeedbackEventType[] = ['action.rejected', 'sos.holdStart'];

/**
 * Events that **bypass the throttle** entirely.
 *
 * An emergency announcement must never be swallowed by a burst of boarding
 * chatter, and it must never wait 600 ms behind it. These interrupt whatever
 * is speaking and reset the gap.
 */
export const PRIORITY_EVENTS: readonly CrewFeedbackEventType[] = ['sos.fired', 'sos.queued'];

// ── Phrases ────────────────────────────────────────────────────────────────

/**
 * The phrase for one event, in the **active** locale, built at call time.
 *
 * `null` means "say nothing" — a silent event, or a payload the privacy net
 * refused. Callers treat both identically.
 */
export function voicePhrase(event: CrewFeedbackEvent): string | null {
  if (SILENT_EVENTS.includes(event.type)) return null;
  const text = buildPhrase(event);
  if (text === null) return null;
  return isSpeakable(text) ? text : null;
}

function buildPhrase(event: CrewFeedbackEvent): string | null {
  switch (event.type) {
    case 'board.confirmed':
      return t('voice.board.done', {
        name: spokenFirstName(event.firstName),
        time: spokenClock(event.at),
      });
    case 'drop.confirmed':
      return t('voice.drop.done', {
        name: spokenFirstName(event.firstName),
        time: spokenClock(event.at),
      });
    case 'trip.boarding':
      return t('voice.trip.boarding');
    case 'trip.inProgress':
      return t('voice.trip.inProgress');
    case 'trip.completed':
      return t('voice.trip.completed');
    case 'sos.fired':
      return t('voice.sos.fired');
    case 'sos.queued':
      return t('voice.sos.queued');
    case 'offline.synced':
      return t('voice.offline.synced', { count: event.count });
    case 'gps.on':
      return t('voice.gps.on');
    case 'gps.off':
      return t('voice.gps.off');
    default:
      return null;
  }
}

/** The coalesced form of a burst: "5 students boarded". */
export function summaryPhrase(type: 'board.confirmed' | 'drop.confirmed', count: number): string {
  return type === 'board.confirmed'
    ? t('voice.board.summary', { count })
    : t('voice.drop.summary', { count });
}

/** Wraps a phrase with the language and rate the engine needs. */
export function utteranceFor(text: string): VoiceUtterance {
  return { text, language: voiceLanguageTag(), rate: VOICE_RATE };
}

// ── Throttle ───────────────────────────────────────────────────────────────

/**
 * Minimum gap between two announcements (ms).
 *
 * A whole bus boards in about a minute: forty taps, forty events. Speaking
 * all forty is unusable, and *queueing* all forty is worse — the engine would
 * still be naming the eighth child while the driver pulls away. 600 ms sits
 * in the 500–700 ms window the phase brief specifies: long enough that two
 * announcements never slur together, short enough that a single tap still
 * feels immediate.
 */
export const VOICE_MIN_GAP_MS = 600;

/**
 * The pending slot holds **one** item, ever. That is the structural answer to
 * "the queue must never grow": there is no queue, there is a slot, and a
 * second arrival either merges into it (same family → a count) or replaces it
 * (latest wins).
 */
export const VOICE_PENDING_CAPACITY = 1;

/** What the caller should do, decided purely. */
export type VoiceDecision =
  /** Interrupt whatever is speaking and say this now (`stop` → `speak`). */
  | { kind: 'speak'; utterance: VoiceUtterance }
  /** Held in the slot; call `flush()` after this many ms. */
  | { kind: 'defer'; afterMs: number }
  /** Nothing to say (silent event, privacy veto, voice disabled upstream). */
  | { kind: 'silent' };

type Coalescable = 'board.confirmed' | 'drop.confirmed';

interface PendingSlot {
  event: CrewFeedbackEvent;
  /** How many events of this family merged in (1 = just the one). */
  count: number;
}

function coalescableType(event: CrewFeedbackEvent): Coalescable | null {
  return event.type === 'board.confirmed' || event.type === 'drop.confirmed' ? event.type : null;
}

/**
 * Latest-wins interrupt with a one-slot coalescing buffer.
 *
 * The whole real-world requirement, as a state machine with an injected
 * clock — no timers, no native module, fully table-testable:
 *
 * - **first tap speaks immediately**; the driver gets instant confirmation;
 * - anything arriving inside the gap goes to the slot. Same family → the
 *   count increments and the flush becomes a summary ("12 students
 *   boarded"). Different family → it *replaces* the slot, because the newest
 *   fact is the one worth hearing;
 * - `flush(now)` is what a scheduled callback calls. It emits at most one
 *   utterance and empties the slot;
 * - priority events (SOS) skip all of it.
 *
 * Forty rapid boards therefore produce one immediate announcement plus one
 * summary per 600 ms window — measured at four for a one-second burst in
 * `crew-voice.spec.ts`, never forty, and never a backlog.
 */
export class VoiceThrottle {
  private lastSpokeAt: number | null = null;
  private pending: PendingSlot | null = null;
  /** Declared as a field, not a parameter property: `node --experimental-
   *  strip-types` (the repo's only test runner) cannot strip the latter. */
  private readonly minGapMs: number;

  constructor(minGapMs: number = VOICE_MIN_GAP_MS) {
    this.minGapMs = minGapMs;
  }

  /** Items waiting to be spoken. Asserted `<= 1` for the whole burst. */
  get pendingDepth(): number {
    return this.pending === null ? 0 : 1;
  }

  /** Whether a flush is owed (the scheduler uses this to avoid double timers). */
  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** Offer an event. Never throws, never allocates a queue. */
  offer(event: CrewFeedbackEvent, now: number): VoiceDecision {
    const phrase = voicePhrase(event);
    if (phrase === null) return { kind: 'silent' };

    if (PRIORITY_EVENTS.includes(event.type)) {
      // An emergency interrupts, and clears whatever was waiting: a boarding
      // summary announced after "SOS sent" would be actively confusing.
      this.pending = null;
      this.lastSpokeAt = now;
      return { kind: 'speak', utterance: utteranceFor(phrase) };
    }

    const sinceLast = this.lastSpokeAt === null ? Infinity : now - this.lastSpokeAt;
    if (sinceLast >= this.minGapMs && this.pending === null) {
      this.lastSpokeAt = now;
      return { kind: 'speak', utterance: utteranceFor(phrase) };
    }

    const family = coalescableType(event);
    const pendingFamily = this.pending ? coalescableType(this.pending.event) : null;
    if (family !== null && family === pendingFamily && this.pending !== null) {
      this.pending = { event, count: this.pending.count + 1 };
    } else {
      // Latest wins. The slot is one item; the previous occupant is dropped
      // on purpose, because it is now stale news.
      this.pending = { event, count: 1 };
    }

    const wait = this.lastSpokeAt === null ? this.minGapMs : this.minGapMs - sinceLast;
    return { kind: 'defer', afterMs: Math.max(0, wait) };
  }

  /**
   * Emit the slot if the gap has elapsed. Returns `null` when there is
   * nothing to say (or it is not time yet — the caller re-schedules using
   * the returned decision's `afterMs`).
   */
  flush(now: number): VoiceDecision {
    if (this.pending === null) return { kind: 'silent' };
    const sinceLast = this.lastSpokeAt === null ? Infinity : now - this.lastSpokeAt;
    if (sinceLast < this.minGapMs) {
      return { kind: 'defer', afterMs: this.minGapMs - sinceLast };
    }

    const slot = this.pending;
    this.pending = null;
    this.lastSpokeAt = now;

    const family = coalescableType(slot.event);
    const text =
      family !== null && slot.count > 1
        ? summaryPhrase(family, slot.count)
        : voicePhrase(slot.event);
    if (text === null || !isSpeakable(text)) return { kind: 'silent' };
    return { kind: 'speak', utterance: utteranceFor(text) };
  }

  /** Drop everything (logout, screen unmount). */
  reset(): void {
    this.pending = null;
    this.lastSpokeAt = null;
  }
}
