/**
 * Crew PIN brute-force policy — the pure half (Mobile-UX Phase 4).
 *
 * A 4-digit PIN covers `10 ** 4 = 10_000` values. That is small enough that an
 * attacker who can submit guesses freely will find any given PIN quickly, so the
 * PIN path is only survivable because guessing is *slow*: a per-user attempt
 * window plus a hard lockout, layered on top of the existing rate limiter.
 *
 * This file is deliberately framework-free — no Sequelize, no HTTP, no clock of
 * its own. Every function takes `now` as an argument and returns a new state,
 * which is what makes the policy testable under `node --test` (the repo has no
 * Jest/Vitest) and lets `crew-pin-attempts.spec.ts` walk a whole attack
 * timeline deterministically.
 *
 * ### The three layers, and what each one is for
 *
 * 1. **This per-user lockout.** Keyed by the *user*, not the IP, so an attacker
 *    rotating source addresses still gets five guesses per window against one
 *    driver. This is the layer that actually bounds PIN guessing.
 * 2. **The `auth_crew_login` rate-limit policy** (`config/rate-limit.config.ts`)
 *    — per-IP/per-user plus a per-identity bucket, which stops one host from
 *    spraying many accounts.
 * 3. **The audit trail** — every success and every failure is written to
 *    `audit_logs`, so a slow attack is visible to a human even when it stays
 *    under both throttles.
 *
 * ### Known limitation (do not "fix" by silently weakening the policy)
 *
 * The attempt counters live in process memory, exactly like
 * `MemoryRateLimitStore`. Under more than one API instance behind a load
 * balancer an attacker's guesses are spread across processes and the effective
 * allowance becomes `N × maxAttempts` per window, and a restart clears every
 * counter. The supported topology is a single instance (README §18); this is
 * documented in `docs/security.md` → "Crew PIN brute force" rather than hidden,
 * and a distributed store is the same deferred Redis work the rate limiter
 * already names.
 */

/** Tunables of the per-user PIN lockout. */
export interface CrewPinBruteForcePolicy {
  /** Failed PIN entries allowed inside `windowMs` before the lockout trips. */
  maxAttempts: number;
  /** Rolling window the failures are counted in, in ms. */
  windowMs: number;
  /** How long the account refuses PIN entry once the window is exhausted. */
  lockoutMs: number;
}

/**
 * Shipped defaults.
 *
 * Five attempts is enough for a driver fat-fingering a pad in a moving bus and
 * tight enough that the guessing math below stays in weeks, not hours. The
 * window and the lockout are the same 15 minutes so the recovery story is easy
 * to explain to a school ("wait a quarter of an hour, or have the admin reset
 * it") and so the sustainable guess rate has one clean expression.
 */
export const CREW_PIN_DEFAULT_POLICY: Readonly<CrewPinBruteForcePolicy> = {
  maxAttempts: 5,
  windowMs: 15 * 60_000,
  lockoutMs: 15 * 60_000,
};

/** Per-user attempt counter. Immutable between calls; each call returns a copy. */
export interface CrewPinAttemptState {
  /** Consecutive failures counted in the current window. */
  failures: number;
  /** Epoch ms of the first failure in the current window; `null` when empty. */
  windowStartedAt: number | null;
  /** Epoch ms until which PIN entry is refused; `null` when not locked. */
  lockedUntil: number | null;
}

/** A fresh user with no recorded activity. */
export const EMPTY_CREW_PIN_ATTEMPT_STATE: Readonly<CrewPinAttemptState> = {
  failures: 0,
  windowStartedAt: null,
  lockedUntil: null,
};

/** Outcome of one PIN attempt, with everything the HTTP layer needs to answer. */
export interface CrewPinAttemptDecision {
  state: CrewPinAttemptState;
  /** True when this attempt is refused without the PIN ever being compared. */
  locked: boolean;
  /** Guesses still allowed in the current window (0 while locked). */
  remainingAttempts: number;
  /** Ms until the lockout lifts; `null` when not locked. */
  retryAfterMs: number | null;
}

/** Whether the account is currently locked out, and for how much longer. */
export function pinLockoutRemainingMs(
  state: CrewPinAttemptState | null | undefined,
  now: number,
): number {
  const lockedUntil = state?.lockedUntil;
  if (typeof lockedUntil !== 'number') {
    return 0;
  }
  return lockedUntil > now ? lockedUntil - now : 0;
}

/**
 * Decides whether a PIN attempt may proceed *before* any credential work.
 *
 * Called first on every PIN login: while an account is locked the server never
 * even loads the user row or runs bcrypt, which keeps a locked account cheap to
 * hammer and — more importantly — makes the lockout independent of whether the
 * account exists, so it cannot be used to probe for valid `user_id`s.
 */
export function inspectPinAttempt(
  state: CrewPinAttemptState | null | undefined,
  now: number,
  policy: CrewPinBruteForcePolicy = CREW_PIN_DEFAULT_POLICY,
): CrewPinAttemptDecision {
  const current = state ?? EMPTY_CREW_PIN_ATTEMPT_STATE;
  const retryAfterMs = pinLockoutRemainingMs(current, now);
  if (retryAfterMs > 0) {
    return {
      state: { ...current },
      locked: true,
      remainingAttempts: 0,
      retryAfterMs,
    };
  }
  // A window that has rolled over contributes nothing to the count.
  const windowLive =
    current.windowStartedAt !== null && now - current.windowStartedAt < policy.windowMs;
  const failures = windowLive ? current.failures : 0;
  return {
    state: { ...current, failures, windowStartedAt: windowLive ? current.windowStartedAt : null },
    locked: false,
    remainingAttempts: Math.max(0, policy.maxAttempts - failures),
    retryAfterMs: null,
  };
}

/**
 * Records one failed PIN comparison and returns the resulting state.
 *
 * The lockout trips on the attempt that reaches `maxAttempts`, so the Nth wrong
 * PIN is itself refused-with-lock rather than being allowed and then locking the
 * N+1th — an attacker never gets a free extra guess by racing the boundary.
 */
export function registerPinFailure(
  state: CrewPinAttemptState | null | undefined,
  now: number,
  policy: CrewPinBruteForcePolicy = CREW_PIN_DEFAULT_POLICY,
): CrewPinAttemptDecision {
  const inspected = inspectPinAttempt(state, now, policy);
  // Already locked: the attempt was refused before any comparison, so nothing
  // is recorded and the lockout is not extended. Not extending matters — an
  // attacker who keeps hammering must not be able to push a legitimate driver's
  // recovery indefinitely further away, and the driver's own retry after the
  // window must still work.
  if (inspected.locked) {
    return inspected;
  }

  const failures = inspected.state.failures + 1;
  const windowStartedAt = inspected.state.windowStartedAt ?? now;
  const exhausted = failures >= policy.maxAttempts;

  return {
    state: {
      failures: exhausted ? 0 : failures,
      // Once locked, the window is meaningless: the counter restarts clean when
      // the lockout lifts, so a driver who waited it out gets a full allowance.
      windowStartedAt: exhausted ? null : windowStartedAt,
      lockedUntil: exhausted ? now + policy.lockoutMs : null,
    },
    locked: exhausted,
    remainingAttempts: exhausted ? 0 : Math.max(0, policy.maxAttempts - failures),
    retryAfterMs: exhausted ? policy.lockoutMs : null,
  };
}

/**
 * Clears every counter after a successful login.
 *
 * Forgiving on success is what stops a legitimate driver who mistypes twice and
 * then succeeds from carrying a strike record into their next shift.
 */
export function registerPinSuccess(
  _state: CrewPinAttemptState | null | undefined,
): CrewPinAttemptState {
  return { ...EMPTY_CREW_PIN_ATTEMPT_STATE };
}

/**
 * How long a determined attacker needs to exhaust the whole PIN space against
 * **one** user, in days.
 *
 * The model is deliberately blunt and deliberately pessimistic in the
 * attacker's favour: it assumes the lockout lifts exactly on time, that the
 * attacker never wastes a cycle, and that each cycle of
 * `max(windowMs, lockoutMs)` buys a full `maxAttempts` guesses. Real guessing is
 * slower than this, so the number below is an upper bound on the attacker's
 * progress — i.e. a *lower* bound on the days they need.
 *
 * Exported (rather than being a figure typed into a markdown file) so
 * `crew-pin-attempts.spec.ts` pins it and the docs cannot silently drift away
 * from the shipped defaults.
 */
export function estimatePinExhaustionDays(input: {
  combinations: number;
  policy?: CrewPinBruteForcePolicy;
}): number {
  const policy = input.policy ?? CREW_PIN_DEFAULT_POLICY;
  const cycleMs = Math.max(policy.windowMs, policy.lockoutMs);
  const cyclesPerDay = 86_400_000 / cycleMs;
  const guessesPerDay = policy.maxAttempts * cyclesPerDay;
  if (guessesPerDay <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return input.combinations / guessesPerDay;
}

/**
 * Process-local PIN attempt counters.
 *
 * Structurally the same object as `MemoryRateLimitStore` and carrying the same
 * single-instance caveat (see the header comment). Keys are bounded two ways so
 * a hostile client cannot grow the map without limit: expired states are dropped
 * lazily on read, and once the map exceeds `maxKeys` a sweep removes every
 * state whose window and lockout have both passed.
 */
export class CrewPinAttemptStore {
  private readonly states = new Map<string, CrewPinAttemptState>();

  constructor(private readonly maxKeys = 20_000) {}

  /**
   * Bucket key for one crew account.
   *
   * Tenant-qualified even though `user_id` is a UUID and already globally
   * unique, so a key can never be read as belonging to the wrong school in a
   * log line or a debugger.
   */
  static keyFor(schoolId: string, userId: string): string {
    return `${schoolId}:${userId}`;
  }

  peek(key: string, now: number = Date.now()): CrewPinAttemptState {
    const existing = this.states.get(key);
    if (!existing) {
      return { ...EMPTY_CREW_PIN_ATTEMPT_STATE };
    }
    if (isExhausted(existing, now)) {
      this.states.delete(key);
      return { ...EMPTY_CREW_PIN_ATTEMPT_STATE };
    }
    return existing;
  }

  write(key: string, state: CrewPinAttemptState, now: number = Date.now()): void {
    if (isExhausted(state, now)) {
      this.states.delete(key);
      return;
    }
    this.states.set(key, state);
    this.maybeSweep(now);
  }

  forget(key: string): void {
    this.states.delete(key);
  }

  get size(): number {
    return this.states.size;
  }

  private maybeSweep(now: number): void {
    if (this.states.size <= this.maxKeys) {
      return;
    }
    for (const [key, state] of this.states) {
      if (isExhausted(state, now)) {
        this.states.delete(key);
      }
    }
  }
}

/**
 * True when a state carries no information any more: its window has rolled over
 * *and* it is not holding a live lockout. Such a state is indistinguishable from
 * an absent one, so it is safe to evict — and evicting it is what keeps the map
 * from filling with the residue of every driver who ever mistyped once.
 */
function isExhausted(state: CrewPinAttemptState, now: number): boolean {
  if (state.lockedUntil !== null && state.lockedUntil > now) {
    return false;
  }
  if (state.failures === 0) {
    return true;
  }
  // Without a policy in scope the conservative choice is to keep the state: an
  // evicted window would forgive failures early. `CREW_PIN_DEFAULT_POLICY` is
  // only used as the eviction horizon, never to make a lockout decision — those
  // always go through the caller's configured policy.
  return state.windowStartedAt === null
    ? true
    : now - state.windowStartedAt >= CREW_PIN_DEFAULT_POLICY.windowMs;
}
