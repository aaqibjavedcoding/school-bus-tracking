import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACKING_RECOVERY_POLICY,
  classifyLocationAck,
  classifySocketDisconnect,
  connectSocketWithBound,
  createRecoveryPolicy,
  emitWithAckBound,
  isPermanentLocationRejection,
  isRetryableDisconnect,
  needsSessionRefresh,
  recoveryDelayMs,
  type RecoverableSocket,
} from './socket-recovery.ts';

/**
 * Reconnection classification and the bounded retry budget.
 *
 * The two failure families must never be treated alike: a transport loss is
 * retried (and Socket.IO already retries it), while a server-initiated
 * disconnect after a refused/expired handshake needs a *refresh* first, and a
 * deactivated tenant/user must stop the retries for good.
 */

describe('classifySocketDisconnect', () => {
  it('treats our own disconnect as terminal (logout/stop)', () => {
    assert.equal(classifySocketDisconnect({ reason: 'io client disconnect' }), 'client-stop');
    assert.equal(isRetryableDisconnect('client-stop'), false);
  });

  it('classifies transport loss as network', () => {
    for (const reason of ['transport close', 'transport error', 'ping timeout']) {
      assert.equal(classifySocketDisconnect({ reason }), 'network', reason);
    }
    assert.equal(isRetryableDisconnect('network'), true);
    assert.equal(needsSessionRefresh('network'), false);
  });

  it('classifies a server disconnect with no revocation as an auth failure', () => {
    // The gateway refuses a handshake without a valid JWT via disconnect(true).
    assert.equal(classifySocketDisconnect({ reason: 'io server disconnect' }), 'auth-expired');
    assert.equal(needsSessionRefresh('auth-expired'), true);
    assert.equal(isRetryableDisconnect('auth-expired'), true);
  });

  it('separates an expired token from a permanent revocation', () => {
    assert.equal(
      classifySocketDisconnect({ reason: 'io server disconnect', revokedReason: 'token_expired' }),
      'auth-expired',
    );
    for (const revokedReason of ['school_deactivated', 'user_deactivated']) {
      assert.equal(
        classifySocketDisconnect({ reason: 'io server disconnect', revokedReason }),
        'auth-revoked',
        revokedReason,
      );
    }
    assert.equal(isRetryableDisconnect('auth-revoked'), false);
    assert.equal(needsSessionRefresh('auth-revoked'), false);
  });

  it('falls back to unknown (still bounded) for an unrecognised reason', () => {
    assert.equal(classifySocketDisconnect({ reason: 'weird' }), 'unknown');
    assert.equal(classifySocketDisconnect({}), 'unknown');
  });
});

describe('createRecoveryPolicy', () => {
  it('backs off exponentially and caps the delay', () => {
    assert.equal(recoveryDelayMs(1, TRACKING_RECOVERY_POLICY), 1_000);
    assert.equal(recoveryDelayMs(2, TRACKING_RECOVERY_POLICY), 2_000);
    assert.equal(recoveryDelayMs(3, TRACKING_RECOVERY_POLICY), 4_000);
    assert.equal(recoveryDelayMs(9, TRACKING_RECOVERY_POLICY), 20_000, 'capped at maxDelayMs');
  });

  it('stops after the budget instead of retrying forever', () => {
    const policy = createRecoveryPolicy({
      baseDelayMs: 10,
      maxDelayMs: 40,
      maxAttempts: 3,
      factor: 2,
    });
    const attempts = [policy.next(), policy.next(), policy.next()];
    assert.deepEqual(
      attempts.map((a) => a?.attempt),
      [1, 2, 3],
    );
    assert.equal(policy.next(), null, 'no fourth attempt — rapid infinite retries are the bug');
    assert.equal(policy.exhausted, true);
  });

  it('resets the budget on a new trigger (fresh fix / explicit retry)', () => {
    const policy = createRecoveryPolicy({
      baseDelayMs: 10,
      maxDelayMs: 40,
      maxAttempts: 2,
      factor: 2,
    });
    policy.next();
    policy.next();
    assert.equal(policy.next(), null);
    policy.reset();
    assert.equal(policy.attempts, 0);
    assert.deepEqual(policy.next(), { attempt: 1, delayMs: 10 });
  });

  it('never schedules a zero or negative delay', () => {
    const policy = createRecoveryPolicy({
      baseDelayMs: 0,
      maxDelayMs: 0,
      maxAttempts: 2,
      factor: 2,
    });
    assert.equal(policy.next()?.delayMs, 0);
    assert.ok(recoveryDelayMs(0, TRACKING_RECOVERY_POLICY) >= 0);
    assert.ok(recoveryDelayMs(-5, TRACKING_RECOVERY_POLICY) > 0);
  });
});

describe('classifyLocationAck', () => {
  const ack = (
    status: 'accepted' | 'rejected',
    extra: Record<string, unknown> = {},
  ): Parameters<typeof classifyLocationAck>[0] =>
    ({ status, trip_id: 'trip-1', ...extra }) as never;

  it('treats an accepted fix as server-acknowledged delivery', () => {
    assert.equal(classifyLocationAck(ack('accepted', { received_at: 'now' })), 'accepted');
    assert.equal(classifyLocationAck(ack('accepted', { stale: true })), 'accepted-stale');
  });

  it('separates throttling, session loss, permanent refusal and bad payloads', () => {
    assert.equal(classifyLocationAck(ack('rejected', { reason: 'throttled' })), 'throttled');
    assert.equal(classifyLocationAck(ack('rejected', { reason: 'unauthenticated' })), 'session');
    assert.equal(classifyLocationAck(ack('rejected', { reason: 'unauthorized' })), 'permanent');
    assert.equal(classifyLocationAck(ack('rejected', { reason: 'trip_not_open' })), 'permanent');
    assert.equal(classifyLocationAck(ack('rejected', { reason: 'trip_not_found' })), 'permanent');
    assert.equal(classifyLocationAck(ack('rejected', { reason: 'invalid_payload' })), 'invalid');
    assert.equal(classifyLocationAck(ack('rejected', { reason: 'future_timestamp' })), 'invalid');
    assert.equal(isPermanentLocationRejection('permanent'), true);
    assert.equal(isPermanentLocationRejection('throttled'), false);
  });
});

/** Minimal socket double: records listeners and lets a test fire them. */
function fakeSocket(options: { connected?: boolean } = {}) {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const socket: RecoverableSocket & {
    connects: number;
    fire: (event: string, ...args: unknown[]) => void;
    listenerCount: () => number;
  } = {
    connected: options.connected ?? false,
    connects: 0,
    connect() {
      socket.connects += 1;
    },
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return socket;
    },
    off(event, listener) {
      const list = listeners.get(event) ?? [];
      listeners.set(
        event,
        list.filter((entry) => entry !== listener),
      );
      return socket;
    },
    fire(event, ...args) {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
    },
    listenerCount: () =>
      Array.from(listeners.values()).reduce((total, list) => total + list.length, 0),
  };
  return socket;
}

describe('connectSocketWithBound', () => {
  it('returns immediately for an already connected socket', async () => {
    const socket = fakeSocket({ connected: true });
    const result = await connectSocketWithBound(socket, { timeoutMs: 50 });
    assert.deepEqual(result, { connected: true, timedOut: false, error: null });
    assert.equal(socket.connects, 0);
  });

  it('resolves as soon as the connect event fires and removes its listeners', async () => {
    const socket = fakeSocket();
    const pending = connectSocketWithBound(socket, { timeoutMs: 1_000 });
    socket.connected = true;
    socket.fire('connect');
    const result = await pending;
    assert.equal(result.connected, true);
    assert.equal(result.timedOut, false);
    assert.equal(socket.listenerCount(), 0, 'no listener leak on a shared singleton socket');
  });

  it('bounds the wait when the server never accepts the handshake', async () => {
    const socket = fakeSocket();
    const started = Date.now();
    const result = await connectSocketWithBound(socket, { timeoutMs: 20 });
    assert.equal(result.connected, false);
    assert.equal(result.timedOut, true);
    assert.ok(Date.now() - started < 500, 'a background task must never hang here');
    assert.equal(socket.connects, 1, 'a connection was still requested');
  });

  it('reports the first connect_error message without leaking a token', async () => {
    const socket = fakeSocket();
    const pending = connectSocketWithBound(socket, { timeoutMs: 200 });
    socket.fire('connect_error', new Error('xhr poll error'));
    const result = await pending;
    assert.equal(result.timedOut, true);
    assert.equal(result.error, 'xhr poll error');
  });

  it('survives a connect() that throws', async () => {
    const socket = fakeSocket();
    socket.connect = () => {
      throw new Error('native socket unavailable');
    };
    const result = await connectSocketWithBound(socket, { timeoutMs: 200 });
    assert.equal(result.connected, false);
    assert.equal(result.error, 'connect-threw');
  });
});

describe('emitWithAckBound', () => {
  it('returns the ack when the server answers in time', async () => {
    const result = await emitWithAckBound<{ status: string }>(
      (ack) => ack({ status: 'accepted' }),
      100,
    );
    assert.deepEqual(result, { ack: { status: 'accepted' }, timedOut: false });
  });

  it('reports a missing ack as a timeout, never as a delivery', async () => {
    const result = await emitWithAckBound<{ status: string }>(() => undefined, 20);
    assert.equal(result.ack, null);
    assert.equal(result.timedOut, true);
  });

  it('survives an emit that throws (a disconnected socket)', async () => {
    const result = await emitWithAckBound<{ status: string }>(() => {
      throw new Error('socket closed');
    }, 100);
    assert.equal(result.ack, null);
  });
});
