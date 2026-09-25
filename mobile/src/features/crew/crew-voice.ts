import {
  getLocale,
  t,
  type Locale,
  type StaticTranslationKey,
  type TranslationKey,
} from '../../lib/i18n.ts';

/**
 * Voice-feedback **policy** (Phase 3b; two voice modes added by batch 3C) —
 * pure, React-free, native-free.
 *
 * This module decides *what would be said*; it never says it. The single
 * native call (`Speech.speak` / `Speech.stop`) lives in
 * `crew-feedback-native.ts`, injected as a driver into `crew-feedback.ts`.
 * Everything below therefore runs under plain `node --test` and is pinned by
 * `crew-voice.spec.ts`.
 *
 * ---
 *
 * ### Two voice modes: the device decides, once (batch 3C)
 *
 * This is the load-bearing decision of the whole feature, and it is a *device*
 * decision, not a linguistic one.
 *
 * `expo-speech` is a thin shim over the OS text-to-speech engine and ships no
 * voice of its own — **free, on-device, and never a paid voice API**. What it
 * can say therefore depends entirely on what the phone has installed, and on
 * the budget Android handsets this app is used on that varies per device.
 *
 * So the phrase and the tag are chosen from the installed voices, not from the
 * locale alone:
 *
 * | device has `hi-IN` / `mr-IN` | spoken line                                 | tag               |
 * | ---------------------------- | ------------------------------------------- | ----------------- |
 * | **yes**                      | `voice.native.*` — real Devanagari           | `hi-IN` / `mr-IN` |
 * | **no**                       | `voice.*` — Latin Hinglish / Marathi-in-Latin | `en-IN`           |
 *
 * Handing Devanagari to a phone whose only voice is English is the failure
 * this design exists to avoid: the engine falls back to its default voice,
 * which either spells the code points out or emits nothing at all — garbage at
 * exactly the moment the driver needed confirmation. The Latin line is the
 * honest fallback, read correctly by the voice every device has. It is *not*
 * the only mode any more, and it never was the preference: a phone that can
 * speak Marathi now hears Marathi.
 *
 * The written UI is unaffected — it is Devanagari for `hi`/`mr` in both modes,
 * because a screen is read and a speaker is heard:
 *
 * | channel        | `hi` locale renders                                |
 * | -------------- | -------------------------------------------------- |
 * | **written UI** | Devanagari (`i18n.hi.ts`), always                  |
 * | **voice**      | Devanagari when the engine can, Latin when it can't |
 *
 * When the app's language has no voice on the device the fallback is
 * **explained**, not left to sound like a bug: {@link activeVoicePlan} reports
 * `nativeVoiceMissing`, and the Sound & vibration card shows the install hint
 * once ({@link shouldShowNativeVoiceHint}).
 *
 * ### Detection is cached — the engine is never probed per utterance
 *
 * `Speech.getAvailableVoicesAsync()` is one native round-trip and, on iOS, can
 * need a warm-up before it answers at all. It runs **once per process** in
 * `crew-feedback-native.ts` and hands the parsed result to
 * {@link configureVoiceCapabilities}. Everything after that is a `Map.get` on
 * the cached set, so an announcement costs no I/O and no UI-thread work —
 * {@link resolveVoicePlan} is pure and synchronous.
 *
 * Until the probe lands the cached set is `null`, which resolves to the Latin
 * fallback: the first announcements of a cold start are intelligible rather
 * than Devanagari-into-an-English-voice, and the hint is not shown for a state
 * we have not measured yet.
 *
 * ### Which BCP-47 tag we hand the engine
 *
 * Derived from the **script the phrase is written in** — see
 * {@link NATIVE_VOICE_TAG} and {@link FALLBACK_VOICE_TAG}, because a tag that
 * disagrees with the script is the bug in both directions: `hi-IN` with Latin
 * text garbles, and `en-IN` with Devanagari garbles. Where the probe found a
 * concrete voice we also pin its identifier ({@link VoiceUtterance.voiceId}),
 * which is what Android actually selects on (`options.voice` → `setVoice`),
 * its `language` option being region-tag-shy.
 *
 * ### Live locale, not an import-time one
 *
 * Every read of the locale happens at call time ({@link activeVoicePlan} →
 * `getLocale()`). A module-level `const` would freeze whichever language was
 * active when the bundle loaded and never pick up a switch; the spec pins the
 * switch for the phrase, the tag *and* the voice identifier.
 *
 * ### One resolver, one announcer, both roles
 *
 * The driver and the conductor share this module, the dispatcher in
 * `crew-feedback.ts` and the next-stop announcer in `next-stop-announcer.ts`.
 * There is no per-role voice code to drift.
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
 * Locale → the BCP-47 tag handed to the engine when the phone **has** a voice
 * for it, i.e. when the native-script line is what gets spoken.
 *
 * Keyed by locale so a fourth is additive: add its tag here and its
 * `voice.native.*` values, and nothing else changes.
 */
export const NATIVE_VOICE_TAG: Readonly<Record<Locale, string>> = {
  en: 'en-IN',
  hi: 'hi-IN',
  mr: 'mr-IN',
};

/**
 * The tag for the Latin-script fallback line.
 *
 * One constant on purpose: the fallback exists because the phone has no voice
 * for the locale, so the only voice guaranteed to be there is Indian English —
 * which reads "Ramesh ka boarding ho gaya" with the right vowels. Asking for
 * `hi-IN` while handing it Latin text is precisely the combination that
 * garbles, so the fallback never does.
 */
export const FALLBACK_VOICE_TAG = 'en-IN';

/** Which phrase namespace an utterance is built from. */
export type VoiceScript = 'native' | 'latin';

// ── Capability detection (cached, never per utterance) ─────────────────────

/** One installed voice, normalised from the engine's own record. */
export interface InstalledVoice {
  /** Lowercase ISO-639-1 subtag — `hi`, `mr`, `en`. */
  language: string;
  /** Uppercase region subtag when the engine reported one — `IN`. */
  region: string | null;
  /** True for an "enhanced"/high-quality voice; those are preferred. */
  enhanced: boolean;
  /** Engine voice identifier, or `null` when none was reported. */
  voiceId: string | null;
}

/**
 * What `Speech.getAvailableVoicesAsync()` hands back, typed defensively: it
 * crosses a native boundary, so every field is `unknown` until parsed.
 */
export interface EngineVoiceRecord {
  identifier?: unknown;
  language?: unknown;
  quality?: unknown;
}

/**
 * The parsed, **cached** answer to "what can this phone actually speak?".
 *
 * One `Map` keyed by language subtag, decided at parse time — so resolving a
 * plan is a lookup, never a scan, and never a native call.
 */
export interface VoiceCapabilitySet {
  bestByLanguage: ReadonlyMap<string, InstalledVoice>;
}

/**
 * Three-letter codes some Android engines report (`hin-IND`), folded onto the
 * two-letter subtags our locales use. Only our languages are mapped: an
 * unknown language is kept as reported and simply never matches a locale.
 */
const ISO3_LANGUAGE: Readonly<Record<string, string | undefined>> = {
  hin: 'hi',
  mar: 'mr',
  eng: 'en',
};

/** The region whose voice sounds right for this app's languages. */
const PREFERRED_REGION = 'IN';

function normalizeLanguageSubtag(raw: string): string {
  const lowered = raw.trim().toLowerCase();
  return ISO3_LANGUAGE[lowered] ?? lowered;
}

/** Ranks two voices of the same language; higher wins, ties keep the first. */
function voiceScore(voice: InstalledVoice): number {
  return (voice.region === PREFERRED_REGION ? 2 : 0) + (voice.enhanced ? 1 : 0);
}

/**
 * Parse an engine voice list into the cached capability set.
 *
 * Tolerant by design: a record with a missing or malformed language is
 * skipped rather than throwing, because the only thing that must never happen
 * is a phone that stops announcing. `null`/empty input yields an **empty**
 * set (not `null`) — the probe answered, and the answer was "nothing usable".
 */
export function parseVoiceCapabilities(
  records: readonly EngineVoiceRecord[] | null | undefined,
): VoiceCapabilitySet {
  const best = new Map<string, InstalledVoice>();
  for (const record of records ?? []) {
    if (typeof record?.language !== 'string') continue;
    const [rawLanguage, rawRegion] = record.language.split(/[-_]/);
    if (!rawLanguage) continue;
    const identifier = record.identifier;
    const voice: InstalledVoice = {
      language: normalizeLanguageSubtag(rawLanguage),
      region: rawRegion ? rawRegion.toUpperCase() : null,
      enhanced: record.quality === 'Enhanced',
      voiceId: typeof identifier === 'string' && identifier.length > 0 ? identifier : null,
    };
    const current = best.get(voice.language);
    if (!current || voiceScore(voice) > voiceScore(current)) best.set(voice.language, voice);
  }
  return { bestByLanguage: best };
}

let capabilities: VoiceCapabilitySet | null = null;

/**
 * Install the cached capability set. Called once per process by
 * `crew-feedback-native.ts` after its single probe; `null` restores the
 * un-probed state (specs, logout).
 */
export function configureVoiceCapabilities(next: VoiceCapabilitySet | null): void {
  capabilities = next;
}

/** The cached set, or `null` while it has not been probed. */
export function voiceCapabilities(): VoiceCapabilitySet | null {
  return capabilities;
}

// ── Plan resolution ────────────────────────────────────────────────────────

/** Everything the engine and the phrase builder need to agree on. */
export interface VoicePlan {
  locale: Locale;
  /** Which namespace the phrase is built from. */
  script: VoiceScript;
  /** BCP-47 tag handed to the engine. */
  language: string;
  /** Voice identifier to pin, or `null` to let the engine choose. */
  voiceId: string | null;
  /**
   * True when the locale needs a voice this phone was *measured* not to have —
   * the condition the install hint explains. Never true before the probe
   * (`null` capabilities), so an unmeasured phone is not told it is broken.
   */
  nativeVoiceMissing: boolean;
}

/**
 * **The one voice resolver.** Locale in, engine settings out — pure, cached
 * inputs only, no native call, so it is safe to run per utterance.
 *
 * - `en` → its own `en-IN` voice explicitly (never the engine's blind
 *   default), because "English" is the one locale with no fallback story;
 * - `hi`/`mr` with a matching installed voice → the native-script line and the
 *   native tag, i.e. real Devanagari spoken by a real Hindi/Marathi voice;
 * - `hi`/`mr` without one → the Latin line, `en-IN`, and the pin on the best
 *   English voice present, plus `nativeVoiceMissing` so the user is told;
 * - capabilities not probed yet → the same Latin fallback, without the hint.
 */
export function resolveVoicePlan(
  locale: Locale,
  installed: VoiceCapabilitySet | null,
): VoicePlan {
  const wanted = installed?.bestByLanguage.get(locale) ?? null;

  if (locale === 'en') {
    return {
      locale,
      script: 'native',
      language: NATIVE_VOICE_TAG.en,
      voiceId: wanted?.voiceId ?? null,
      nativeVoiceMissing: false,
    };
  }

  if (wanted) {
    return {
      locale,
      script: 'native',
      language: NATIVE_VOICE_TAG[locale],
      voiceId: wanted.voiceId,
      nativeVoiceMissing: false,
    };
  }

  return {
    locale,
    script: 'latin',
    language: FALLBACK_VOICE_TAG,
    voiceId: installed?.bestByLanguage.get('en')?.voiceId ?? null,
    nativeVoiceMissing: installed !== null,
  };
}

/**
 * The plan for the **active** locale, read at call time.
 *
 * Phase 3a's lesson, repeated here because it is the same trap: a
 * module-level `const plan = resolveVoicePlan(getLocale(), …)` would freeze
 * whichever locale happened to be active at import time and never pick up a
 * language switch. `crew-voice.spec.ts` pins the switch.
 */
export function activeVoicePlan(): VoicePlan {
  return resolveVoicePlan(getLocale(), capabilities);
}

/** The tag for the **active** locale and the active capability set. */
export function voiceLanguageTag(): string {
  return activeVoicePlan().language;
}

/**
 * Each locale's self-designation, in its own script — the `{language}` of the
 * install hint. Reuses the switcher's invariant keys, so the hint says
 * "हिन्दी"/"मराठी" in every UI language, which is what a support call needs.
 */
const LOCALE_SELF_NAME_KEY: Readonly<Record<Locale, StaticTranslationKey>> = {
  en: 'settings.language.nameEn',
  hi: 'settings.language.nameHi',
  mr: 'settings.language.nameMr',
};

/** The active locale's own name, for the install hint's `{language}`. */
export function languageSelfName(locale: Locale = getLocale()): string {
  return t(LOCALE_SELF_NAME_KEY[locale]);
}

/**
 * Whether the Sound & vibration card should show the install hint.
 *
 * One boolean of policy so the "once" is a rule rather than a component's
 * mood: the phone must have been *measured* to lack the active locale's voice,
 * and the crew member must not have dismissed it for this session.
 */
export function shouldShowNativeVoiceHint(
  plan: Pick<VoicePlan, 'nativeVoiceMissing'>,
  dismissed: boolean,
): boolean {
  return plan.nativeVoiceMissing && !dismissed;
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
  /**
   * Engine voice identifier to pin, or `null` to let the engine choose from
   * `language`. Only ever an identifier this process read from
   * `Speech.getAvailableVoicesAsync()` — iOS *throws* on an unknown one, so
   * inventing or caching one across processes is not an option.
   */
  voiceId: string | null;
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

/** Cap on a spoken stop name — see {@link spokenStopName}. */
export const SPOKEN_STOP_NAME_MAX = 32;

/**
 * A stop name, squeezed and capped.
 *
 * A stop is school data, not student data, so nothing here is private — the
 * {@link SPOKEN_STUDENT_FIELDS} rule is untouched. This is about hearing: an
 * announcement is "stop + count", and a 60-character name pushes the count
 * off the end of the sentence the conductor needed. Internal whitespace is
 * collapsed because a double space is where an engine starts reading
 * punctuation aloud.
 */
export function spokenStopName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, SPOKEN_STOP_NAME_MAX);
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
 * The spoken-clock words, as native/Latin pairs.
 *
 * Typed with `StaticTranslationKey` (the placeholder-free subset, same device
 * Phase 3a used for `KNOWN_ERROR_CODES`) so `t(key)` stays fully checked at a
 * runtime-resolved key — no cast, and a clock word that gained a
 * `{placeholder}` would be a compile error here.
 *
 * A pair per row because the day-part word is part of the sentence: "7:42
 * सुबह" through an `hi-IN` voice and "7:42 subah" through `en-IN` are the two
 * modes, and mixing them is how a phrase starts sounding half-translated.
 */
type ClockWord = DayPart | 'now';

const CLOCK_WORD_KEY: Readonly<Record<ClockWord, Record<VoiceScript, StaticTranslationKey>>> = {
  now: { native: 'voice.native.time.now', latin: 'voice.time.now' },
  morning: { native: 'voice.native.time.morning', latin: 'voice.time.morning' },
  afternoon: { native: 'voice.native.time.afternoon', latin: 'voice.time.afternoon' },
  evening: { native: 'voice.native.time.evening', latin: 'voice.time.evening' },
  night: { native: 'voice.native.time.night', latin: 'voice.time.night' },
};

/**
 * "7:42 subah" / "7:42 सुबह" / "7:42 in the morning" — a spoken clock, not a
 * printed one.
 *
 * Deliberately not `manifest-row.ts`'s `formatClock`: "AM"/"PM" is read by a
 * TTS engine as two letters, and "ay em" after a number is noise. A day-part
 * word is what a person says.
 *
 * `script` defaults to the active plan's, resolved **at call time** — so a
 * language switch or a late-landing capability probe changes the next clock
 * word, never a frozen one.
 *
 * An absent or unparseable timestamp falls back to `voice.*.time.now` rather
 * than to an empty string — "Ramesh boarded, now" is true and speakable;
 * "Ramesh boarded, " is a bug you can hear.
 */
export function spokenClock(
  iso: string | null | undefined,
  script: VoiceScript = activeVoicePlan().script,
): string {
  if (typeof iso !== 'string' || iso.length === 0) return t(CLOCK_WORD_KEY.now[script]);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t(CLOCK_WORD_KEY.now[script]);
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const clock = `${hours12}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${clock} ${t(CLOCK_WORD_KEY[dayPart(hours24)][script])}`;
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
  | { type: 'gps.off' }
  /**
   * Next-stop announcements (batch 3C), for **both** crew roles.
   *
   * What a stop event carries is a stop name and an aggregate count — the two
   * facts the crew need before the doors open. There is no field for a
   * student, so {@link SPOKEN_STUDENT_FIELDS} is unchanged: a name-per-child
   * announcement of who is waiting at the next stop would put four children's
   * names on a speaker, and the manifest screen already shows them.
   */
  | { type: 'stop.next'; stopName: string; studentCount: number }
  /** The same stop, said again because the bus is nearly there. */
  | { type: 'stop.approaching'; stopName: string; studentCount: number }
  /**
   * Proximity alert (N7): the server's own `distance_meters` has crossed the
   * near threshold (~300 m) — doors-soon territory. The sequence number is
   * the stop's own position on the route ("Stop 4 aa raha hai"), never
   * student data; `null` never fires (see `next-stop-announcer.ts`).
   */
  | { type: 'stop.near'; stopName: string; studentCount: number; sequenceNumber: number | null };

export type CrewFeedbackEventType = CrewFeedbackEvent['type'];

/** The next-stop announcement types, as a value for specs to assert on. */
export const STOP_ANNOUNCEMENT_EVENTS: readonly CrewFeedbackEventType[] = [
  'stop.next',
  'stop.approaching',
  'stop.near',
];

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
 * The phrase for one event, in the **active** locale and the **active** voice
 * mode, both resolved at call time.
 *
 * `null` means "say nothing" — a silent event, or a payload the privacy net
 * refused. Callers treat both identically.
 */
export function voicePhrase(event: CrewFeedbackEvent): string | null {
  if (SILENT_EVENTS.includes(event.type)) return null;
  const text = buildPhrase(event, activeVoicePlan().script);
  if (text === null) return null;
  return isSpeakable(text) ? text : null;
}

/**
 * Picks the dictionary row for the script in use.
 *
 * Generic over the two literal keys so the result stays a **union of
 * literals** — that is what keeps `t()`'s placeholder inference exact at a
 * runtime-chosen key (the same device `StaticTranslationKey` provides for the
 * placeholder-free ones). Both rows of a pair carry the same placeholders;
 * `crew-voice.spec.ts` asserts that per pair, in every locale.
 */
function voiceLine<N extends TranslationKey, L extends TranslationKey>(
  script: VoiceScript,
  native: N,
  latin: L,
): N | L {
  return script === 'native' ? native : latin;
}

function buildPhrase(event: CrewFeedbackEvent, script: VoiceScript): string | null {
  switch (event.type) {
    case 'board.confirmed':
      return t(voiceLine(script, 'voice.native.board.done', 'voice.board.done'), {
        name: spokenFirstName(event.firstName),
        time: spokenClock(event.at, script),
      });
    case 'drop.confirmed':
      return t(voiceLine(script, 'voice.native.drop.done', 'voice.drop.done'), {
        name: spokenFirstName(event.firstName),
        time: spokenClock(event.at, script),
      });
    case 'trip.boarding':
      return t(voiceLine(script, 'voice.native.trip.boarding', 'voice.trip.boarding'));
    case 'trip.inProgress':
      return t(voiceLine(script, 'voice.native.trip.inProgress', 'voice.trip.inProgress'));
    case 'trip.completed':
      return t(voiceLine(script, 'voice.native.trip.completed', 'voice.trip.completed'));
    case 'sos.fired':
      return t(voiceLine(script, 'voice.native.sos.fired', 'voice.sos.fired'));
    case 'sos.queued':
      return t(voiceLine(script, 'voice.native.sos.queued', 'voice.sos.queued'));
    case 'offline.synced':
      return t(voiceLine(script, 'voice.native.offline.synced', 'voice.offline.synced'), {
        count: event.count,
      });
    case 'gps.on':
      return t(voiceLine(script, 'voice.native.gps.on', 'voice.gps.on'));
    case 'gps.off':
      return t(voiceLine(script, 'voice.native.gps.off', 'voice.gps.off'));
    case 'stop.next':
    case 'stop.approaching':
      return stopPhrase(event, script);
    case 'stop.near':
      return stopNearPhrase(event, script);
    default:
      return null;
  }
}

/**
 * "Next stop: Shivaji Chowk, 12 students" — and the approaching variant of the
 * same two facts.
 *
 * `null` when the stop has no usable name, for the reason `spokenClock` falls
 * back to "now" instead of "": an announcement with a hole in it is a bug you
 * can hear. The announcer refuses to fire without a name too
 * (`next-stop-announcer.ts`); this is the second net.
 */
function stopPhrase(
  event: Extract<CrewFeedbackEvent, { type: 'stop.next' } | { type: 'stop.approaching' }>,
  script: VoiceScript,
): string | null {
  const name = spokenStopName(event.stopName);
  if (name.length === 0) return null;
  const params = { name, count: event.studentCount };
  return event.type === 'stop.next'
    ? t(voiceLine(script, 'voice.native.stop.next', 'voice.stop.next'), params)
    : t(voiceLine(script, 'voice.native.stop.approaching', 'voice.stop.approaching'), params);
}

/**
 * "Stop 4 aa raha hai, 5 bachche" — the doors-soon proximity line.
 *
 * Spoken by **stop number**, because that is what a driver matches against the
 * route sheet and the "Stop 4 of 8" on the card — the name is on the screen
 * the moment the phone buzzes. `null` when the number is unknown (a stop
 * missing from the route list has no trustworthy position on it): the
 * announcer never fires this event without one (`next-stop-announcer.ts`);
 * this is the second net, same as `stopPhrase`'s empty-name net.
 */
function stopNearPhrase(
  event: Extract<CrewFeedbackEvent, { type: 'stop.near' }>,
  script: VoiceScript,
): string | null {
  const number = event.sequenceNumber;
  if (number === null || !Number.isInteger(number) || number < 1) return null;
  return t(voiceLine(script, 'voice.native.stop.near', 'voice.stop.near'), {
    number,
    count: event.studentCount,
  });
}

/**
 * The coalesced form of a burst: "5 students boarded".
 *
 * `script` defaults to the active plan's, resolved when the flush happens —
 * which is the moment the sentence is actually built.
 */
export function summaryPhrase(
  type: 'board.confirmed' | 'drop.confirmed',
  count: number,
  script: VoiceScript = activeVoicePlan().script,
): string {
  return type === 'board.confirmed'
    ? t(voiceLine(script, 'voice.native.board.summary', 'voice.board.summary'), { count })
    : t(voiceLine(script, 'voice.native.drop.summary', 'voice.drop.summary'), { count });
}

/** Wraps a phrase with the language, voice and rate the engine needs. */
export function utteranceFor(text: string): VoiceUtterance {
  const plan = activeVoicePlan();
  return { text, language: plan.language, voiceId: plan.voiceId, rate: VOICE_RATE };
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
