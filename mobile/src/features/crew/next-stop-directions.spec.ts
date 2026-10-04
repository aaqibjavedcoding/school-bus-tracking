import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RouteGeometryLeg, StopResponse } from '@school-bus-tracking/shared-types';
import { currentManeuver, defaultManeuverInstruction } from './next-stop-directions.ts';

const stop = (
  id: string,
  sequence_number: number,
  latitude: number,
  longitude: number,
): Pick<StopResponse, 'id' | 'sequence_number' | 'latitude' | 'longitude'> => ({
  id,
  sequence_number,
  latitude,
  longitude,
});

const leg = (...maneuvers: RouteGeometryLeg['maneuvers'][number][]): RouteGeometryLeg => ({
  distance_meters: maneuvers.reduce((total, maneuver) => total + maneuver.distance_meters, 0),
  duration_seconds: 120,
  maneuvers,
});

const turn = (
  type: string,
  modifier: string | null,
  longitude: number,
  distance_meters: number,
  road_name = 'Wardha Road',
) => ({
  type,
  modifier,
  road_name,
  distance_meters,
  location: [longitude, 19] as [number, number],
});

describe('currentManeuver', () => {
  const stops = [stop('start', 1, 19, 72), stop('next', 2, 19, 73)];

  test('selects the nearest upcoming maneuver and keeps the engine distance', () => {
    const result = currentManeuver({
      legs: [
        leg(
          turn('turn', 'left', 72.2, 120, 'Station Road'),
          turn('turn', 'right', 72.6, 85),
          turn('arrive', null, 72.95, 40, 'School Road'),
        ),
      ],
      position: { latitude: 19, longitude: 72.4 },
      nextStopId: 'next',
      stops,
    });

    assert.deepEqual(result, {
      instruction: 'Turn right onto Wardha Road',
      roadName: 'Wardha Road',
      distanceMeters: 85,
      preview: {
        instruction: 'Arrive at School Road',
        roadName: 'School Road',
        distanceMeters: 40,
      },
    });
  });

  test('does not use the previous leg or straight-line distance', () => {
    const routeStops = [
      ...stops,
      stop('last', 3, 19, 74),
    ];
    const result = currentManeuver({
      legs: [
        leg(turn('turn', 'left', 72.2, 999, 'Old Road')),
        leg(turn('turn', 'right', 73.6, 85)),
      ],
      position: { latitude: 19, longitude: 73.4 },
      nextStopId: 'last',
      stops: routeStops,
    });

    assert.equal(result?.instruction, 'Turn right onto Wardha Road');
    assert.equal(result?.distanceMeters, 85);
  });

  test('returns null when there is no usable position, next stop, or geometry', () => {
    const args = {
      legs: [leg(turn('turn', 'right', 72.6, 85))],
      stops,
    } as const;
    assert.equal(currentManeuver({ ...args, position: null, nextStopId: 'next' }), null);
    assert.equal(currentManeuver({ ...args, position: { latitude: 19, longitude: 72.4 }, nextStopId: null }), null);
    assert.equal(
      currentManeuver({
        ...args,
        legs: [],
        position: { latitude: 19, longitude: 72.4 },
        nextStopId: 'next',
      }),
      null,
    );
    assert.equal(
      currentManeuver({
        ...args,
        position: { latitude: Number.NaN, longitude: 72.4 },
        nextStopId: 'next',
      }),
      null,
    );
  });

  test('ignores malformed maneuvers and returns the following maneuver as preview', () => {
    const result = currentManeuver({
      legs: [
        leg(
          turn('turn', 'right', 72.2, Number.NaN),
          turn('turn', 'right', 72.4, 65),
          turn('turn', 'left', 72.7, 55, ''),
        ),
      ],
      position: { latitude: 19, longitude: 72.1 },
      nextStopId: 'next',
      stops,
    });

    assert.equal(result?.distanceMeters, 65);
    assert.equal(result?.preview?.roadName, null);
    assert.equal(result?.preview?.instruction, 'Turn left');
  });
});

test('default maneuver copy uses the requested turn wording', () => {
  assert.equal(defaultManeuverInstruction('turn', 'right', 'Wardha Road'), 'Turn right onto Wardha Road');
});
