import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GPS_LIVE_WINDOW_MS, GPS_STALE_WINDOW_MS } from '@school-bus-tracking/shared-types';
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
    assert.equal(
      deriveCrewTrackingStatus(input({ connection: 'connecting' })).status,
      'connecting',
    );
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

/**
 * Three freshness questions, three concepts — even where the durations are the
 * same number.
 *
 * | concept                        | constant(s)                                          | question it answers                       |
 * | ------------------------------ | ---------------------------------------------------- | ----------------------------------------- |
 * | delivery (server acknowledgement) | `SERVER_ACK_LIVE_WINDOW_MS` / `SERVER_ACK_STALE_WINDOW_MS` | can the school see a current position?    |
 * | local fix                      | `LOCAL_FIX_FRESH_WINDOW_MS`                          | is this phone's GPS producing fixes?      |
 * | observer (delivered to a screen) | `GPS_LIVE_WINDOW_MS` / `GPS_STALE_WINDOW_MS` (shared) | how old is the position on my map?        |
 *
 * The delivery windows are now *imports* of the shared constants rather than
 * literals a spec pinned to the observer's — one definition, no drift. The
 * local-fix window keeps its own value on purpose: sharing a duration with the
 * delivery window is a consequence of the 4 s watch cadence, not a coupling, and
 * the tests below prove the two windows are consulted independently.
 */
describe('freshness concepts stay separate', () => {
  it('sources the delivery windows from the shared GPS constants', () => {
    assert.equal(SERVER_ACK_LIVE_WINDOW_MS, GPS_LIVE_WINDOW_MS);
    assert.equal(SERVER_ACK_STALE_WINDOW_MS, GPS_STALE_WINDOW_MS);
  });

  it('stays distinct at the source: one import, two literals, no collapsed aliases', () => {
    // A behaviour-only test cannot see this: aliasing
    // `LOCAL_FIX_FRESH_WINDOW_MS` to `GPS_LIVE_WINDOW_MS` would produce the same
    // number and the same verdicts today, and would silently couple "this phone
    // has GPS" to "the observer's map calls it live" forever. The three
    // concepts have to stay separate *in the code* for requirement 6 to mean
    // anything, so the wiring is asserted structurally.
    const source = readFileSync(`${process.cwd()}/src/features/crew/tracking-status.ts`, 'utf8');
    assert.match(
      source,
      /import \{ GPS_LIVE_WINDOW_MS, GPS_STALE_WINDOW_MS \} from '@school-bus-tracking\/shared-types';/,
      'the delivery windows must come from the shared package',
    );
    assert.match(source, /export const SERVER_ACK_LIVE_WINDOW_MS = GPS_LIVE_WINDOW_MS;/);
    assert.match(source, /export const SERVER_ACK_STALE_WINDOW_MS = GPS_STALE_WINDOW_MS;/);
    // The local-fix window keeps its own literal: same duration, own concept.
    assert.match(
      source,
      /export const LOCAL_FIX_FRESH_WINDOW_MS = 30_000;/,
      'the local-fix window must not be aliased to a shared or delivery constant',
    );
  });

  it('keeps the values that were shipped before the constants moved', () => {
    // Pinned deliberately: changing what "live" means is a product decision that
    // must update this test, the docs and both clients together. Nothing about
    // the consolidation was allowed to move a threshold.
    assert.equal(LOCAL_FIX_FRESH_WINDOW_MS, 30_000);
    assert.equal(SERVER_ACK_LIVE_WINDOW_MS, 30_000);
    assert.equal(SERVER_ACK_STALE_WINDOW_MS, 120_000);
  });

  it('decides the local-fix verdict on the local-fix window alone', () => {
    // A 5 s-old local fix and no acknowledgement anywhere: the phone has GPS,
    // the school has nothing. Widening *only* the local window keeps that
    // reading; narrowing it below the fix age moves to `waiting-for-fix`. In
    // neither case does the delivery verdict move — it is still not live.
    const widened = deriveCrewTrackingStatus(
      input({ lastLocalFixAt: iso(5_000), localFreshWindowMs: 10 * 60_000 }),
    );
    assert.equal(widened.status, 'local-only');
    assert.equal(widened.schoolSeesLive, false);

    const narrowed = deriveCrewTrackingStatus(
      input({ lastLocalFixAt: iso(5_000), localFreshWindowMs: 1 }),
    );
    assert.equal(narrowed.status, 'waiting-for-fix');
    assert.equal(narrowed.schoolSeesLive, false);
  });

  it('decides the delivery verdict on the delivery window alone', () => {
    // The identical 5 s-old fix now *has* been acknowledged, and the delivery
    // window is what decides: 30 s → live; 1 ms → not live, and specifically
    // not `local-only` either, because a stale acknowledgement is a delivery
    // fact that the local-fix window is never allowed to overwrite.
    const live = deriveCrewTrackingStatus(
      input({ lastLocalFixAt: iso(5_000), lastServerAckAt: iso(5_000) }),
    );
    assert.equal(live.status, 'live');
    assert.equal(live.schoolSeesLive, true);

    const notLive = deriveCrewTrackingStatus(
      input({ lastLocalFixAt: iso(5_000), lastServerAckAt: iso(5_000), liveWindowMs: 1 }),
    );
    assert.equal(notLive.status, 'stale', 'the ack window, not the fix window, decides');
    assert.equal(notLive.schoolSeesLive, false);
  });

  it('never lets the observer window stand in for a local fix', () => {
    // 60 s of silence on both clocks: past the local window (so not
    // `local-only`) and past the live window (so not `live`) — while still
    // inside the *stale* window, which is an observation deadline, not a claim
    // that the school can see the bus.
    const result = deriveCrewTrackingStatus(input({ lastServerAckAt: iso(60_000) }));
    assert.equal(result.status, 'stale');
    assert.equal(result.schoolSeesLive, false);
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
