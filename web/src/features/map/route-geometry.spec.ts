import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { chooseRouteLine } from './route-geometry.ts';

const stop = (sequence_number: number, longitude: number | null, latitude: number | null) =>
  ({ sequence_number, longitude, latitude }) as StopResponse;

describe('chooseRouteLine', () => {
  it('prefers a valid road LineString and drops invalid coordinates', () => {
    assert.deepEqual(
      chooseRouteLine({
        roadGeometry: {
          type: 'LineString',
          coordinates: [[72, 19], [Number.NaN, 20], [181, 20], [73, 20]],
        },
        stops: [stop(1, 1, 1), stop(2, 2, 2)],
      }),
      { kind: 'road', line: { type: 'LineString', coordinates: [[72, 19], [73, 20]] } },
    );
  });

  it('falls back to valid stops in sequence order', () => {
    assert.deepEqual(
      chooseRouteLine({
        roadGeometry: { type: 'LineString', coordinates: [[200, 19], [73, Number.NaN]] },
        stops: [stop(3, 73, 20), stop(1, 72, 19), stop(2, -181, 10)],
      }),
      { kind: 'planned', line: { type: 'LineString', coordinates: [[72, 19], [73, 20]] } },
    );
  });

  it('ignores non-LineString road geometry', () => {
    assert.equal(chooseRouteLine({ roadGeometry: { type: 'Point', coordinates: [72, 19] }, stops: [] }), null);
  });

  it('returns null unless at least two valid points can be drawn', () => {
    assert.equal(chooseRouteLine({ roadGeometry: null, stops: [stop(1, 72, 91), stop(2, 72, 19)] }), null);
  });
});
