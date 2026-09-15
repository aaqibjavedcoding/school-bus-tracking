import { CREW_LOCALE_ROLES } from '../../lib/i18n.ts';
import {
  VOICE_MAX_ANNOUNCEMENTS_PER_BURST,
  VoiceGate,
  isSpeakable,
  voicePrivacyViolations,
  type VoiceDecision,
  type VoiceEventKind,
  type VoicePayload,
} from './crew-voice.ts';
import { hapticsFor, type HapticsEventKind, type HapticsPattern } from './crew-haptics.ts';

/**
 * The crew feedback dispatcher (Phase 3b) — **one module, one mapping.**
 *
 * Phase 3b could have shipped `crew-voice.ts` and `crew-haptics.ts` as two
 * things call sites import separately. It deliberately does not: the two
 * channels confirm the *same* event, and splitting the dispatch would mean
 * every integration point (`ManifestList`, `TripStatusActions`, `SosPanel`,
 * `GpsShareStrip`, `OfflineSyncBanner`) has to remember to call both, in the
 * right order, with the same enabled flags. Instead:
 *
 * - `crew-voice.ts` and `crew-haptics.ts` stay **pure per-channel rules**
 *   (which phrase / which pattern), each with its own spec;
 * - **this** module is the only event→feedback mapping and the only place that
 *   touches the adapters, so "what does a board confirm do?" has exactly one
 *   answer in the codebase;
 * - integration points call one thing: `feedback.on('board.done', payload)`.
 *
 * The native calls themselves live in `crew-feedback.native.ts` — the only
 * file in the feature that imports `expo-speech` / `expo-haptics` /
 * `react-native` / AsyncStorage — and are injected here through
 * {@link configureFeedbackAdapters}, the same seam `i18n.ts` uses for its
 * store. That keeps every rule below testable under plain `node --test`.
 *
 * ### Two hard rules, both spec-pinned
 *
 * 1. **Voice never blocks and never fails an action.** Nothing here is
 *    `async`, nothing `await`s, and no speech/haptic call's outcome reaches a
 *    caller. `Speech.speak` throwing is swallowed (see the adapter contract):
 *    a board that was recorded on the server is recorded whether or not the
 *    phone could say so. `crew-feedback.spec.ts` asserts the identical action
 *    result with a throwing adapter, and a source scan asserts there is no
 *    `await` on the feedback path at all.
 * 2. **Off means zero native calls.** Both channels check their flag inside
 *    the pure modules, so a disabled channel produces no adapter call of any
 *    kind — proven by spies, in both directions.
 */

// ── Events ────────────────────────────────────────────────────────────────

/**
 * Everything the crew app can ask the feedback layer to confirm. Superset of
 * the spoken events: the SOS hold tick and a settings toggle vibrate but say
 * nothing (a hold is a motor gesture, a toggle is on-screen).
 */
export type CrewFeedbackEvent = VoiceEventKind | 'sos.hold' | 'sos.failed' | 'toggle';

/** Events with a spoken form. Anything else is haptics-only. */
const VOICE_CAPABLE: ReadonlySet<CrewFeedbackEvent> = new Set<CrewFeedbackEvent>([
  'board.done',
  'board.queued',
  'board.summary',
  'drop.done',
  'drop.queued',
  'drop.summary',
  'trip.boarding',
  'trip.inProgress',
  'trip.completed',
  'sos.sent',
  'sos.queued',
  'sync.done',
  'gps.on',
  'gps.off',
  'action.failed',
  'action.conflict',
  'test',
]);

/**
 * The vibration for each event, exhaustively. `null` = "this event has no
 * haptic" — the two summary phrases, which follow a burst the crew member
 * already felt one tap at a time.
 *
 * An exhaustive `Record` on purpose: adding a `CrewFeedbackEvent` without
 * deciding its vibration is a **compile** error here, not a silent no-op at
 * runtime.
 */
const HAPTICS_EVENT: Readonly<Record<CrewFeedbackEvent, HapticsEventKind | null>> = {
  'board.done': 'board.done',
  'board.queued': 'board.queued',
  'board.summary': null,
  'drop.done': 'drop.done',
  'drop.queued': 'drop.queued',
  'drop.summary': null,
  'trip.boarding': 'trip.boarding',
  'trip.inProgress': 'trip.inProgress',
  'trip.completed': 'trip.completed',
  'sos.sent': 'sos.sent',
  'sos.queued': 'sos.queued',
  'sos.failed': 'sos.failed',
  'sos.hold': 'sos.hold',
  'sync.done': 'sync.done',
  'gps.on': 'gps.on',
  'gps.off': 'gps.off',
  'action.failed': 'action.failed',
  'action.conflict': 'action.conflict',
  toggle: 'toggle',
  test: 'test',
};

// ── Preferences ───────────────────────────────────────────────────────────

export interface FeedbackPreferences {
  /** Spoken confirmations (`expo-speech`). */
  voice: boolean;
  /** Vibration (`expo-haptics`). */
  vibration: boolean;
}

/** AsyncStorage key — the Phase-3a persistence pattern, reused verbatim. */
export const FEEDBACK_STORAGE_KEY = 'sbt.mobile.feedback';

/**
 * Role defaults.
 *
 * Crew (DRIVER/CONDUCTOR — the same role list the locale rule uses, imported
 * rather than duplicated) get **both** channels on: they are the people who
 * cannot look at a screen. `SCHOOL_ADMIN`/`PARENT` get **voice off** — their
 * surfaces are also used at a desk, where an app announcing "Ramesh boarded"
 * is noise, not information — and vibration on, which is unobtrusive.
 *
 * An explicit saved choice always wins over this, exactly like the locale
 * preference does.
 */
export function feedbackDefaultsForRole(role: string | null): FeedbackPreferences {
  if (role !== null && CREW_LOCALE_ROLES.includes(role)) {
    return { voice: true, vibration: true };
  }
  return { voice: false, vibration: true };
}

/**
 * The pre-boot state: **voice off**. Nothing is known about the signed-in
 * role until the auth provider resolves, and "the office app chirped at me"
 * is the failure worth avoiding — so the default fails quiet and the crew
 * default is applied (and persisted) the moment a crew role is seen.
 */
export const INITIAL_FEEDBACK_PREFERENCES: FeedbackPreferences = {
  voice: false,
  vibration: true,
};

// ── Adapters (the native seam) ────────────────────────────────────────────

export interface VoiceSpeakOptions {
  language: string;
  rate: number;
  pitch: number;
  /** Called when the utterance ends, is interrupted or errors. */
  onSettled: () => void;
}

/**
 * The speech seam. **Contract:** `speak` must be fire-and-forget and must
 * never throw out to the caller; `stop` must not be awaited. The production
 * implementation (`crew-feedback.native.ts`) wraps `expo-speech` accordingly.
 */
export interface VoiceAdapter {
  stop(): void;
  speak(text: string, options: VoiceSpeakOptions): void;
}

/** The haptics seam — every method fire-and-forget, none may throw. */
export interface HapticsAdapter {
  impact(style: 'light' | 'medium'): void;
  notification(type: 'success' | 'warning' | 'error'): void;
  selection(): void;
}

export interface FeedbackAdapters {
  voice: VoiceAdapter | null;
  haptics: HapticsAdapter | null;
}

// ── Persistence (injected) ────────────────────────────────────────────────

export interface FeedbackStore {
  read(): Promise<string | null>;
  write(prefs: FeedbackPreferences): Promise<void>;
}

// ── Result of one dispatch ────────────────────────────────────────────────

export interface FeedbackDispatch {
  /** What the voice channel decided (`null` = silent). */
  voice: VoiceDecision | null;
  /** What the haptics channel decided (`null` = no vibration). */
  haptics: HapticsPattern | null;
  /** True when a phrase was withheld by the privacy deny-list. */
  mutedForPrivacy: boolean;
}

const NO_DISPATCH: FeedbackDispatch = { voice: null, haptics: null, mutedForPrivacy: false };

// ── The dispatcher ────────────────────────────────────────────────────────

type PreferenceListener = (prefs: FeedbackPreferences) => void;

/**
 * The crew feedback service. One instance is exported as {@link feedback};
 * specs build their own with an injected clock.
 */
export class CrewFeedback {
  private adapters: FeedbackAdapters = { voice: null, haptics: null };
  private store: FeedbackStore | null = null;
  private prefs: FeedbackPreferences = { ...INITIAL_FEEDBACK_PREFERENCES };
  private explicitChoice = false;
  private gate = new VoiceGate();
  private listeners = new Set<PreferenceListener>();
  /** Names of the deny-list rules that muted a phrase (support/debug only). */
  private muted: string[] = [];
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  // -- wiring -------------------------------------------------------------

  configureAdapters(adapters: FeedbackAdapters | null): void {
    this.adapters = adapters ?? { voice: null, haptics: null };
  }

  configureStore(store: FeedbackStore | null): void {
    this.store = store;
  }

  /** Current effective preferences (a copy — callers must not mutate it). */
  get preferences(): FeedbackPreferences {
    return { ...this.prefs };
  }

  /** True once a preference came from storage or a user toggle. */
  get hasExplicitChoice(): boolean {
    return this.explicitChoice;
  }

  setPreferences(next: Partial<FeedbackPreferences>, options: { persist?: boolean } = {}): void {
    this.prefs = { ...this.prefs, ...next };
    this.explicitChoice = true;
    if (options.persist !== false) void this.persist();
    for (const listener of [...this.listeners]) listener(this.preferences);
  }

  /**
   * Apply the role default on first sight of a signed-in role — never
   * overwriting an explicit choice, and never persisted as one (so a later
   * deliberate switch still wins). Mirrors `useRoleLocaleDefault`.
   */
  applyRoleDefault(role: string | null): void {
    if (this.explicitChoice || role === null) return;
    const defaults = feedbackDefaultsForRole(role);
    if (defaults.voice === this.prefs.voice && defaults.vibration === this.prefs.vibration) return;
    this.prefs = defaults;
    for (const listener of [...this.listeners]) listener(this.preferences);
  }

  subscribe(listener: PreferenceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Cold start: read the saved preference. Never throws, never blocks. */
  async loadPersisted(): Promise<FeedbackPreferences> {
    if (!this.store) return this.preferences;
    try {
      const raw = await this.store.read();
      const parsed = parsePreferences(raw);
      if (parsed) {
        this.prefs = parsed;
        this.explicitChoice = true;
        for (const listener of [...this.listeners]) listener(this.preferences);
      }
    } catch {
      // An unreadable preference falls back to the defaults — a settings screen
      // must never crash the app at boot.
    }
    return this.preferences;
  }

  /** The utterance ended / was interrupted / errored. */
  settleVoice(): void {
    this.gate.settle();
  }

  /** The throttle's whole state, for specs and for the support screen. */
  voiceSnapshot() {
    return this.gate.snapshot();
  }

  // -- dispatch -----------------------------------------------------------

  /**
   * Confirm one event. **Synchronous, never throws, returns immediately.**
   *
   * The returned record is what the channel rules decided — specs assert on
   * it; production ignores it. Nothing here is awaited by a caller and no
   * failure can propagate (see the module note).
   */
  on(kind: CrewFeedbackEvent, payload: VoicePayload = null): FeedbackDispatch {
    try {
      return this.dispatch(kind, payload);
    } catch {
      // The feedback layer is decoration. If anything in it throws — a missing
      // native module, a dictionary hole, a bad payload — the crew action that
      // triggered it still stands.
      return { ...NO_DISPATCH };
    }
  }

  private dispatch(kind: CrewFeedbackEvent, payload: VoicePayload): FeedbackDispatch {
    const now = this.now();
    const hapticsKind = HAPTICS_EVENT[kind];
    const haptics = hapticsKind === null ? null : hapticsFor(hapticsKind, this.prefs.vibration);
    this.applyHaptics(haptics);

    if (!this.prefs.voice || !VOICE_CAPABLE.has(kind)) {
      return { voice: null, haptics, mutedForPrivacy: false };
    }

    // `sync.done` is the drain point: when the offline queue lands, "40
    // students boarded" says strictly more than "actions synced", and the
    // crew member is already watching the banner clear. One phrase, not two
    // fighting for the speaker.
    if (kind === 'sync.done') {
      const summary = this.gate.drainSummary(now, this.prefs.voice);
      if (summary) {
        this.applyVoice(summary);
        return { voice: summary, haptics, mutedForPrivacy: false };
      }
    }

    const decision = this.gate.decide(kind as VoiceEventKind, payload, now);
    if (decision.action === 'suppress') {
      return { voice: null, haptics, mutedForPrivacy: false };
    }
    this.applyVoice(decision);
    return { voice: decision, haptics, mutedForPrivacy: false };
  }

  /**
   * Say the owed summary now (the UI can call this when a boarding wave
   * ends). Returns `null` when nothing is owed.
   */
  flushSummary(): VoiceDecision | null {
    const decision = this.gate.drainSummary(this.now(), this.prefs.voice);
    if (decision) this.applyVoice(decision);
    return decision;
  }

  /** Forget the burst budget — a new boarding wave starts fresh. */
  resetVoice(): void {
    this.gate.reset();
  }

  private applyVoice(decision: VoiceDecision): void {
    const adapter = this.adapters.voice;
    if (!adapter || decision.phrase === null) return;
    // Privacy is checked on the FINAL string, not on the inputs: a dictionary
    // edit that smuggled a phone-shaped token into a phrase would still be
    // stopped here. The violation is dropped silently — logging it would put
    // the very data we refused to speak into a log.
    if (!isSpeakable(decision.phrase)) {
      this.muted.push(...voicePrivacyViolations(decision.phrase));
      return;
    }
    if (decision.action === 'interrupt') adapter.stop();
    adapter.speak(decision.phrase, {
      language: decision.language,
      rate: decision.rate,
      pitch: decision.pitch,
      onSettled: () => this.settleVoice(),
    });
  }

  get mutedByPrivacy(): readonly string[] {
    return [...this.muted];
  }

  private applyHaptics(pattern: HapticsPattern | null): void {
    const adapter = this.adapters.haptics;
    if (!adapter || pattern === null) return;
    if (pattern.call === 'impact') adapter.impact(pattern.style);
    else if (pattern.call === 'notification') adapter.notification(pattern.type);
    else adapter.selection();
  }

  private async persist(): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.write(this.prefs);
    } catch {
      // The in-memory switch already happened; a failed write only means the
      // choice does not survive a cold start.
    }
  }
}

/** Parse a stored preference blob. Anything unrecognised → `null` (defaults). */
export function parsePreferences(raw: string | null): FeedbackPreferences | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.voice !== 'boolean' || typeof record.vibration !== 'boolean') return null;
    return { voice: record.voice, vibration: record.vibration };
  } catch {
    return null;
  }
}

/** The one instance the app dispatches through. */
export const feedback = new CrewFeedback();

/** Convenience wrappers so call sites read as intent, not configuration. */
export const configureFeedbackAdapters = (adapters: FeedbackAdapters | null): void =>
  feedback.configureAdapters(adapters);
export const configureFeedbackStore = (store: FeedbackStore | null): void =>
  feedback.configureStore(store);

/** The burst cap, re-exported so the acceptance criteria quote one number. */
export const MAX_ANNOUNCEMENTS_PER_BURST = VOICE_MAX_ANNOUNCEMENTS_PER_BURST;
