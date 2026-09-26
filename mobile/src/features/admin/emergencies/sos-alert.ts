import {
  EMERGENCY_EVENTS,
  EMERGENCY_TYPE_LABELS,
  EmergencyStatus,
  EmergencyType,
  UserRole,
  type EmergencyEventResponse,
} from '@school-bus-tracking/shared-types';

/**
 * School-admin SOS **alert loop** (mobile) — the phone-side counterpart of
 * the web console's siren (`web/src/features/emergencies/emergency-alarm.ts`).
 *
 * When a driver or conductor presses SOS, the API broadcasts `emergency:new`
 * into the tenant's own `/emergencies` room. The web shell turns that frame
 * into a repeating Web-Audio siren. The mobile app never had one: an admin
 * whose phone is in their hand got a single generic push beep, identical to
 * every other notification, and nothing more. This module closes that gap
 * with the hardware the app **already** ships — `expo-haptics` and
 * `expo-speech` — because a bundled siren sound would need `expo-av` /
 * `expo-audio`, and those packages require a native rebuild that is out of
 * scope for this pass (see `docs/mobile-ux.md` → "Admin SOS alert loop").
 *
 * What an unacknowledged SOS therefore does on an admin phone (foreground
 * only, `SCHOOL_ADMIN` only):
 *
 * - a **haptic burst** every few seconds — the same `Error` notification
 *   pattern the crew app reserves for "that did not happen", urgent and
 *   unmistakable over road noise;
 * - a **short spoken alert** every ~10 s ("Emergency alert. Bus MH-12…"),
 *   throttled so an unattended phone reads as insistent, not broken;
 * - a **safety cap** after which the loop quiets down, so a phone left on a
 *   desk does not buzz for hours — the next SOS re-arms it;
 * - an explicit **mute** that cuts sound and vibration immediately without
 *   touching the emergency itself (the banner stays — muting must never
 *   hide the incident).
 *
 * Acknowledging, resolving or cancelling the emergency stops its loop the
 * same instant, exactly like the web alarm's `silence`.
 *
 * ### Why this file is pure
 *
 * The module never imports `expo-haptics`, `expo-speech`, React or
 * `react-native`. It decides *when* the loop runs and *what* would be said;
 * the native calls live behind {@link SosAlertDrivers}, installed once by
 * `sos-alert-native.ts` (a no-op on web). That is the same seam the crew
 * feedback layer uses (`crew-feedback.ts` / `crew-feedback-native.ts`), for
 * the same reason: every rule below runs under plain `node --test` in
 * `sos-alert.spec.ts`, and "muted ⇒ zero native calls" is a provable
 * statement here rather than a review habit.
 */

/** Cadence and cap of the loop, deliberately loud but not endless. */
export const SOS_ALERT_CONFIG = {
  /** One vibration burst every this-many ms while an SOS stays unanswered. */
  hapticIntervalMs: 3_500,
  /**
   * Spoken-alert cadence. Rare on purpose: a spoken line every few seconds
   * in a school office reads as a malfunction; ~10 s reads as insistent.
   */
  speechIntervalMs: 10_000,
  /**
   * Safety cap of one episode: an SOS nobody reacts to goes quiet after
   * this long. A *new* SOS (or an explicit un-mute) starts a new episode.
   */
  maxAlertDurationMs: 5 * 60_000,
} as const;

/**
 * The emergency an alert is raised for, reduced to what the loop speaks.
 * The id doubles as the de-duplication key of the loop.
 */
export interface SosAlertEvent {
  id: string;
  /** Human label of the emergency type ("Medical emergency"). */
  typeLabel: string;
  busRegistrationNumber: string | null;
  routeName: string | null;
}

/** What the loop is doing right now, for the banner and the mute control. */
export type SosAlertLoopStatus =
  /** No unacknowledged emergencies. */
  | 'idle'
  /** Haptics + speech loop is running. */
  | 'alerting'
  /** The admin silenced the loop; the banner stays. */
  | 'muted'
  /** Active emergencies exist but the loop is quiet: the app is backgrounded or the safety cap was reached. */
  | 'quiet';

export interface SosAlertSnapshot {
  status: SosAlertLoopStatus;
  /** Unacknowledged emergencies the loop is (or would be) reporting. */
  activeCount: number;
  muted: boolean;
  /** Last contained driver failure — surfaced, never swallowed silently. */
  lastError: string | null;
}

/**
 * The entire native surface of the alert: one vibration, one spoken line,
 * one way to cut speech short. Every call is fire-and-forget and wrapped —
 * a device without a TTS engine costs the loop nothing but a no-op.
 */
export interface SosAlertDrivers {
  vibrate(): void;
  speak(text: string): void;
  stopSpeaking(): void;
}

/** Timer surface, injected so the cadence is testable without waiting. */
export interface SosAlertScheduler {
  setTimeout(handler: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Built-in drivers: zero sound, zero vibration (web, tests, pre-install). */
export const NOOP_SOS_ALERT_DRIVERS: SosAlertDrivers = {
  vibrate: () => undefined,
  speak: () => undefined,
  stopSpeaking: () => undefined,
};

/**
 * The one role the loop exists for.
 *
 * A driver's or conductor's own device is joined to the same tenant room by
 * the gateway, but the crew member who raised the SOS already knows — their
 * phone stays silent, exactly as their web session does. Gate kept as a
 * named function so the rule is pinned by spec, not by habit.
 */
export function sosAlertEnabledForRole(role: string | null | undefined): boolean {
  return role === UserRole.SCHOOL_ADMIN;
}

/**
 * The runtime rule for the loop itself: **when it runs and when it stops.**
 *
 * Runs only while ALL hold:
 *
 * - `activeCount > 0` — there is an unacknowledged SOS to report (a status
 *   change away from OPEN removes it, which is why acknowledging stops the
 *   noise the same instant);
 * - `appActive` — the app is in the foreground. A backgrounded phone keeps
 *   its hands still: no timers, no vibration, no speech — nothing that
 *   risks a crash or a confused "who is talking"; the OS push notification
 *   already covered the from-scratch wake-up;
 * - `!muted` — the admin's explicit silence control (the web console's
 *   "Mute" counterpart);
 * - `withinDurationCap` — the unattended safety cap has not been reached.
 *
 * The role gate is separate ({@link sosAlertEnabledForRole}): the hook
 * decides *whether this session may alert at all*, this function decides
 * *whether the loop makes noise at this moment*.
 */
export interface SosAlertLoopGate {
  appActive: boolean;
  muted: boolean;
  activeCount: number;
  withinDurationCap: boolean;
}

export function shouldSosAlertLoopRun(gate: SosAlertLoopGate): boolean {
  return gate.activeCount > 0 && gate.appActive && !gate.muted && gate.withinDurationCap;
}

/**
 * What one realtime frame means for the loop — the mobile counterpart of
 * the web's `alarmDecisionFor`.
 *
 * - `raise` — a crew member raised a new, still-OPEN SOS;
 * - `silence` — that SOS left OPEN (acknowledged / resolved / cancelled);
 * - `ignore` — anything else: an update that keeps it OPEN, a replayed
 *   stale `emergency:new`, a normal notification, a malformed frame.
 */
export type SosAlertFrameDecision =
  | { action: 'ignore' }
  | { action: 'raise'; event: SosAlertEvent }
  | { action: 'silence'; id: string };

const IGNORE: SosAlertFrameDecision = { action: 'ignore' };

/**
 * Reads an `emergency:new` / `emergency:updated` payload defensively.
 * Returns `null` for anything that is not an emergency event — a malformed
 * frame must never start the loop, and never throw inside somebody else's
 * notification handler.
 */
export function normalizeSosAlertEvent(payload: unknown):
  | (SosAlertEvent & {
      status: EmergencyStatus;
    })
  | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const raw = payload as Partial<EmergencyEventResponse> & Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    return null;
  }
  if (raw.status === undefined || !Object.values(EmergencyStatus).includes(raw.status)) {
    return null;
  }
  const type = Object.values(EmergencyType).includes(raw.type as EmergencyType)
    ? (raw.type as EmergencyType)
    : null;
  const typeLabel =
    typeof raw.type_label === 'string' && raw.type_label.length > 0
      ? raw.type_label
      : type
        ? (EMERGENCY_TYPE_LABELS[type] ?? 'Emergency')
        : 'Emergency';
  return {
    id: raw.id,
    status: raw.status,
    typeLabel,
    busRegistrationNumber:
      typeof raw.bus_registration_number === 'string' ? raw.bus_registration_number : null,
    routeName: typeof raw.route_name === 'string' ? raw.route_name : null,
  };
}

/**
 * Classifies one realtime frame for the loop. Only `emergency:new` carrying
 * a still-`OPEN` event can ever raise it; a status change away from `OPEN`
 * silences that event; everything else is ignored.
 */
export function sosAlertFrameDecision(eventName: unknown, payload: unknown): SosAlertFrameDecision {
  if (eventName !== EMERGENCY_EVENTS.new && eventName !== EMERGENCY_EVENTS.updated) {
    return IGNORE;
  }

  const event = normalizeSosAlertEvent(payload);
  if (!event) {
    return IGNORE;
  }

  if (eventName === EMERGENCY_EVENTS.new) {
    // A brand-new SOS is always OPEN; anything else is a stale replay and
    // is not worth waking the office for.
    return event.status === EmergencyStatus.OPEN ? { action: 'raise', event } : IGNORE;
  }

  return event.status === EmergencyStatus.OPEN ? IGNORE : { action: 'silence', id: event.id };
}

/**
 * The spoken line, built from the newest active event.
 *
 * One event: "Emergency alert. Bus MH-12 AB-3456, route Palava — medical
 * emergency. Tap to respond." Missing bus/route pieces are omitted rather
 * than filled with a guess; with several OPEN events the count is said
 * first ("3 active emergencies. Latest: …") because the detail of the
 * newest is the most useful one.
 *
 * English on purpose: the admin mobile section is English-only by the same
 * convention as the web admin console — the crew-facing i18n system does
 * not extend here.
 */
export function buildSosAlertSpeech(active: readonly SosAlertEvent[]): string {
  if (active.length === 0) {
    return '';
  }
  const latest = active[active.length - 1]!;
  const details = [
    latest.busRegistrationNumber ? `Bus ${latest.busRegistrationNumber}` : null,
    latest.routeName ? `route ${latest.routeName}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const count =
    active.length > 1 ? `${active.length} active emergencies. Latest: ` : 'Emergency alert. ';
  const where = details.length > 0 ? `${details}, ` : '';
  // Mid-sentence the type reads lower-case ("Bus MH-12, medical emergency");
  // on its own it keeps its label capital ("Emergency alert. Accident.").
  const typePhrase = where ? latest.typeLabel.toLowerCase() : latest.typeLabel;
  return `${count}${where}${typePhrase}. Tap to respond.`;
}

/** Real timers; injected in tests. */
const globalScheduler: SosAlertScheduler = {
  setTimeout: (handler, milliseconds) => globalThis.setTimeout(handler, milliseconds),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface SosAlertLoopOptions {
  drivers?: SosAlertDrivers;
  scheduler?: SosAlertScheduler;
  /** Overrides the cadence/cap (used by the tests). */
  config?: Partial<typeof SOS_ALERT_CONFIG>;
}

/**
 * The loop state machine. One shared instance per app (see
 * {@link sosAlertLoop}); the caller-facing React glue only subscribes to
 * the snapshot and forwards socket frames, so a second listener can never
 * stack two loops.
 *
 * The mechanics mirror the web player's: {@link raise} is idempotent per
 * emergency, {@link silence} stops one incident's loop, the mute only ever
 * cuts the noise (never the banner), and a failing driver degrades into
 * `lastError` instead of escaping into a socket handler.
 */
export class SosAlertLoop {
  private drivers: SosAlertDrivers;
  private readonly scheduler: SosAlertScheduler;
  private readonly config: typeof SOS_ALERT_CONFIG;

  private readonly active = new Map<string, SosAlertEvent>();
  private readonly listeners = new Set<(snapshot: SosAlertSnapshot) => void>();

  private muted = false;
  private appActive = true;
  private expired = false;
  private hapticHandle: unknown = null;
  private speechHandle: unknown = null;
  private capHandle: unknown = null;
  private lastError: string | null = null;

  constructor(options: SosAlertLoopOptions = {}) {
    this.drivers = options.drivers ?? NOOP_SOS_ALERT_DRIVERS;
    this.scheduler = options.scheduler ?? globalScheduler;
    this.config = { ...SOS_ALERT_CONFIG, ...(options.config ?? {}) };
  }

  // ------------------------------------------------------------------ state --

  getSnapshot(): SosAlertSnapshot {
    return {
      status: this.deriveStatus(),
      activeCount: this.active.size,
      muted: this.muted,
      lastError: this.lastError,
    };
  }

  /** Mirrors every state change to the UI; returns an unsubscribe. */
  subscribe(listener: (snapshot: SosAlertSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------- control --

  /** Replace the drivers (the app installs the native ones once at start). */
  configureDrivers(drivers: SosAlertDrivers): void {
    this.drivers = drivers;
  }

  /**
   * Raises the loop for one emergency. Idempotent per event id — a
   * duplicated broadcast (or two screens listening to the same socket)
   * never stacks a second loop.
   *
   * A fresh SOS re-arms the duration cap: the cap exists for one unanswered
   * episode; a *new* emergency is a new episode and earns its own noise.
   */
  raise(event: SosAlertEvent): void {
    if (this.active.has(event.id)) {
      return;
    }
    this.active.set(event.id, event);
    this.expired = false;
    this.sync();
    this.emit();
  }

  /** Stops the loop for one event (acknowledged, resolved or cancelled). */
  silence(id: string): void {
    if (!this.active.delete(id)) {
      return;
    }
    if (this.active.size === 0) {
      // The next SOS starts a fresh episode with a full cap budget.
      this.expired = false;
    }
    this.sync();
    this.emit();
  }

  /** Stops every alarm (leaving the admin section, sign-out). */
  silenceAll(): void {
    if (this.active.size === 0 && !this.running) {
      return;
    }
    this.active.clear();
    this.expired = false;
    this.sync();
    this.emit();
  }

  /**
   * The explicit mute. Muting cuts the loop immediately (speech included);
   * un-muting re-arms it — including its duration cap, like the web player,
   * because an admin who unmutes is asking to be told again.
   */
  setMuted(muted: boolean): void {
    if (this.muted === muted) {
      return;
    }
    this.muted = muted;
    if (!muted) {
      this.expired = false;
    }
    this.sync();
    this.emit();
  }

  /**
   * Foreground gate. `false` halts the loop without touching the incident
   * list; `true` resumes whatever still needs answering (a capped episode
   * stays capped — coming back to the phone is not a new emergency).
   */
  setAppActive(appActive: boolean): void {
    if (this.appActive === appActive) {
      return;
    }
    this.appActive = appActive;
    this.sync();
    this.emit();
  }

  dispose(): void {
    this.listeners.clear();
    this.active.clear();
    this.halt();
  }

  // -------------------------------------------------------------- internals --

  /** True while any cadence/cap timer is live. */
  private get running(): boolean {
    return this.hapticHandle !== null || this.speechHandle !== null || this.capHandle !== null;
  }

  private canLoopNow(): boolean {
    return shouldSosAlertLoopRun({
      appActive: this.appActive,
      muted: this.muted,
      activeCount: this.active.size,
      withinDurationCap: !this.expired,
    });
  }

  private deriveStatus(): SosAlertLoopStatus {
    if (this.active.size === 0) {
      return 'idle';
    }
    if (this.muted) {
      return 'muted';
    }
    return this.running ? 'alerting' : 'quiet';
  }

  private sync(): void {
    if (this.canLoopNow()) {
      if (!this.running) {
        this.start();
      }
      return;
    }
    if (this.running) {
      this.halt();
    }
  }

  /**
   * Starts one episode: an immediate burst + spoken line (the alert should
   * be felt the moment the frame lands, not one cadence later), then the
   * two cadences, then the safety cap.
   */
  private start(): void {
    this.fireHaptic();
    this.fireSpeech();
    this.scheduleHaptic();
    this.scheduleSpeech();
    this.capHandle = this.scheduler.setTimeout(() => {
      this.capHandle = null;
      this.expired = true;
      this.halt();
      this.emit();
    }, this.config.maxAlertDurationMs);
  }

  private scheduleHaptic(): void {
    this.hapticHandle = this.scheduler.setTimeout(() => {
      this.hapticHandle = null;
      if (!this.canLoopNow()) {
        this.emit();
        return;
      }
      this.fireHaptic();
      this.scheduleHaptic();
    }, this.config.hapticIntervalMs);
  }

  private scheduleSpeech(): void {
    this.speechHandle = this.scheduler.setTimeout(() => {
      this.speechHandle = null;
      if (!this.canLoopNow()) {
        this.emit();
        return;
      }
      this.fireSpeech();
      this.scheduleSpeech();
    }, this.config.speechIntervalMs);
  }

  /** Stops the loop at once: cancels every timer and cuts speech short. */
  private halt(): void {
    for (const key of ['hapticHandle', 'speechHandle', 'capHandle'] as const) {
      if (this[key] !== null) {
        this.scheduler.clearTimeout(this[key]);
        this[key] = null;
      }
    }
    try {
      this.drivers.stopSpeaking();
    } catch (error) {
      this.recordError(error);
    }
  }

  private fireHaptic(): void {
    try {
      this.drivers.vibrate();
    } catch (error) {
      this.recordError(error);
    }
  }

  private fireSpeech(): void {
    const text = buildSosAlertSpeech([...this.active.values()]);
    if (!text) {
      return;
    }
    try {
      this.drivers.speak(text);
    } catch (error) {
      this.recordError(error);
    }
  }

  private recordError(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // A misbehaving subscriber must not stop the others, or the loop.
      }
    }
  }
}

// --------------------------------------------------------------- singleton --

/**
 * The app-wide alert loop, created with the safe no-op drivers — importing
 * this module never touches a native API, which is what keeps it loadable
 * under `node --test`. `sos-alert-native.ts` installs the real drivers once
 * the admin section mounts.
 */
export const sosAlertLoop = new SosAlertLoop();

/** Installs native drivers on the shared loop (called once, by the wrapper). */
export function installSosAlertDrivers(drivers: SosAlertDrivers): void {
  sosAlertLoop.configureDrivers(drivers);
}
