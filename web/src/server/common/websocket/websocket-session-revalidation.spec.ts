import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Server as IoServer } from 'socket.io';
import {
  WebSocketSessionRevalidation,
  resolveTokenExpiry,
  getRegisteredWebSocketSessionRevalidation,
  registerWebSocketSessionRevalidation,
} from './websocket-session-revalidation';

/**
 * Unit surface of the periodic session sweep. The Server is faked at the one
 * method the sweep uses (`of(ns).fetchSockets()`); sockets are plain objects
 * recording `emit`/`disconnect` calls.
 */

const NOW = 1_800_000_000_000; // fixed epoch ms

interface FakeSocket {
  id: string;
  data: Record<string, unknown>;
  emitted: Array<{ event: string; payload: unknown }>;
  disconnected: boolean;
  emit(event: string, payload: unknown): unknown;
  disconnect(close?: boolean): void;
}

function makeSocket(data: Record<string, unknown> = {}): FakeSocket {
  const socket: FakeSocket = {
    id: 'sock-' + Math.random().toString(36).slice(2, 8),
    data,
    emitted: [],
    disconnected: false,
    emit(event, payload) {
      socket.emitted.push({ event, payload });
      return true;
    },
    disconnect(close = true) {
      socket.disconnected = close;
    },
  };
  return socket;
}

interface StubUserRow {
  id: string;
  is_active: boolean;
}

interface Harness {
  revalidation: WebSocketSessionRevalidation;
  socketsByNamespace: Map<string, FakeSocket[]>;
  schoolAccessibility: Map<string, boolean>;
  userRows: StubUserRow[];
  schoolLookups: string[];
  userLookups: number;
  failSchoolLookup: boolean;
  failUserLookup: boolean;
}

function makeHarness(namespaces: string[], options: { intervalMs?: number } = {}): Harness {
  const socketsByNamespace = new Map<string, FakeSocket[]>();
  for (const ns of namespaces) {
    socketsByNamespace.set(ns, []);
  }

  const harness: Harness = {
    socketsByNamespace,
    schoolAccessibility: new Map(),
    userRows: [],
    schoolLookups: [],
    userLookups: 0,
    failSchoolLookup: false,
    failUserLookup: false,
    revalidation: null as never,
  };

  const server = {
    of(namespace: string) {
      return {
        fetchSockets: async () => socketsByNamespace.get(namespace) ?? [],
      };
    },
  } as unknown as IoServer;

  const schoolAccess = {
    isSchoolAccessible: async (schoolId: string | null | undefined) => {
      if (schoolId === null || schoolId === undefined) {
        return true;
      }
      harness.schoolLookups.push(schoolId);
      if (harness.failSchoolLookup) {
        throw new Error('schools table unreachable');
      }
      return harness.schoolAccessibility.get(schoolId) ?? true;
    },
  };

  const users = {
    findAll: async () => {
      harness.userLookups += 1;
      if (harness.failUserLookup) {
        throw new Error('users table unreachable');
      }
      return harness.userRows as never;
    },
  };

  harness.revalidation = new WebSocketSessionRevalidation(
    server,
    schoolAccess as never,
    users as never,
    { intervalMs: options.intervalMs, namespaces },
  );
  return harness;
}

function userOf(id: string, schoolId: string | null, tokenExp?: number): Record<string, unknown> {
  const data: Record<string, unknown> = { user: { id, school_id: schoolId, role: 'PARENT' } };
  if (tokenExp !== undefined) {
    data.token_exp = tokenExp;
  }
  return data;
}

describe('WebSocketSessionRevalidation — revalidate()', () => {
  const realNow = Date.now;
  beforeEach(() => {
    Date.now = () => NOW;
  });
  afterEach(() => {
    Date.now = realNow;
    registerWebSocketSessionRevalidation(null);
  });

  it('disconnects sockets whose access token expired since the handshake, without touching the database', async () => {
    const harness = makeHarness(['/notifications']);
    const expired = makeSocket(userOf('u-exp', 'school-1', Math.floor(NOW / 1000) - 10));
    harness.socketsByNamespace.get('/notifications')!.push(expired);

    const result = await harness.revalidation.revalidate();

    assert.deepEqual(result, { checked: 1, disconnected: 1 });
    assert.equal(expired.disconnected, true);
    assert.deepEqual(expired.emitted, [
      { event: 'session:revoked', payload: { reason: 'token_expired' } },
    ]);
    assert.equal(harness.userLookups, 0, 'the expiry decision must not hit the users table');
    assert.equal(
      harness.schoolLookups.length,
      0,
      'the expiry decision must not hit the schools table',
    );
  });

  it('revokes only the expired-token socket of a mixed pass and keeps the rest flowing', async () => {
    const harness = makeHarness(['/notifications']);
    const expired = makeSocket(userOf('u-exp', 'school-1', Math.floor(NOW / 1000) - 10));
    const alive = makeSocket(userOf('u-ok', 'school-1', Math.floor(NOW / 1000) + 600));
    harness.socketsByNamespace.get('/notifications')!.push(expired, alive);
    harness.userRows = [{ id: 'u-ok', is_active: true }];

    const result = await harness.revalidation.revalidate();

    // Both sockets were examined; only the expired-token one was revoked.
    assert.deepEqual(result, { checked: 2, disconnected: 1 });
    assert.equal(expired.disconnected, true);
    assert.equal(alive.disconnected, false);
  });

  it('disconnects sockets of deactivated schools and deactivated/missing users', async () => {
    const harness = makeHarness(['/live-tracking']);
    harness.schoolAccessibility.set('school-dead', false);
    harness.userRows = [{ id: 'u-active', is_active: true }];
    const schoolSocket = makeSocket(userOf('u-1', 'school-dead'));
    const inactiveUserSocket = makeSocket(
      userOf('u-2', 'school-live', Math.floor(NOW / 1000) + 600),
    );
    const missingUserSocket = makeSocket(
      userOf('u-gone', 'school-live', Math.floor(NOW / 1000) + 600),
    );
    const healthySocket = makeSocket(
      userOf('u-active', 'school-live', Math.floor(NOW / 1000) + 600),
    );
    harness.socketsByNamespace
      .get('/live-tracking')!
      .push(schoolSocket, inactiveUserSocket, missingUserSocket, healthySocket);

    const result = await harness.revalidation.revalidate();

    assert.deepEqual(result, { checked: 4, disconnected: 3 });
    assert.equal(schoolSocket.disconnected, true);
    assert.deepEqual(schoolSocket.emitted, [
      { event: 'session:revoked', payload: { reason: 'school_deactivated' } },
    ]);
    assert.equal(inactiveUserSocket.disconnected, true);
    assert.deepEqual(inactiveUserSocket.emitted, [
      { event: 'session:revoked', payload: { reason: 'user_deactivated' } },
    ]);
    assert.equal(
      missingUserSocket.disconnected,
      true,
      'users missing from the DB are treated as inactive',
    );
    assert.equal(healthySocket.disconnected, false);
    // Batched: one lookup per distinct school, one query for all users.
    assert.deepEqual([...new Set(harness.schoolLookups)].length, harness.schoolLookups.length);
    assert.equal(harness.userLookups, 1);
  });

  it('sweeps every wired namespace in one pass', async () => {
    const namespaces = ['/live-tracking', '/notifications', '/emergencies'];
    const harness = makeHarness(namespaces);
    harness.schoolAccessibility.set('school-dead', false);
    harness.userRows = namespaces.map((ns) => ({ id: `u-${ns}`, is_active: true }));
    for (const ns of namespaces) {
      const socket = makeSocket(userOf(`u-${ns}`, 'school-dead', Math.floor(NOW / 1000) + 600));
      harness.socketsByNamespace.get(ns)!.push(socket);
    }

    const result = await harness.revalidation.revalidate();

    assert.deepEqual(result, { checked: 3, disconnected: 3 });
    for (const ns of namespaces) {
      assert.equal(harness.socketsByNamespace.get(ns)![0].disconnected, true, ns);
    }
  });

  it('skips sockets without authenticated user data instead of disconnecting them', async () => {
    const harness = makeHarness(['/notifications']);
    const anonymous = makeSocket({ something: 'else' });
    harness.socketsByNamespace.get('/notifications')!.push(anonymous);

    const result = await harness.revalidation.revalidate();

    assert.deepEqual(result, { checked: 0, disconnected: 0 });
    assert.equal(anonymous.disconnected, false);
  });

  it('keeps every socket connected when the database checks fail (fail-safe pass)', async () => {
    const harness = makeHarness(['/notifications']);
    harness.failUserLookup = true;
    const socket = makeSocket(userOf('u-1', 'school-1', Math.floor(NOW / 1000) + 600));
    harness.socketsByNamespace.get('/notifications')!.push(socket);

    const result = await harness.revalidation.revalidate();

    assert.deepEqual(result, { checked: 1, disconnected: 0 });
    assert.equal(socket.disconnected, false);
  });

  it('keeps sockets connected when the school lookup fails', async () => {
    const harness = makeHarness(['/live-tracking']);
    harness.failSchoolLookup = true;
    const socket = makeSocket(userOf('u-1', 'school-1', Math.floor(NOW / 1000) + 600));
    harness.socketsByNamespace.get('/live-tracking')!.push(socket);

    const result = await harness.revalidation.revalidate();

    assert.deepEqual(result, { checked: 1, disconnected: 0 });
    assert.equal(socket.disconnected, false);
  });

  it('returns zeroes when no sockets are connected', async () => {
    const harness = makeHarness(['/notifications']);
    const result = await harness.revalidation.revalidate();
    assert.deepEqual(result, { checked: 0, disconnected: 0 });
  });
});

describe('WebSocketSessionRevalidation — start()/stop()', () => {
  it('starts once, reports the state, and stops cleanly', async () => {
    const harness = makeHarness(['/notifications'], { intervalMs: 60_000 });

    harness.revalidation.start();
    assert.equal(harness.revalidation.isStarted(), true);
    harness.revalidation.start(); // idempotent
    assert.equal(harness.revalidation.isStarted(), true);

    harness.revalidation.stop();
    harness.revalidation.stop(); // idempotent
    assert.equal(harness.revalidation.isStarted(), false);
  });

  it('a thrown revalidation pass never escapes the interval callback', async () => {
    const harness = makeHarness(['/notifications'], { intervalMs: 5 });
    let calls = 0;
    harness.revalidation['revalidate'] = async () => {
      calls += 1;
      throw new Error('sweep exploded');
    };

    harness.revalidation.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    harness.revalidation.stop();

    assert.ok(calls >= 1, 'the interval ran; the error was swallowed');
  });

  it('registers and unregisters the process-wide instance', () => {
    const harness = makeHarness(['/notifications']);
    assert.equal(getRegisteredWebSocketSessionRevalidation(), null);
    registerWebSocketSessionRevalidation(harness.revalidation);
    assert.equal(getRegisteredWebSocketSessionRevalidation(), harness.revalidation);
    registerWebSocketSessionRevalidation(null);
    assert.equal(getRegisteredWebSocketSessionRevalidation(), null);
  });
});

describe('resolveTokenExpiry', () => {
  it('extracts a numeric exp claim and rejects everything else', () => {
    assert.equal(resolveTokenExpiry({ exp: 12345 }), 12345);
    assert.equal(resolveTokenExpiry({ exp: '12345' }), null);
    assert.equal(resolveTokenExpiry({}), null);
    assert.equal(resolveTokenExpiry(null), null);
    assert.equal(resolveTokenExpiry(undefined), null);
  });
});
