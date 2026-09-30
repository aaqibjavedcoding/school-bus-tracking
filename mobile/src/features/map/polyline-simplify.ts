import type { Feature, LineString } from 'geojson';

/**
 * Trail decimation — Douglas–Peucker, in **metres**, before the line is
 * written to the map source.
 *
 * A two-hour trip at one fix every 4 s is ~1,800 points, and the trail is
 * re-set on the source on every fix (the web crew console) or re-read on every
 * fullscreen open (the driver map). GPS noise means most of those points carry
 * no shape information at all: they wiggle inside the receiver's accuracy
 * radius. Decimating the line before it reaches the source cuts the payload —
 * and the per-fix re-set cost — to the points that actually describe the path.
 *
 * ### Why metres, not degrees
 *
 * Douglas–Peucker measures perpendicular distance, and a "degree" is not a
 * fixed distance: one degree of longitude shrinks with the cosine of the
 * latitude, so a degree-tolerance that is honest in Edinburgh is eight times
 * looser in Singapore. The tolerance here is a distance a human can reason
 * about ("keep deviations larger than 5 m") and the coordinates are projected
 * to local metres (equirectangular around the line's own first point —
 * accurate to well under a metre at bus-route scales) before the algorithm
 * runs, so the result is latitude-independent.
 *
 * ### What this must never do
 *
 * - never move a point (the output is a subset of the input, in order);
 * - never drop either endpoint (the trail must still start where the trip
 *   started and end at the newest fix);
 * - never invent points or smooth a corner — a hairpin keeps its apex because
 *   the apex is far from the chord, which is exactly what the algorithm
 *   measures.
 */

/**
 * The trail tolerance. 5 m: comfortably inside the receiver accuracy the trail
 * is drawn through (the accuracy circle is 20–100 m), so nothing a driver
 * could resolve on the map is removed, and far above the ~1–2 m of jitter a
 * stationary bus produces — which is the noise being dropped.
 */
export const TRAIL_SIMPLIFY_TOLERANCE_METERS = 5;

/** Metres per degree at a latitude, WGS84 series approximation (<1 m error). */
function metersPerDegree(latitude: number): { latitude: number; longitude: number } {
  const phi = (latitude * Math.PI) / 180;
  return {
    latitude: 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
    longitude: 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi),
  };
}

type LngLat = [number, number];

/**
 * Douglas–Peucker over longitude/latitude pairs with a metre tolerance.
 *
 * Accepts GeoJSON `Position`s (the `number[]` a LineString carries) as well as
 * strict tuples; each entry is read as `[longitude, latitude]`.
 *
 * Returns a new array of `[longitude, latitude]` tuples that is a subset of
 * the input (same order, both endpoints kept). A non-finite coordinate is
 * always kept — it has already been validated upstream (`buildTrailLine`
 * filters), and "keep" is the conservative answer for anything unexpected.
 */
export function simplifyPolylineMeters(
  coordinates: ReadonlyArray<readonly number[]>,
  toleranceMeters: number,
): LngLat[] {
  if (coordinates.length <= 2 || !Number.isFinite(toleranceMeters) || toleranceMeters <= 0) {
    return coordinates.map((point) => [point[0], point[1]]);
  }

  // Local equirectangular projection around the first point: the whole route
  // spans a few kilometres, where a flat-earth approximation of the ellipsoid
  // is accurate to centimetres.
  const scale = metersPerDegree(coordinates[0][1]);
  const toXY = (point: readonly number[]): [number, number] => [
    (point[0] - coordinates[0][0]) * scale.longitude,
    (point[1] - coordinates[0][1]) * scale.latitude,
  ];
  const projected = coordinates.map(toXY);

  // Perpendicular distance from `point` to the segment `a`→`b` (the classic
  // cross-product formulation; degenerate segments fall back to the
  // point-to-point distance).
  const perpendicular = (
    point: [number, number],
    a: [number, number],
    b: [number, number],
  ): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx === 0 && dy === 0) {
      return Math.hypot(point[0] - a[0], point[1] - a[1]);
    }
    return Math.abs(dy * (point[0] - a[0]) - dx * (point[1] - a[1])) / Math.hypot(dx, dy);
  };

  const keep = new Array<boolean>(coordinates.length).fill(false);
  keep[0] = true;
  keep[coordinates.length - 1] = true;

  // Explicit stack: a pathological 2-hour trail is ~1,800 points and the
  // worst case of the recursive form is O(n) deep.
  const stack: Array<[number, number]> = [[0, coordinates.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    if (end - start < 2) continue;
    let farthest = -1;
    let farthestDistance = -1;
    for (let index = start + 1; index < end; index += 1) {
      if (!Number.isFinite(coordinates[index][0]) || !Number.isFinite(coordinates[index][1])) {
        farthest = index;
        farthestDistance = Number.POSITIVE_INFINITY;
        break;
      }
      const distance = perpendicular(projected[index], projected[start], projected[end]);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = index;
      }
    }
    if (farthest > 0 && farthestDistance > toleranceMeters) {
      keep[farthest] = true;
      stack.push([start, farthest], [farthest, end]);
    }
  }

  return coordinates.filter((_, index) => keep[index]) as LngLat[];
}

/**
 * Decimates a trail LineString feature in place-free style: returns a **new**
 * feature with the same properties and a subset of the coordinates. The input
 * is never mutated, so the memoised server payload stays the authority.
 */
export function decimateTrailLine(
  feature: Feature<LineString>,
  toleranceMeters: number = TRAIL_SIMPLIFY_TOLERANCE_METERS,
): Feature<LineString> {
  return {
    ...feature,
    geometry: {
      type: 'LineString',
      coordinates: simplifyPolylineMeters(feature.geometry.coordinates, toleranceMeters),
    },
  };
}
