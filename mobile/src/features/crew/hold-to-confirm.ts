/**
 * Hold-to-confirm controller — the pure brain of the SOS button.
 *
 * A stressed, gloved driver must not fire an SOS by brushing the screen, but
 * "press and hold ~1s" must feel instant and must never double-fire. The
 * rules are pure time arithmetic, so they live here (unit-tested under
 * `node --test` with synthetic clocks) and the component only renders what
 * this controller decides.
 *
 * Contract:
 * - press starts a hold; releasing **before** `HOLD_DURATION_MS` cancels it;
 * - the controller fires **once** per completed hold; a second fire is
 *   refused until `reset()` (double-press cannot duplicate);
 * - `progress(now)` returns 0..1 for the fill animation;
 * - while `fired` or `sending`, new presses are ignored.
 */

/** Hold length — inside the required 600–1200 ms window. */
export const HOLD_DURATION_MS = 900;
/** Guards from the acceptance criteria, pinned by the spec. */
export const HOLD_WINDOW_MIN_MS = 600;
export const HOLD_WINDOW_MAX_MS = 1200;

export type HoldPhase = 'idle' | 'holding' | 'fired';

export interface HoldSnapshot {
  phase: HoldPhase;
  /** 0..1 fill of the hold indicator. */
  progress: number;
}

export interface HoldEvent {
  /** The button should fire the SOS now (exactly once per hold). */
  fire: boolean;
}

export class HoldToConfirm {
  private pressedAt: number | null = null;
  private phase: HoldPhase = 'idle';
  private lastElapsed = 0;

  /** A new press. Ignored while a hold is running or the fire was consumed. */
  press(now: number): HoldEvent {
    if (this.phase === 'idle') {
      this.pressedAt = now;
      this.lastElapsed = 0;
      this.phase = 'holding';
    }
    return { fire: false };
  }

  /** A release. Early release cancels; a full-length release is a no-op
   *  (the fire was already emitted by `complete()`). */
  release(now: number): HoldEvent {
    if (this.phase !== 'holding' || this.pressedAt === null) {
      return { fire: false };
    }
    const elapsed = now - this.pressedAt;
    this.pressedAt = null;
    if (elapsed >= HOLD_DURATION_MS) {
      return { fire: false };
    }
    this.phase = 'idle';
    this.lastElapsed = 0;
    return { fire: false };
  }

  /** The hold timer elapsed — fire at most once, then lock until `reset()`. */
  complete(): HoldEvent {
    if (this.phase !== 'holding') {
      return { fire: false };
    }
    this.phase = 'fired';
    this.pressedAt = null;
    this.lastElapsed = HOLD_DURATION_MS;
    return { fire: true };
  }

  /** After the action settles, re-arm the button. */
  reset(): void {
    this.phase = 'idle';
    this.pressedAt = null;
    this.lastElapsed = 0;
  }

  snapshot(now: number): HoldSnapshot {
    if (this.phase === 'holding' && this.pressedAt !== null) {
      return { phase: this.phase, progress: progressAt(now - this.pressedAt) };
    }
    if (this.phase === 'fired') {
      return { phase: this.phase, progress: 1 };
    }
    return { phase: 'idle', progress: 0 };
  }

  get currentPhase(): HoldPhase {
    return this.phase;
  }

  /** Elapsed ms of the running hold (0 when idle) — for tests and haptics. */
  get elapsed(): number {
    return this.lastElapsed;
  }
}

/** Pure progress curve at `elapsed` ms into a hold (0..1, clamped). */
export function progressAt(elapsed: number): number {
  if (elapsed <= 0) return 0;
  if (elapsed >= HOLD_DURATION_MS) return 1;
  return elapsed / HOLD_DURATION_MS;
}
