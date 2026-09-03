import type { EmergencyAlarmEvent, EmergencyAlarmStatus } from './helpers';

/**
 * School-admin emergency alarm — the siren behind the notification.
 *
 * When a driver or conductor presses the SOS button the API persists the event
 * and broadcasts `emergency:new` into the tenant's own Socket.IO room
 * (`emergency:school:<schoolId>`). The web shell turns that one frame — and
 * only that one (see `helpers.ts` for the policy) — into a **prominent,
 * repeating siren**, so a school admin who is looking at another screen cannot
 * miss it. The siren stops when the incident leaves `OPEN`, when the admin
 * mutes it, or after {@link EMERGENCY_ALARM_CONFIG.maxBursts} bursts so an
 * unattended console does not drone on forever.
 *
 * Design notes:
 *
 * - **No new dependency, no audio asset.** The siren is synthesised with the
 *   Web Audio API: two alternating sawtooth tones (988 Hz / 740 Hz) with a
 *   percussive envelope, through a compressor so it stays loud but never
 *   clips. Nothing has to be downloaded, licensed or bundled.
 * - **Autoplay is expected, not ignored.** Browsers keep an `AudioContext`
 *   suspended until a user gesture. An alarm that arrives earlier is *queued*
 *   (`status: 'blocked'`, `pendingCount > 0`) and starts the instant
 *   {@link EmergencyAlarmPlayer.unlock} succeeds — it is never dropped. The
 *   shell also renders a visible "Enable alarm sound" button, so a blocked
 *   alarm is never a silent failure.
 * - **It can never break a notification.** Every audio call is contained: a
 *   missing or failing Web Audio API degrades to `status: 'unavailable'` with
 *   the reason recorded in `lastError`, while the top-bar indicator, the toast
 *   and the live list refresh keep working exactly as before.
 *
 * Free of React and of DOM listeners so the Node test runner can exercise the
 * whole state machine with an injected audio context and scheduler
 * (`emergency-alarm.spec.ts`). The React hook (`useEmergencyAlarm.ts`) only
 * mirrors the snapshot and attaches the gesture listeners; the type-only import
 * above is erased at runtime, which keeps this module loadable in Node.
 */

/** Minimal Web Audio surface the siren needs (a real `AudioContext` fits). */
export interface AlarmAudioContext {
  readonly state: 'suspended' | 'running' | 'closed';
  readonly currentTime: number;
  readonly destination: AlarmAudioNode;
  resume(): Promise<void>;
  createOscillator(): AlarmOscillatorNode;
  createGain(): AlarmGainNode;
  createDynamicsCompressor?(): AlarmCompressorNode;
  close?(): Promise<void>;
}

export interface AlarmAudioNode {
  connect(destination: AlarmAudioNode): unknown;
  disconnect(): unknown;
}

export interface AlarmAudioParam {
  value: number;
  setValueAtTime(value: number, startTime: number): AlarmAudioParam;
  linearRampToValueAtTime(value: number, endTime: number): AlarmAudioParam;
}

export interface AlarmOscillatorNode extends AlarmAudioNode {
  type: 'sine' | 'square' | 'sawtooth' | 'triangle' | 'custom';
  frequency: AlarmAudioParam;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AlarmGainNode extends AlarmAudioNode {
  gain: AlarmAudioParam;
}

export interface AlarmCompressorNode extends AlarmAudioNode {
  threshold: AlarmAudioParam;
  knee: AlarmAudioParam;
  ratio: AlarmAudioParam;
  attack: AlarmAudioParam;
  release: AlarmAudioParam;
}

/** Timer surface, injected so repeat scheduling is testable without waiting. */
export interface AlarmScheduler {
  setTimeout(handler: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface EmergencyAlarmSnapshot {
  status: EmergencyAlarmStatus;
  /** Emergencies the alarm is currently raised for, in arrival order. */
  active: EmergencyAlarmEvent[];
  /** True once a user gesture has let the audio context run. */
  unlocked: boolean;
  muted: boolean;
  /** Alarms waiting for the audio context to be unlocked. */
  pendingCount: number;
  /** Last contained audio failure — surfaced, never swallowed silently. */
  lastError: string | null;
}

/** Siren voicing. Deliberately harsh, and unlike any chime in the product. */
export const EMERGENCY_ALARM_CONFIG = {
  /** Alternating two-tone siren: high beep, low beep, high beep, … */
  highFrequencyHz: 988,
  lowFrequencyHz: 740,
  waveform: 'sawtooth' as const,
  beepSeconds: 0.22,
  /** Silence between two beeps of the same burst. */
  beepGapSeconds: 0.06,
  beepsPerBurst: 6,
  /**
   * Peak gain of a beep. Loud on purpose — the beeps are gated, so they never
   * stack, and the compressor below only guards the headroom.
   */
  peakGain: 0.6,
  attackSeconds: 0.012,
  releaseSeconds: 0.05,
  /** Pause between bursts, so bursts never overlap. */
  burstPauseMs: 160,
  /** Safety cap: the siren gives up after roughly two minutes of an open SOS. */
  maxBursts: 60,
} as const;

/** Length of one burst in milliseconds, derived from the voicing above. */
export const EMERGENCY_ALARM_BURST_MS = Math.round(
  EMERGENCY_ALARM_CONFIG.beepsPerBurst *
    (EMERGENCY_ALARM_CONFIG.beepSeconds + EMERGENCY_ALARM_CONFIG.beepGapSeconds) *
    1000,
);

/** Delay before the next burst while an emergency stays open. */
export const EMERGENCY_ALARM_REPEAT_MS =
  EMERGENCY_ALARM_BURST_MS + EMERGENCY_ALARM_CONFIG.burstPauseMs;

export interface EmergencyAlarmPlayerOptions {
  /** Returns the audio context, or `null` when Web Audio is unavailable. */
  audioContextFactory?: () => AlarmAudioContext | null;
  scheduler?: AlarmScheduler;
  /** Overrides the siren voicing (used by the tests). */
  config?: Partial<typeof EMERGENCY_ALARM_CONFIG>;
}

/** One scheduled burst, kept so `silence` can cut it off immediately. */
interface LiveBurst {
  oscillators: AlarmOscillatorNode[];
  gain: AlarmGainNode;
  cleanupHandle: unknown;
}

/**
 * The alarm state machine and its synthesiser.
 *
 * One instance per tab (see {@link getEmergencyAlarmPlayer}). It is a plain
 * object with subscribers rather than React state, so the app shell and the
 * emergency console drive the same siren and a duplicated listener can never
 * stack two of them.
 */
export class EmergencyAlarmPlayer {
  private readonly factory: () => AlarmAudioContext | null;
  private readonly scheduler: AlarmScheduler;
  private readonly config: typeof EMERGENCY_ALARM_CONFIG;

  private context: AlarmAudioContext | null = null;
  private output: AlarmAudioNode | null = null;
  private readonly active = new Map<string, EmergencyAlarmEvent>();
  private readonly listeners = new Set<(snapshot: EmergencyAlarmSnapshot) => void>();
  private liveBursts: LiveBurst[] = [];
  private repeatHandle: unknown = null;
  private burstsPlayed = 0;
  private muted = false;
  private unlocked = false;
  private unavailable = false;
  private lastError: string | null = null;

  constructor(options: EmergencyAlarmPlayerOptions = {}) {
    this.factory = options.audioContextFactory ?? createBrowserAudioContext;
    this.scheduler = options.scheduler ?? globalScheduler;
    this.config = { ...EMERGENCY_ALARM_CONFIG, ...(options.config ?? {}) };
  }

  // ------------------------------------------------------------------ state --

  /** Current snapshot; cheap enough to read on every render. */
  getSnapshot(): EmergencyAlarmSnapshot {
    return {
      status: this.deriveStatus(),
      active: [...this.active.values()],
      unlocked: this.unlocked,
      muted: this.muted,
      pendingCount: this.isAudioHeld() ? this.active.size : 0,
      lastError: this.lastError,
    };
  }

  /** Mirrors every state change to the shell; returns an unsubscribe. */
  subscribe(listener: (snapshot: EmergencyAlarmSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------- control --

  /**
   * Unlocks the audio context.
   *
   * Must be called from a user gesture — the hook wires it to `pointerdown` /
   * `keydown` and to the visible "Enable alarm sound" button. Resolves to
   * `true` when audio can play now. Any alarm that arrived while the browser
   * was blocking autoplay starts immediately on success, so an emergency is
   * never lost to the autoplay policy.
   */
  async unlock(): Promise<boolean> {
    const context = this.ensureContext();
    if (!context) {
      this.emit();
      return false;
    }
    if (context.state !== 'running') {
      await this.resume(context);
    }
    this.syncUnlocked(context);
    // Replay whatever was queued while the browser held audio back.
    if (this.unlocked && this.active.size > 0 && !this.muted) {
      this.startSiren();
    }
    this.emit();
    return this.unlocked;
  }

  /**
   * Switches the siren on or off. Muting cuts an ongoing alarm immediately;
   * unmuting restarts it while an emergency is still open.
   *
   * The choice is kept in memory only: a reload re-arms the alarm, because a
   * permanently muted emergency console is the more dangerous failure mode.
   */
  setMuted(muted: boolean): void {
    if (this.muted === muted) {
      return;
    }
    this.muted = muted;
    if (muted) {
      this.haltSiren();
    } else if (this.active.size > 0) {
      this.playOrQueue();
    }
    this.emit();
  }

  /**
   * Raises the alarm for one emergency event.
   *
   * Idempotent per event id: a duplicated broadcast (or a second listener)
   * never stacks a second siren.
   */
  raise(event: EmergencyAlarmEvent): void {
    if (this.active.has(event.id)) {
      return;
    }
    this.active.set(event.id, event);
    this.playOrQueue();
    this.emit();
  }

  /** Stops the alarm for one event (acknowledged, resolved or cancelled). */
  silence(id: string): void {
    if (!this.active.delete(id)) {
      return;
    }
    if (this.active.size === 0) {
      this.haltSiren();
    }
    this.emit();
  }

  /** Stops every alarm but keeps the audio context (unmount, sign-out). */
  silenceAll(): void {
    if (this.active.size === 0 && this.liveBursts.length === 0 && this.repeatHandle === null) {
      return;
    }
    this.active.clear();
    this.haltSiren();
    this.emit();
  }

  /** Releases the audio context entirely. */
  dispose(): void {
    this.listeners.clear();
    this.active.clear();
    this.haltSiren();
    const context = this.context;
    this.context = null;
    this.output = null;
    this.unlocked = false;
    if (context?.close) {
      void Promise.resolve()
        .then(() => context.close?.())
        .catch(() => undefined);
    }
  }

  // -------------------------------------------------------------- internals --

  private deriveStatus(): EmergencyAlarmStatus {
    if (this.unavailable) {
      return 'unavailable';
    }
    if (this.active.size === 0) {
      return 'idle';
    }
    if (this.muted) {
      return 'muted';
    }
    return this.isAudioHeld() ? 'blocked' : 'sounding';
  }

  /** True while emergencies are open but no audio can come out yet. */
  private isAudioHeld(): boolean {
    if (this.unavailable || this.muted || this.active.size === 0) {
      return false;
    }
    return !this.context || this.context.state !== 'running';
  }

  private syncUnlocked(context: AlarmAudioContext): void {
    if (context.state === 'running') {
      this.unlocked = true;
    }
  }

  private playOrQueue(): void {
    if (this.muted) {
      return;
    }
    const context = this.ensureContext();
    if (!context) {
      // No Web Audio at all: the indicator, the toast and the live list still
      // work, and the reason is surfaced instead of swallowed.
      return;
    }
    if (context.state === 'running') {
      this.syncUnlocked(context);
      this.startSiren();
      return;
    }
    // Autoplay policy: try to resume, and leave the alarm queued so the next
    // gesture (`unlock()`) plays it. Nothing is dropped here.
    void this.resume(context).then(() => {
      this.syncUnlocked(context);
      if (this.unlocked && this.active.size > 0 && !this.muted) {
        this.startSiren();
      }
      this.emit();
    });
  }

  /** Starts the repeating siren unless it is already running. */
  private startSiren(): void {
    if (this.repeatHandle !== null || this.liveBursts.length > 0 || !this.canPlayNow()) {
      return;
    }
    this.burstsPlayed = 0;
    this.scheduleBurst(0);
  }

  /** Plays one burst and queues the next while the emergency stays open. */
  private scheduleBurst(delayMs: number): void {
    this.repeatHandle = this.scheduler.setTimeout(() => {
      this.repeatHandle = null;
      if (!this.canPlayNow()) {
        this.emit();
        return;
      }
      this.playBurst();
      this.burstsPlayed += 1;
      if (this.burstsPlayed < this.config.maxBursts && this.canPlayNow()) {
        this.scheduleBurst(EMERGENCY_ALARM_REPEAT_MS);
      } else {
        this.emit();
      }
    }, delayMs);
  }

  /** True when the siren may actually make sound at this very moment. */
  private canPlayNow(): boolean {
    return (
      !this.unavailable &&
      !this.muted &&
      this.active.size > 0 &&
      this.context !== null &&
      this.context.state === 'running'
    );
  }

  /** Synthesises one burst: alternating high/low beeps, sharp envelope. */
  private playBurst(): void {
    const context = this.context;
    const output = this.output;
    if (!context || !output) {
      return;
    }
    let burst: LiveBurst | null = null;
    try {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(output);
      const live: LiveBurst = { oscillators: [], gain, cleanupHandle: null };
      burst = live;
      this.liveBursts.push(live);
      // A burst ends on its own; the timer only releases the finished nodes.
      live.cleanupHandle = this.scheduler.setTimeout(() => {
        this.forgetBurst(live);
      }, EMERGENCY_ALARM_BURST_MS + 250);

      const start = context.currentTime + 0.02;
      const {
        beepSeconds,
        beepGapSeconds,
        beepsPerBurst,
        peakGain,
        attackSeconds,
        releaseSeconds,
      } = this.config;

      for (let index = 0; index < beepsPerBurst; index += 1) {
        const at = start + index * (beepSeconds + beepGapSeconds);
        const oscillator = context.createOscillator();
        oscillator.type = this.config.waveform;
        oscillator.frequency.value =
          index % 2 === 0 ? this.config.highFrequencyHz : this.config.lowFrequencyHz;

        // Percussive envelope: near-instant attack, short release. That is what
        // makes the siren cut through a busy school office.
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(peakGain, at + attackSeconds);
        gain.gain.setValueAtTime(peakGain, at + beepSeconds - releaseSeconds);
        gain.gain.linearRampToValueAtTime(0, at + beepSeconds);

        oscillator.connect(gain);
        oscillator.start(at);
        oscillator.stop(at + beepSeconds);
        burst.oscillators.push(oscillator);
      }
    } catch (error) {
      // A failed burst must never escape into a socket handler: the alarm
      // degrades to the visual indicator and records why.
      if (burst) {
        this.forgetBurst(burst);
      }
      this.recordError(error);
      this.unavailable = true;
      this.haltSiren();
      this.emit();
    }
  }

  private forgetBurst(burst: LiveBurst): void {
    this.liveBursts = this.liveBursts.filter((entry) => entry !== burst);
    this.disconnectBurst(burst);
  }

  /** Stops the siren at once: cancels the repeat and cuts every live burst. */
  private haltSiren(): void {
    if (this.repeatHandle !== null) {
      this.scheduler.clearTimeout(this.repeatHandle);
      this.repeatHandle = null;
    }
    for (const burst of this.liveBursts) {
      this.scheduler.clearTimeout(burst.cleanupHandle);
      this.disconnectBurst(burst);
    }
    this.liveBursts = [];
    this.burstsPlayed = 0;
  }

  private disconnectBurst(burst: LiveBurst): void {
    for (const oscillator of burst.oscillators) {
      try {
        oscillator.stop(0);
      } catch {
        // Already finished — nothing to stop.
      }
      try {
        oscillator.disconnect();
      } catch {
        // Best effort; the node is unreachable either way.
      }
    }
    try {
      burst.gain.disconnect();
    } catch {
      // Best effort.
    }
  }

  /** Creates the context and the shared output chain once, lazily. */
  private ensureContext(): AlarmAudioContext | null {
    if (this.unavailable) {
      return null;
    }
    if (this.context) {
      return this.context;
    }
    try {
      const context = this.factory();
      if (!context) {
        this.unavailable = true;
        this.lastError = 'Web Audio API is unavailable in this browser';
        this.emit();
        return null;
      }
      this.context = context;
      // Compressor first, so a loud siren can never clip on cheap speakers.
      this.output = context.createDynamicsCompressor
        ? this.configureCompressor(context, context.createDynamicsCompressor())
        : context.destination;
      this.syncUnlocked(context);
      return context;
    } catch (error) {
      this.recordError(error);
      this.unavailable = true;
      this.emit();
      return null;
    }
  }

  private configureCompressor(
    context: AlarmAudioContext,
    compressor: AlarmCompressorNode,
  ): AlarmAudioNode {
    // Headroom guard, not a loudness brake: the threshold sits just above the
    // siren's own peak so the alarm stays prominent and can never clip.
    compressor.threshold.value = -6;
    compressor.knee.value = 8;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;
    compressor.connect(context.destination);
    return compressor;
  }

  private async resume(context: AlarmAudioContext): Promise<void> {
    try {
      await context.resume();
    } catch (error) {
      // A rejected resume is the normal autoplay answer, not a crash.
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
        // A misbehaving subscriber must not stop the others, or the alarm.
      }
    }
  }
}

/**
 * Default browser audio-context factory.
 *
 * Returns `null` outside a browser (SSR, the Node test runner) and in browsers
 * without Web Audio, which the player turns into the visible `unavailable`
 * state instead of a thrown error.
 */
export function createBrowserAudioContext(): AlarmAudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const candidate = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  const Constructor = candidate.AudioContext ?? candidate.webkitAudioContext;
  if (!Constructor) {
    return null;
  }
  // The structural interfaces above are a deliberate subset of the real
  // `AudioContext`; the cast is confined to this one boundary.
  return new Constructor() as unknown as AlarmAudioContext;
}

/** Real timers; injected in tests. */
const globalScheduler: AlarmScheduler = {
  setTimeout: (handler, milliseconds) => globalThis.setTimeout(handler, milliseconds),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// --------------------------------------------------------------- singleton --

let player: EmergencyAlarmPlayer | null = null;

/**
 * The tab-wide alarm player.
 *
 * Mirrors the socket singletons in `services/*-socket.ts`: one shared instance,
 * so the app shell and the emergency console drive the same siren and a second
 * listener can never stack two of them.
 */
export function getEmergencyAlarmPlayer(): EmergencyAlarmPlayer {
  if (!player) {
    player = new EmergencyAlarmPlayer();
  }
  return player;
}

/** Drops the singleton (test teardown, and sign-out). */
export function resetEmergencyAlarmPlayer(): void {
  if (!player) {
    return;
  }
  player.dispose();
  player = null;
}
