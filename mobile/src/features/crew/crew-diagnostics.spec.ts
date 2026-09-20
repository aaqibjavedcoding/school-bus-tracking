import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatTime } from '../../lib/format.ts';
import { describeRuntime } from '../../lib/runtime-environment.ts';
import { buildDiagnosticsRows, type DiagnosticsRow } from './crew-diagnostics.ts';
import type { CrewTrackingState } from './tracking-lifecycle.ts';

/**
 * The support readout must never leak a secret and must never invent a fact.
 *
 * The invariants pinned here:
 *
 * - **No secret in any row.** A misconfigured `EXPO_PUBLIC_API_URL` can carry
 *   a token in the query string or in userinfo. Every row is asserted
 *   against the JWT shape, and against the exact secret strings, for a URL
 *   that carries them.
 * - **Data stays data.** Server trip statuses and stop reasons are rendered
 *   verbatim (the server-string boundary); i18n words wrap them, never
 *   replace them.
 * - **Counter arithmetic.** "Sent" is everything the server received
 *   (accepted + rejected + throttled); the row says exactly that.
 */

const RUNTIME_EXPO_GO_ANDROID = describeRuntime({
  executionEnvironment: 'storeClient',
  appOwnership: 'expo',
  platform: 'android',
});
const RUNTIME_DEV_BUILD_IOS = describeRuntime({
  executionEnvironment: 'storeClient',
  appOwnership: null,
  platform: 'ios',
});

function makeState(overrides: Partial<CrewTrackingState> = {}): CrewTrackingState {
  return {
    tripId: null,
    userId: null,
    schoolId: null,
    foregroundActive: false,
    backgroundActive: false,
    backgroundConsent: false,
    connection: 'idle',
    foregroundPermission: 'undetermined',
    backgroundPermission: 'undetermined',
    servicesEnabled: null,
    backgroundUnavailableReason: null,
    accuracy: 'unknown',
    busy: false,
    message: null,
    messageAt: null,
    lastStopReason: null,
    lastStopTripStatus: null,
    stats: {
      activeTripId: null,
      emittedCount: 0,
      invalidCount: 0,
      disconnectedCount: 0,
      rejectedCount: 0,
      throttledCount: 0,
      unauthenticatedCount: 0,
      retriedCount: 0,
      expiredCount: 0,
      supersededCount: 0,
      lastReason: null,
      lastAckAt: null,
      lastFix: null,
    },
    recovery: {
      attempts: 0,
      exhausted: false,
      inFlight: false,
      lastDisconnectClass: null,
      lastReason: null,
    },
    ...overrides,
  };
}

function valueOf(rows: DiagnosticsRow[], label: string): string {
  const row = rows.find((entry) => entry.label === label);
  assert.ok(row, `row "${label}" is rendered`);
  return row.value;
}

/** A JWT the way it actually looks on the wire (three dot-separated parts). */
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoiZHJpdmVyLTEiLCJzY2hvb2xfIjoic2Nob29sLTEifQ.sig-part-3';
const JWT_SHAPE = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

describe('buildDiagnosticsRows', () => {
  it('names the runtime the phone is actually running', () => {
    const rows = buildDiagnosticsRows(makeState(), RUNTIME_EXPO_GO_ANDROID, null);
    assert.equal(valueOf(rows, 'App runtime'), 'Expo Go · android');

    const dev = buildDiagnosticsRows(makeState(), RUNTIME_DEV_BUILD_IOS, null);
    assert.equal(valueOf(dev, 'App runtime'), 'Development build · ios');
  });

  it('shows the host only — never a token in the query string or userinfo', () => {
    const tokenInQuery = `http://192.168.1.50:3001/api/v1?access_token=${JWT}`;
    const rows = buildDiagnosticsRows(makeState(), RUNTIME_DEV_BUILD_IOS, tokenInQuery);

    assert.equal(valueOf(rows, 'Server address (API host)'), '192.168.1.50:3001');
    assert.equal(valueOf(rows, 'Live tracking socket'), '192.168.1.50:3001/live-tracking');
    for (const row of rows) {
      assert.doesNotMatch(row.value, JWT_SHAPE, `no JWT-shaped string in "${row.label}"`);
      assert.ok(!row.value.includes(JWT), `no token in "${row.label}"`);
      assert.ok(!row.value.includes('access_token'), `no query params in "${row.label}"`);
    }

    const userinfo = `http://driver:${JWT}@192.168.1.50:3001/api/v1`;
    const rows2 = buildDiagnosticsRows(makeState(), RUNTIME_DEV_BUILD_IOS, userinfo);
    assert.equal(valueOf(rows2, 'Server address (API host)'), '192.168.1.50:3001');
    for (const row of rows2) {
      assert.doesNotMatch(row.value, JWT_SHAPE, `no JWT-shaped string in "${row.label}"`);
      assert.ok(!row.value.includes('driver:'), `no userinfo in "${row.label}"`);
    }
  });

  it('says "not set" instead of guessing a server', () => {
    const rows = buildDiagnosticsRows(makeState(), RUNTIME_DEV_BUILD_IOS, null);
    assert.equal(valueOf(rows, 'Server address (API host)'), 'Not set');
    assert.equal(valueOf(rows, 'Live tracking socket'), '—');
  });

  it('reports OS and permission facts as data, with the dev-build reason where the runtime cannot run the task', () => {
    const rows = buildDiagnosticsRows(
      makeState({
        servicesEnabled: false,
        foregroundPermission: 'granted',
        backgroundPermission: 'unavailable',
        backgroundUnavailableReason: 'expo-go',
      }),
      RUNTIME_EXPO_GO_ANDROID,
      'http://10.0.0.5:3001/api/v1',
    );
    assert.equal(valueOf(rows, 'Location services'), 'Off');
    assert.equal(valueOf(rows, 'Location permission (foreground)'), 'granted');
    assert.equal(
      valueOf(rows, 'Location permission (background)'),
      'unavailable · Background needs a development build',
      'the fixable "unavailable" names its cause',
    );
  });

  it('records a server-refused trip with the server status verbatim', () => {
    const rows = buildDiagnosticsRows(
      makeState({
        lastStopReason: 'trip-not-eligible',
        lastStopTripStatus: 'COMPLETED',
      }),
      RUNTIME_DEV_BUILD_IOS,
      null,
    );
    assert.equal(valueOf(rows, 'Last stopped (server reason)'), 'trip-not-eligible · COMPLETED');
  });

  it('shows the last error with the moment it became visible', () => {
    const at = '2026-09-20T07:42:00.000Z';
    const rows = buildDiagnosticsRows(
      makeState({
        message: 'Location permission is required to share GPS with the school.',
        messageAt: at,
      }),
      RUNTIME_DEV_BUILD_IOS,
      null,
    );
    // `formatTime` renders device-local time, so the expectation is built
    // with the same formatter — this pins the *composition* (message · time),
    // not the clock.
    assert.equal(
      valueOf(rows, 'Last error'),
      `Location permission is required to share GPS with the school. · ${formatTime(at)}`,
      'the message is the app copy, the time is data',
    );
    assert.equal(
      valueOf(buildDiagnosticsRows(makeState(), RUNTIME_DEV_BUILD_IOS, null), 'Last error'),
      '—',
    );
  });

  it('does the counter arithmetic: sent = accepted + rejected + throttled', () => {
    const rows = buildDiagnosticsRows(
      makeState({
        foregroundActive: true,
        backgroundActive: true,
        stats: {
          activeTripId: 'trip-1',
          emittedCount: 10,
          invalidCount: 1,
          disconnectedCount: 3,
          rejectedCount: 2,
          throttledCount: 1,
          unauthenticatedCount: 0,
          retriedCount: 1,
          expiredCount: 0,
          supersededCount: 0,
          lastReason: 'throttled',
          lastAckAt: '2026-09-20T07:41:58.000Z',
          lastFix: null,
        },
        recovery: {
          attempts: 2,
          exhausted: true,
          inFlight: false,
          lastDisconnectClass: 'network',
          lastReason: 'transport close',
        },
      }),
      RUNTIME_DEV_BUILD_IOS,
      null,
    );
    assert.equal(
      valueOf(rows, 'Delivery counters'),
      'Sent 13 · Accepted 10 · Rejected 2 · Pending (offline) 3 · Invalid fix 1 · Retried 1',
    );
    assert.equal(valueOf(rows, 'Sharing running'), 'foreground + background');
    assert.equal(
      valueOf(rows, 'Recovery attempts (last reason)'),
      '2 · budget exhausted · transport close',
    );
  });

  it('runs with sharing off: the sharing row is the no-fact dash', () => {
    const rows = buildDiagnosticsRows(makeState(), RUNTIME_DEV_BUILD_IOS, null);
    assert.equal(valueOf(rows, 'Sharing running'), '—');
  });
});
