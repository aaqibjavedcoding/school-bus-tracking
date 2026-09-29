import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TripStatus } from '@school-bus-tracking/shared-types';
import type {
  TripEtaResponse,
  TripStopArrivalResponse,
  TripStopSkippedEvent,
} from '@school-bus-tracking/shared-types';
import {
  deriveStopServiceStates,
  skippedStopNoteForCard,
  SKIPPED_NOTE_NEXT_STOP_WINDOW,
} from './stop-service-state.ts';

/**
 * The R2 stops-list honesty derivation, table-driven. Every row here guards
 * a way the list could lie: a passed stop rendered as "waiting for GPS", a
 * crew's deliberate skip rendered as the run's accidental one (or vice
 * versa), or a served stop demoted to skipped.
 */

const TRIP_ID = '55555555-5555-4555-8555-555555550001';

function etaWithStops(
  arrivedStopIds: readonly string[],
  frontierSequence: number | null,
): TripEtaResponse {
  const items = [
    { stop_id: 'stop-1', stop_name: 'Home', sequence_number: 1, distance_meters: 0, eta_minutes: null, arrived: arrivedStopIds.includes('stop-1') },
    { stop_id: 'stop-2', stop_name: 'Oak Ave', sequence_number: 2, distance_meters: 10, eta_minutes: 1, arrived: arrivedStopIds.includes('stop-2') },
    { stop_id: 'stop-3', stop_name: 'Maple St', sequence_number: 3, distance_meters: 900, eta_minutes: 3, arrived: arrivedStopIds.includes('stop-3') },
    { stop_id: 'stop-4', stop_name: 'Cedar Ln', sequence_number: 4, distance_meters: 1600, eta_minutes: 5, arrived: arrivedStopIds.includes('stop-4') },
  ];
  return {
    trip_id: TRIP_ID,
    school_id: '11111111-1111-4111-8111-111111110001',
    trip_status: TripStatus.IN_PROGRESS,
    tracking_state: 'active',
    latest: null,
    speed_kmh: 20,
    speed_source: 'gps',
    current_stop:
      frontierSequence === null
        ? null
        : {
            stop_id: `stop-${frontierSequence}`,
            stop_name: items[frontierSequence - 1].stop_name,
            sequence_number: frontierSequence,
            distance_meters: 0,
            eta_minutes: null,
            arrived: true,
          },
    next_stop:
      frontierSequence === null || frontierSequence >= 4
        ? null
        : {
            stop_id: `stop-${frontierSequence + 1}`,
            stop_name: items[frontierSequence].stop_name,
            sequence_number: frontierSequence + 1,
            distance_meters: items[frontierSequence].distance_meters,
            eta_minutes: items[frontierSequence].eta_minutes,
            arrived: false,
          },
    items,
    warnings: [],
  } as unknown as TripEtaResponse;
}

function arrivalRow(stopId: string, skipReason: string | null = null): TripStopArrivalResponse {
  return {
    id: `row-${stopId}`,
    school_id: '11111111-1111-4111-8111-111111110001',
    trip_id: TRIP_ID,
    stop_id: stopId,
    stop_name: stopId,
    arrived_at: '2026-09-01T06:45:00.000Z',
    latitude: 40.7,
    longitude: -74,
    distance_meters: 12,
    source: skipReason !== null ? 'crew' : 'geofence',
    skip_reason: skipReason,
    recorded_by: null,
    created_at: '2026-09-01T06:45:00.000Z',
  };
}

describe('deriveStopServiceStates', () => {
  it('marks a stop the frontier passed without a row as skipped — the R2 case', () => {
    // Stop 1 served; stop 2 passed silently; stop 3 reached (frontier 3).
    const states = deriveStopServiceStates(etaWithStops(['stop-1', 'stop-3'], 3), [arrivalRow('stop-1'), arrivalRow('stop-3')]);
    assert.equal(states.get('stop-1'), 'served');
    assert.equal(states.get('stop-2'), 'skipped');
    assert.equal(states.get('stop-3'), 'served');
    assert.equal(states.get('stop-4'), 'upcoming');
  });

  it('distinguishes the crew\'s deliberate skip from the run\'s accidental one', () => {
    // Stop 2 crew-skipped (a row with a reason); stop 3 still ahead.
    const states = deriveStopServiceStates(etaWithStops(['stop-1', 'stop-2'], 2), [
      arrivalRow('stop-1'),
      arrivalRow('stop-2', 'road closed'),
    ]);
    assert.equal(states.get('stop-2'), 'crew-skipped');
    assert.equal(states.get('stop-3'), 'upcoming');
    // Nothing is "skipped" — the crew owned stop 2, the run passed nobody.
    assert.equal([...states.values()].includes('skipped'), false);
  });

  it('nothing is skipped before the first arrival', () => {
    const states = deriveStopServiceStates(etaWithStops([], null), []);
    for (const stopId of ['stop-1', 'stop-2', 'stop-3', 'stop-4']) {
      assert.equal(states.get(stopId), 'upcoming');
    }
  });

  it('works from the live ETA alone — rows refine, they are not required', () => {
    // The eta summary alone says arrived/not-arrived; the frontier marks the
    // gap. This is the path of a screen before the arrivals fetch settles,
    // and it must already be honest about the pass.
    const states = deriveStopServiceStates(etaWithStops(['stop-1', 'stop-3'], 3), undefined);
    assert.equal(states.get('stop-2'), 'skipped');
    assert.equal(states.get('stop-1'), 'served');
  });

  it('an unknown eta yields an empty map, not a crash', () => {
    assert.equal(deriveStopServiceStates(null).size, 0);
    assert.equal(deriveStopServiceStates(null, [arrivalRow('stop-1')]).size, 0);
  });
});

describe('skippedStopNoteForCard', () => {
  const event: TripStopSkippedEvent = {
    trip_id: TRIP_ID,
    school_id: '11111111-1111-4111-8111-111111110001',
    trip_status: TripStatus.IN_PROGRESS,
    tracking_state: 'active',
    stop_id: 'stop-2',
    stop_name: 'Oak Ave',
    sequence_number: 2,
    skipped_at: '2026-09-01T06:52:30.000Z',
    source: 'geofence',
  };

  it('shows the note for the legs right after the skip', () => {
    assert.deepEqual(skippedStopNoteForCard(event, 3), {
      sequenceNumber: 2,
      stopName: 'Oak Ave',
    });
    assert.deepEqual(skippedStopNoteForCard(event, 4), {
      sequenceNumber: 2,
      stopName: 'Oak Ave',
    });
  });

  it(`retires the note once the run is more than ${SKIPPED_NOTE_NEXT_STOP_WINDOW} stops past`, () => {
    assert.equal(skippedStopNoteForCard(event, 5), null);
    assert.equal(skippedStopNoteForCard(event, 6), null);
  });

  it('no event, no next stop, or a corrupt number means no note', () => {
    assert.equal(skippedStopNoteForCard(null, 3), null);
    assert.equal(skippedStopNoteForCard(event, null), null);
    assert.equal(
      skippedStopNoteForCard({ ...event, sequence_number: 0 }, 3),
      null,
    );
  });
});
