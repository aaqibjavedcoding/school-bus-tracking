import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_FIX_FRESH_WINDOW_MS,
  SERVER_ACK_LIVE_WINDOW_MS,
  SERVER_ACK_STALE_WINDOW_MS,
  crewTrackingStatusCopy,
  crewTrackingStatusTone,
  deriveCrewTrackingStatus,
  freshnessBucket,
  type CrewTrackingStatusInput,
} from './tracking-status.ts';

/**
 * The honesty rules for "can the school see my bus?".
 *
 * The central assertion of this suite: a local device fix alone must never
 * produce `live` / `schoolSeesLive`. Only a server acknowledgement inside the
 * live window may. And every state must keep ageing when no new data arrives.
 */

const NOW = Date.parse('2026-09-19T08:00:00.000Z');
const iso = (offsetMs: number): string => new Date(NOW - offsetMs).toISOString();

function input(overrides: Partial<CrewTrackingStatusInput> = {}): CrewTrackingStatusInput {
  return {
    foregroundActive: true,
    backgroundActive: false,
    foregroundPermission: 'granted',
    servicesEnabled: true,
    connection: 'connected',
    lastLocalFixAt: null,
    lastServerAckAt: null,
    now: NOW,
    ...overrides,
  };
}

describe('deriveCrewTrackingStatus', () => {
  it('is live only on a recent SERVER acknowledgement', () => {
    const result = deriveCrewTrackingStatus(input({ lastServerAckAt: iso(4_000) }));
    assert.equal(result.status, 'live');
    assert.equal(result.schoolSeesLive, true);
    assert.equal(result.serverAckAgeMs, 4_000);
  });

  it('does NOT claim the school sees the bus on a local fix alone', () => {
    const result = deriveCrewTrackingStatus(input({ lastLocalFixAt: iso(1_000) }));
    assert.equal(result.status, 'local-only');
    assert.equal(result.schoolSeesLive, false, 'a phone with GPS is not a delivered position');
  });

  it('ages out of live into stale when acknowledgements stop arriving', () => {
    const justOutside = deriveCrewTrackingStatus(
      input({ lastServerAckAt: iso(SERVER_ACK_LIVE_WINDOW_MS + 1_000) }),
    );
    assert.equal(justOutside.status, 'stale');
    assert.equal(justOutside.schoolSeesLive, false);

    const longGone = deriveCrewTrackingStatus(
      input({ lastServerAckAt: iso(SERVER_ACK_STALE_WINDOW_MS + 1_000) }),
    );
    assert.equal(longGone.status, 'stale', 'an old acknowledgement stays "stale", never "live"');
    assert.equal(longGone.schoolSeesLive, false);
  });

  it('ages a local-only fix into waiting-for-fix when nothing new arrives', () => {
    const result = deriveCrewTrackingStatus(
      input({ lastLocalFixAt: iso(LOCAL_FIX_FRESH_WINDOW_MS + 1_000) }),
    );
    assert.equal(result.status, 'waiting-for-fix');
  });

  it('reports connecting and reconnecting instead of pretending to be live', () => {
    assert.equal(deriveCrewTrackingStatus(input({ connection: 'connecting' })).status, 'connecting');
    const reconnecting = deriveCrewTrackingStatus(
      input({ connection: 'reconnecting', lastLocalFixAt: iso(1_000) }),
    );
    assert.equal(reconnecting.status, 'reconnecting');
    assert.equal(reconnecting.recovering, true);
    assert.equal(reconnecting.schoolSeesLive, false);
  });

  it('surfaces an exhausted recovery budget without claiming liveness', () => {
    const result = deriveCrewTrackingStatus(
      input({ connection: 'gave-up', lastServerAckAt: iso(SERVER_ACK_LIVE_WINDOW_MS + 1) }),
    );
    assert.equal(result.status, 'reconnecting');
    assert.equal(result.recoveryExhausted, true);
    assert.equal(result.schoolSeesLive, false);
  });

  it('keeps a live acknowledgement visible while a reconnect is in flight', () => {
    // A fresh ack plus a dropped socket: the position IS on the server, but the
    // stream is down — recovery, not liveness, is the honest headline.
    const result = deriveCrewTrackingStatus(
      input({ connection: 'reconnecting', lastServerAckAt: iso(2_000) }),
    );
    assert.equal(result.status, 'live', 'the ack is inside the live window');
    assert.equal(result.recovering, true);
  });

  it('reports permission and service problems before blaming the network', () => {
    assert.equal(
      deriveCrewTrackingStatus(input({ foregroundPermission: 'denied' })).status,
      'permission-blocked',
    );
    assert.equal(
      deriveCrewTrackingStatus(input({ foregroundPermission: 'undetermined' })).status,
      'permission-blocked',
    );
    assert.equal(
      deriveCrewTrackingStatus(input({ servicesEnabled: false })).status,
      'services-off',
    );
    assert.equal(
      deriveCrewTrackingStatus(input({ servicesEnabled: null })).status,
      'waiting-for-fix',
      'an unanswered platform query is not reported as "services off"',
    );
  });

  it('reports a permanent revocation distinctly and above everything else', () => {
    assert.equal(deriveCrewTrackingStatus(input({ connection: 'revoked' })).status, 'revoked');
    assert.equal(
      deriveCrewTrackingStatus(
        input({ connection: 'revoked', foregroundActive: false, backgroundActive: false }),
      ).status,
      'revoked',
    );
  });

  it('is stopped when neither the watch nor the background task is running', () => {
    const result = deriveCrewTrackingStatus(
      input({ foregroundActive: false, backgroundActive: false, lastServerAckAt: iso(1_000) }),
    );
    assert.equal(result.status, 'stopped');
    assert.equal(result.schoolSeesLive, false);
  });

  it('counts a background-only session as running', () => {
    const result = deriveCrewTrackingStatus(
      input({ foregroundActive: false, backgroundActive: true, lastServerAckAt: iso(1_000) }),
    );
    assert.equal(result.status, 'live');
  });

  it('ignores unparseable timestamps rather than reporting them as fresh', () => {
    const result = deriveCrewTrackingStatus(
      input({ lastServerAckAt: 'not-a-date', lastLocalFixAt: 'also-bad' }),
    );
    assert.equal(result.serverAckAgeMs, null);
    assert.equal(result.localFixAgeMs, null);
    assert.equal(result.status, 'waiting-for-fix');
  });
});

describe('freshnessBucket', () => {
  it('ages without needing new data', () => {
    assert.equal(freshnessBucket(null), 'none');
    assert.equal(freshnessBucket(1_000), 'just-now');
    assert.equal(freshnessBucket(30_000), 'seconds');
    assert.equal(freshnessBucket(5 * 60_000), 'minutes');
    assert.equal(freshnessBucket(3 * 60 * 60_000), 'hours');
    assert.equal(freshnessBucket(3 * 24 * 60 * 60_000), 'old');
    assert.equal(freshnessBucket(-5), 'just-now', 'a slightly future clock is not "old"');
  });
});

describe('status copy', () => {
  const formatAge = (ageMs: number | null): string => (ageMs === null ? 'never' : `${ageMs}ms`);

  it('names the acknowledgement, never the local fix, when live', () => {
    const copy = crewTrackingStatusCopy({
      status: 'live',
      serverAckAgeMs: 4_000,
      localFixAgeMs: 1_000,
      formatAge,
    });
    assert.equal(copy.key, 'gps.status.live');
    assert.deepEqual(copy.params, { time: '4000ms' });
  });

  it('labels an undelivered local fix as undelivered', () => {
    const copy = crewTrackingStatusCopy({
      status: 'local-only',
      serverAckAgeMs: null,
      localFixAgeMs: 1_000,
      formatAge,
    });
    assert.equal(copy.key, 'gps.status.localOnly');
    assert.deepEqual(copy.params, { time: '1000ms' });
  });

  it('has a distinct key and tone per state', () => {
    const states = [
      'live',
      'local-only',
      'connecting',
      'reconnecting',
      'stale',
      'waiting-for-fix',
      'permission-blocked',
      'services-off',
      'revoked',
      'stopped',
    ] as const;
    const keys = states.map(
      (status) =>
        crewTrackingStatusCopy({
          status,
          serverAckAgeMs: null,
          localFixAgeMs: null,
          formatAge,
        }).key,
    );
    assert.equal(new Set(keys).size, keys.length, 'every state reads differently');
    assert.equal(crewTrackingStatusTone('live'), 'success');
    assert.equal(crewTrackingStatusTone('reconnecting'), 'warning');
    assert.equal(crewTrackingStatusTone('revoked'), 'danger');
    assert.equal(crewTrackingStatusTone('stopped'), 'neutral');
  });
});
