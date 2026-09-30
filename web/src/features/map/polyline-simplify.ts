/**
 * Trail decimation — Douglas–Peucker, in **metres**, before the line is
 * written to the map source (web port of the mobile `polyline-simplify.ts`;
 * the two packages carry their own copies of the pure map policy modules, as
 * they already do for `bus-motion` and `follow-camera`).
 *
 * This is the hot path on the web crew console: the trail is re-set on the
 * `sbt-trail` GeoJSON source on every GPS fix, and a two-hour trip at one fix
 * every 4 s is ~1,800 points — most of it GPS jitter that carries no shape
 * information. Decimating to ~5 m cuts the re-set payload (and the source
 * re-tessellation that follows it) to the points that actually describe the
 * path.
 *
 * - the tolerance is in METRES, not degrees (a degree of longitude shrinks
 *   with the cosine of the latitude — a degree tolerance that is honest in
 *   Edinburgh is twice as loose in Singapore), so coordinates are projected
 *   to local metres around the line's own first point before the algorithm
 *   runs;
 * - the output is a subset of the input, in order — never moved, never
 *   smoothed, never invented — and both endpoints always survive.
 */

/**
 * The trail tolerance. 5 m: comfortably inside the receiver accuracy the trail
 * is drawn through, and far above the ~1–2 m of jitter a stationary bus
 * produces — which is the noise being dropped.
 */
export const TRAIL_SIMPLIFY_TOLERANCE_METERS = 5;

type LngLat = [number, number];

/** Metres per degree at a latitude, WGS84 series approximation (<1 m error). */
function metersPerDegree(latitude: number): { latitude: number; longitude: number } {
  const phi = (latitude * Math.PI) / 180;
  return {
    latitude: 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
    longitude: 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi),
  };
}

/**
 * Douglas–Peucker over longitude/latitude pairs with a metre tolerance.
 * Returns a new array of `[longitude, latitude]` tuples that is a subset of
 * the input (same order, both endpoints kept).
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

  // Explicit stack: the recursive form's worst case is O(n) deep.
  const stack: Array<[number, number]> = [[0, coordinates.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    if (end - start < 2) continue;
    let farthest = -1;
    let farthestDistance = -1;
    for (let index = start + 1; index < end; index += 1) {
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
