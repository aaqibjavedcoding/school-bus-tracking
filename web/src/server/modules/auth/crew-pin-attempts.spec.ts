import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CREW_PIN_COMBINATIONS } from '@school-bus-tracking/validation';
import {
  CREW_PIN_DEFAULT_POLICY,
  CrewPinAttemptStore,
  EMPTY_CREW_PIN_ATTEMPT_STATE,
  estimatePinExhaustionDays,
  inspectPinAttempt,
  pinLockoutRemainingMs,
  registerPinFailure,
  registerPinSuccess,
  type CrewPinAttemptState,
  type CrewPinBruteForcePolicy,
} from './crew-pin-attempts';

/**
 * The brute-force policy of the crew PIN path, pinned by number.
 *
 * The unit is the **school**, not the driver: a PIN login body is
 * `{ school_id, pin }`, so the counter is keyed by school and 480 guesses/day
 * is the budget for a whole tenant. See `crew-pin-attempts.ts` for why no
 * narrower key would bound a sweep of distinct PINs.
 *
 * These are the figures `docs/security.md` and README §10 quote, so the specs
 * assert them literally: a change to the defaults has to fail here and force
 * the documentation to be updated in the same commit, rather than leaving a
 * markdown file describing a policy the code no longer implements.
 */
const MINUTE = 60_000;
const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';

describe('crew PIN brute-force defaults', () => {
  it('ships the documented policy: 5 attempts / 15 min window / 15 min lockout', () => {
    assert.deepEqual(
      { ...CREW_PIN_DEFAULT_POLICY },
      { maxAttempts: 5, windowMs: 15 * MINUTE, lockoutMs: 15 * MINUTE },
    );
  });

  it('counts against a 4-digit space of exactly 10,000 combinations', () => {
    assert.equal(CREW_PIN_COMBINATIONS, 10_000);
  });

  it('bounds a single-school exhaustive attack to weeks, not minutes', () => {
    // 5 guesses per 15-minute cycle = 20/hour = 480/day, so 10,000 values
    // needs 10000/480 = 20.83 days of continuous, perfectly-timed guessing
    // against ONE school — and every one of those 10,000 attempts is an
    // audited failure. The assertion is on the order of magnitude, not the
    // exact fraction, so a tweak to the lockout does not churn the spec.
    const days = estimatePinExhaustionDays({
      combinations: CREW_PIN_COMBINATIONS,
      policy: CREW_PIN_DEFAULT_POLICY,
    });
    assert.ok(days > 14, `expected > 14 days of guessing, got ${days}`);
    assert.ok(days < 60, `expected < 60 days (the estimate must stay honest), got ${days}`);
    assert.equal(Math.round(days * 100) / 100, 20.83);
  });

  it('derives 480 guesses per day from the shipped defaults', () => {
    const cyclesPerDay = 86_400_000 / Math.max(CREW_PIN_DEFAULT_POLICY.windowMs, CREW_PIN_DEFAULT_POLICY.lockoutMs);
    assert.equal(cyclesPerDay, 96);
    assert.equal(cyclesPerDay * CREW_PIN_DEFAULT_POLICY.maxAttempts, 480);
  });

  it('gets strictly worse for the attacker as the lockout grows', () => {
    const tighter: CrewPinBruteForcePolicy = {
      maxAttempts: CREW_PIN_DEFAULT_POLICY.maxAttempts,
      windowMs: CREW_PIN_DEFAULT_POLICY.windowMs,
      lockoutMs: 60 * MINUTE,
    };
    assert.ok(
      estimatePinExhaustionDays({ combinations: CREW_PIN_COMBINATIONS, policy: tighter }) >
        estimatePinExhaustionDays({ combinations: CREW_PIN_COMBINATIONS }),
    );
  });

  it('never divides by zero into a finite-looking number', () => {
    assert.equal(
      estimatePinExhaustionDays({
        combinations: CREW_PIN_COMBINATIONS,
        policy: { maxAttempts: 0, windowMs: MINUTE, lockoutMs: MINUTE },
      }),
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('inspectPinAttempt', () => {
  it('reports a full allowance for a user with no history', () => {
    const decision = inspectPinAttempt(null, 1_000);
    assert.equal(decision.locked, false);
    assert.equal(decision.remainingAttempts, 5);
    assert.equal(decision.retryAfterMs, null);
  });

  it('treats an absent state and the empty state identically', () => {
    assert.deepEqual(
      inspectPinAttempt(null, 1_000).state,
      inspectPinAttempt(EMPTY_CREW_PIN_ATTEMPT_STATE, 1_000).state,
    );
  });

  it('counts down the allowance as failures accumulate', () => {
    let state: CrewPinAttemptState = { ...EMPTY_CREW_PIN_ATTEMPT_STATE };
    const seen: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      const decision = registerPinFailure(state, 1_000 + index * 1_000);
      state = decision.state;
      seen.push(decision.remainingAttempts);
      assert.equal(decision.locked, false, `attempt ${index + 1} must not lock`);
    }
    assert.deepEqual(seen, [4, 3, 2, 1]);
  });

  it('forgets failures once the window rolls over', () => {
    const first = registerPinFailure(null, 0);
    const stillLive = inspectPinAttempt(first.state, CREW_PIN_DEFAULT_POLICY.windowMs - 1);
    assert.equal(stillLive.remainingAttempts, 4);

    const rolled = inspectPinAttempt(first.state, CREW_PIN_DEFAULT_POLICY.windowMs);
    assert.equal(rolled.remainingAttempts, 5, 'an expired window must forgive its failures');
    assert.equal(rolled.state.failures, 0);
  });
});

describe('the lockout', () => {
  it('trips on the attempt that reaches maxAttempts — no free extra guess', () => {
    let state: CrewPinAttemptState = { ...EMPTY_CREW_PIN_ATTEMPT_STATE };
    for (let index = 0; index < CREW_PIN_DEFAULT_POLICY.maxAttempts - 1; index += 1) {
      state = registerPinFailure(state, index * 1_000).state;
    }
    const fifth = registerPinFailure(state, 10_000);
    assert.equal(fifth.locked, true, 'the 5th wrong PIN is itself refused');
    assert.equal(fifth.remainingAttempts, 0);
    assert.equal(fifth.retryAfterMs, CREW_PIN_DEFAULT_POLICY.lockoutMs);
    assert.equal(fifth.state.lockedUntil, 10_000 + CREW_PIN_DEFAULT_POLICY.lockoutMs);
  });

  it('refuses further attempts while locked, without extending the lockout', () => {
    let state: CrewPinAttemptState = { ...EMPTY_CREW_PIN_ATTEMPT_STATE };
    for (let index = 0; index < CREW_PIN_DEFAULT_POLICY.maxAttempts; index += 1) {
      state = registerPinFailure(state, index * 1_000).state;
    }
    const lockedUntil = state.lockedUntil;

    // An attacker hammering a locked account must not push the driver's
    // recovery further away.
    const hammered = registerPinFailure(state, (lockedUntil as number) - 1);
    assert.equal(hammered.locked, true);
    assert.equal(hammered.state.lockedUntil, lockedUntil, 'the lockout must not be extended');
    assert.equal(hammered.state.failures, 0, 'a refused attempt records nothing');
  });

  it('exposes the remaining lockout through pinLockoutRemainingMs', () => {
    const state: CrewPinAttemptState = { failures: 0, windowStartedAt: null, lockedUntil: 5_000 };
    assert.equal(pinLockoutRemainingMs(state, 1_000), 4_000);
    assert.equal(pinLockoutRemainingMs(state, 5_000), 0);
    assert.equal(pinLockoutRemainingMs(state, 9_999), 0);
    assert.equal(pinLockoutRemainingMs(null, 1_000), 0);
  });

  it('gives a full allowance back once the lockout lifts', () => {
    let state: CrewPinAttemptState = { ...EMPTY_CREW_PIN_ATTEMPT_STATE };
    for (let index = 0; index < CREW_PIN_DEFAULT_POLICY.maxAttempts; index += 1) {
      state = registerPinFailure(state, index * 1_000).state;
    }
    const after = (state.lockedUntil as number) + 1;
    assert.equal(inspectPinAttempt(state, after).locked, false);
    assert.equal(inspectPinAttempt(state, after).remainingAttempts, 5);
    // …and the driver who waited it out is not one failure away from a relock.
    assert.equal(registerPinFailure(state, after).locked, false);
    assert.equal(registerPinFailure(state, after).remainingAttempts, 4);
  });

  it('is a windowed throttle, never a permanent lockout', () => {
    let state: CrewPinAttemptState = { ...EMPTY_CREW_PIN_ATTEMPT_STATE };
    let now = 0;
    for (let round = 0; round < 4; round += 1) {
      for (let index = 0; index < CREW_PIN_DEFAULT_POLICY.maxAttempts; index += 1) {
        state = registerPinFailure(state, now).state;
        now += 1_000;
      }
      assert.ok(state.lockedUntil !== null, `round ${round} should be locked`);
      now = (state.lockedUntil as number) + 1;
      state = registerPinFailure(state, now).state;
      assert.equal(state.lockedUntil, null, `round ${round} must recover automatically`);
    }
  });
});

describe('registerPinSuccess', () => {
  it('clears the strike record so a mistyped morning is not carried forward', () => {
    let state: CrewPinAttemptState = { ...EMPTY_CREW_PIN_ATTEMPT_STATE };
    state = registerPinFailure(state, 0).state;
    state = registerPinFailure(state, 1_000).state;
    assert.equal(state.failures, 2);

    const cleared = registerPinSuccess(state);
    assert.deepEqual(cleared, EMPTY_CREW_PIN_ATTEMPT_STATE);
    assert.equal(inspectPinAttempt(cleared, 2_000).remainingAttempts, 5);
  });

  it('does not mutate the state it was given', () => {
    const before: CrewPinAttemptState = { failures: 3, windowStartedAt: 10, lockedUntil: null };
    registerPinSuccess(before);
    assert.deepEqual(before, { failures: 3, windowStartedAt: 10, lockedUntil: null });
  });
});

describe('CrewPinAttemptStore', () => {
  it('round-trips a state per school key', () => {
    const store = new CrewPinAttemptStore();
    const key = CrewPinAttemptStore.keyForSchool('school-1');
    assert.equal(key, 'school:school-1');

    store.write(key, registerPinFailure(null, 0).state, 0);
    assert.equal(store.peek(key, 1_000).failures, 1);
    // Another school is a separate bucket — one school's failures must never
    // consume another's allowance.
    assert.equal(store.peek(CrewPinAttemptStore.keyForSchool('school-2'), 1_000).failures, 0);
  });

  it('keys one bucket per school, so a distinct user id cannot mint a fresh budget', () => {
    // The regression this pins: the store used to be keyed by
    // `(school_id, user_id)`. With no user id in the login body there is
    // nothing for an attacker to vary, and a key that still carried one would
    // quietly hand every guess its own bucket — i.e. no bound at all.
    const store = new CrewPinAttemptStore();
    const key = CrewPinAttemptStore.keyForSchool(SCHOOL_ID);
    let state = registerPinFailure(null, 0).state;
    store.write(key, state, 0);
    for (let index = 1; index < 4; index += 1) {
      state = registerPinFailure(store.peek(key, index), index).state;
      store.write(key, state, index);
    }
    assert.equal(store.peek(key, 10).failures, 4, 'four failures, one school, one bucket');
    assert.equal(store.size, 1);
  });

  it('evicts an exhausted window lazily on read', () => {
    const store = new CrewPinAttemptStore();
    const key = CrewPinAttemptStore.keyForSchool('s');
    store.write(key, registerPinFailure(null, 0).state, 0);
    assert.equal(store.size, 1);

    store.peek(key, CREW_PIN_DEFAULT_POLICY.windowMs + 1);
    assert.equal(store.size, 0, 'a rolled-over window is dropped on the next read');
  });

  it('keeps a live lockout even though its failure count is zero', () => {
    const store = new CrewPinAttemptStore();
    const key = CrewPinAttemptStore.keyForSchool('s');
    let state: CrewPinAttemptState = { ...EMPTY_CREW_PIN_ATTEMPT_STATE };
    for (let index = 0; index < CREW_PIN_DEFAULT_POLICY.maxAttempts; index += 1) {
      state = registerPinFailure(state, index * 1_000).state;
    }
    assert.equal(state.failures, 0, 'the lockout resets the counter');
    store.write(key, state, 10_000);
    assert.equal(store.size, 1, 'a live lockout must survive eviction');
    assert.ok((store.peek(key, 10_000).lockedUntil as number) > 10_000);
  });

  it('never writes an already-expired state', () => {
    const store = new CrewPinAttemptStore();
    store.write(
      CrewPinAttemptStore.keyForSchool('s'),
      { ...EMPTY_CREW_PIN_ATTEMPT_STATE },
      0,
    );
    assert.equal(store.size, 0);
  });

  it('bounds the map so a hostile client cannot grow it without limit', () => {
    const store = new CrewPinAttemptStore(10);
    // Eleven distinct locked-out schools, all still live, exceed maxKeys; the
    // sweep cannot drop a live lockout, so the bound is best-effort by design —
    // but the expired residue must go. (The key space is now the set of schools
    // plus one entry per bogus code someone submitted, which is far smaller
    // than the per-user key space this replaced.)
    for (let index = 0; index < 11; index += 1) {
      const key = CrewPinAttemptStore.keyForSchool(`s${index}`);
      const locked = registerPinFailure(null, 0, {
        maxAttempts: 1,
        windowMs: MINUTE,
        lockoutMs: MINUTE,
      });
      store.write(key, locked.state, 0);
    }
    assert.equal(store.size, 11, 'live lockouts are never swept');

    // Once they expire, the next write over the bound clears them all.
    const stale = new CrewPinAttemptStore(2);
    for (let index = 0; index < 3; index += 1) {
      stale.write(CrewPinAttemptStore.keyForSchool(`s${index}`), registerPinFailure(null, 0).state, 0);
    }
    assert.equal(stale.size, 3);
    stale.write(
      CrewPinAttemptStore.keyForSchool('fresh'),
      registerPinFailure(null, CREW_PIN_DEFAULT_POLICY.windowMs + 1).state,
      CREW_PIN_DEFAULT_POLICY.windowMs + 1,
    );
    assert.equal(stale.size, 1, 'the sweep must reclaim the expired windows');
  });

  it('forgets a key on demand (admin PIN reset / successful login)', () => {
    const store = new CrewPinAttemptStore();
    const key = CrewPinAttemptStore.keyForSchool('s');
    store.write(key, registerPinFailure(null, 0).state, 0);
    store.forget(key);
    assert.equal(store.size, 0);
    assert.equal(store.peek(key, 1).failures, 0);
  });
});
