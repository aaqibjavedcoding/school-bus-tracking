import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiResponse, RefreshResponse } from '@school-bus-tracking/shared-types';
import {
  __resetSessionRecoveryForTests,
  invalidateSessionRecovery,
  isSessionRecoveryInFlight,
  recoverSession,
  sessionRecoveryGeneration,
} from './session-recovery.ts';

/**
 * Session recovery for headless runtimes.
 *
 * The behaviour under test is the one a background-location execution depends
 * on: an empty in-memory token must be turned into an authenticated session
 * through the existing cookie refresh, without two callers racing the server's
 * refresh-token rotation, without hanging when the network is slow, and without
 * a late completion resurrecting a session that was signed out mid-flight.
 */

function envelope(token: string | null, userId = 'user-1'): ApiResponse<RefreshResponse> {
  if (!token) {
    return { success: false, error: { code: 'UNAUTHORIZED', message: 'No session' }, timestamp: '' };
  }
  return {
    success: true,
    timestamp: '',
    data: {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 900,
      user: {
        id: userId,
        school_id: 'school-1',
        role: 'DRIVER',
        first_name: 'A',
        last_name: 'B',
        email: null,
      } as RefreshResponse['user'],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Harness {
  calls: number;
  tokens: string[];
  /** One gate per refresh attempt, so a test can answer them independently. */
  gates: Array<ReturnType<typeof deferred<ApiResponse<RefreshResponse>>>>;
  deps: Parameters<typeof recoverSession>[0];
  /** Answers the most recent attempt. */
  respond: (value: ApiResponse<RefreshResponse>) => void;
  fail: (error: unknown) => void;
  /** Answers one specific attempt (0-based). */
  answer: (index: number, value: ApiResponse<RefreshResponse>) => void;
}

function harness(options: { token?: string | null; timeoutMs?: number } = {}): Harness {
  const state: Harness = {
    calls: 0,
    tokens: [],
    gates: [],
    deps: {},
    respond: () => undefined,
    fail: () => undefined,
    answer: () => undefined,
  };
  let current = options.token ?? null;
  state.deps = {
    currentToken: () => current,
    applyToken: (token: string) => {
      current = token;
      state.tokens.push(token);
    },
    timeoutMs: options.timeoutMs ?? 1_000,
    refresh: () => {
      state.calls += 1;
      const gate = deferred<ApiResponse<RefreshResponse>>();
      state.gates.push(gate);
      state.respond = (value) => gate.resolve(value);
      state.fail = (error) => gate.reject(error);
      state.answer = (index, value) => state.gates[index]?.resolve(value);
      return gate.promise;
    },
  };
  return state;
}

describe('recoverSession', () => {
  afterEach(() => {
    __resetSessionRecoveryForTests();
  });

  it('recovers an authenticated session when the in-memory token is empty', async () => {
    const h = harness();
    const run = recoverSession(h.deps);
    h.respond(envelope('jwt-1'));

    const result = await run;
    assert.equal(result.status, 'authenticated');
    assert.equal(result.reason, 'refreshed');
    assert.equal(result.accessToken, 'jwt-1');
    assert.deepEqual(result.user, { id: 'user-1', school_id: 'school-1', role: 'DRIVER' });
    assert.deepEqual(h.tokens, ['jwt-1'], 'the recovered token is installed in the session');
    assert.equal(h.calls, 1);
  });

  it('takes the fast path when a token is already in memory (no rotation)', async () => {
    const h = harness({ token: 'jwt-present' });
    const result = await recoverSession(h.deps);

    assert.equal(result.status, 'authenticated');
    assert.equal(result.reason, 'token-present');
    assert.equal(h.calls, 0, 'no refresh request — nothing to rotate');
    assert.equal(result.user, null, 'identity is unknown without a refresh');
  });

  it('shares one attempt between concurrent callers (no refresh-token race)', async () => {
    const h = harness();
    const first = recoverSession(h.deps);
    const second = recoverSession(h.deps);
    const third = recoverSession(h.deps);
    assert.equal(isSessionRecoveryInFlight(), true);
    h.respond(envelope('jwt-shared'));

    const [a, b, c] = await Promise.all([first, second, third]);
    assert.equal(h.calls, 1, 'exactly one POST /auth/refresh for three callers');
    assert.equal(a.shared, false);
    assert.equal(b.shared, true);
    assert.equal(c.shared, true);
    for (const result of [a, b, c]) {
      assert.equal(result.status, 'authenticated');
      assert.equal(result.accessToken, 'jwt-shared');
    }
    assert.deepEqual(h.tokens, ['jwt-shared'], 'the token is applied exactly once');
    assert.equal(isSessionRecoveryInFlight(), false, 'the attempt is released afterwards');
  });

  it('reports a rejected refresh as anonymous and installs no token', async () => {
    const h = harness();
    const run = recoverSession(h.deps);
    h.respond(envelope(null));

    const result = await run;
    assert.equal(result.status, 'anonymous');
    assert.equal(result.reason, 'refresh-rejected');
    assert.deepEqual(h.tokens, []);
  });

  it('reports a network/API failure without throwing', async () => {
    const h = harness();
    const run = recoverSession(h.deps);
    h.fail(new Error('Network request failed'));

    const result = await run;
    assert.equal(result.status, 'anonymous');
    assert.equal(result.reason, 'failed');
    assert.deepEqual(h.tokens, []);
  });

  it('bounds the wait: a slow refresh resolves as timeout, not a hung task', async () => {
    const h = harness({ timeoutMs: 15 });
    const started = Date.now();
    const result = await recoverSession(h.deps);
    const elapsed = Date.now() - started;

    assert.equal(result.status, 'timeout');
    assert.equal(result.reason, 'timed-out');
    assert.ok(elapsed < 500, `the caller waited ${elapsed}ms for a request that never answered`);
    assert.equal(isSessionRecoveryInFlight(), false, 'the shared slot is released on timeout');

    // The work itself is not cancelled: when it finally lands, the session is
    // still installed (it is a valid session for the same generation).
    h.respond(envelope('jwt-late'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(h.tokens, ['jwt-late']);
  });

  it('discards a late completion after logout/account switch (no resurrected session)', async () => {
    const h = harness();
    const run = recoverSession(h.deps);
    const generationBefore = sessionRecoveryGeneration();

    invalidateSessionRecovery(); // logout / account switch while in flight
    h.respond(envelope('jwt-stale'));

    const result = await run;
    assert.equal(result.status, 'anonymous');
    assert.equal(result.reason, 'cancelled');
    assert.deepEqual(h.tokens, [], 'the stale token is never installed');
    assert.equal(sessionRecoveryGeneration(), generationBefore + 1);
  });

  it('does not join an attempt that belongs to a previous generation', async () => {
    const h = harness();
    const first = recoverSession(h.deps);
    invalidateSessionRecovery();
    const second = recoverSession(h.deps);

    // Two separate attempts: the second is not the invalidated first.
    assert.equal(h.calls, 2);
    h.answer(0, envelope('jwt-old'));
    h.answer(1, envelope('jwt-new'));
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.reason, 'cancelled', 'the pre-logout attempt installs nothing');
    assert.equal(b.status, 'authenticated');
    assert.equal(b.accessToken, 'jwt-new');
    assert.deepEqual(h.tokens, ['jwt-new']);
  });
});
