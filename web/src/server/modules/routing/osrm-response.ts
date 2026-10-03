/**
 * Pure parser: OSRM `/route/v1/driving/...` JSON → our own road-route shape.
 *
 * Two rules govern this module:
 *
 * 1. **Our shape, not OSRM's.** Everything downstream — the cache row, the
 *    API payload, the apps — reads {@link RoadRoute}. If the engine is ever
 *    swapped (Valhalla, GraphHopper, a newer OSRM schema), the blast radius
 *    is this one file.
 *
 * 2. **Return null, never throw.** The response crosses a process boundary;
 *    any structural surprise (engine error code, missing geometry, garbage
 *    JSON already parsed by the caller) means "no route" — the caller turns
 *    that into `{ status: 'unavailable' }` and, critically, never caches it.
 *
 * Strict at the route level (code must be `Ok`, geometry must be a usable
 * LineString, totals must be finite numbers — a cached partial route is
 * worse than no route) and lenient at the step level (an unparseable step is
 * skipped, not fatal: the polyline is what the driver follows, maneuvers are
 * enrichment).
 */

/** GeoJSON LineString in WGS-84 — `[longitude, latitude]` pairs. */
export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

/** One turn-by-turn instruction point along a leg. */
export interface RoadRouteManeuver {
  /** OSRM maneuver type, e.g. `depart`, `turn`, `roundabout`, `arrive`. */
  type: string;
  /** Direction modifier (`left`, `sharp right`, …); null when OSRM omits it. */
  modifier: string | null;
  /** Name of the road the step travels on (`step.name`; may be ''). */
  roadName: string;
  /** Length of the step in metres. */
  distanceMeters: number;
  /** `[longitude, latitude]` where the maneuver happens. */
  location: [number, number];
}

/** One stop-to-stop section of the full route. */
export interface RoadRouteLeg {
  distanceMeters: number;
  durationSeconds: number;
  maneuvers: RoadRouteManeuver[];
}

/** The road-following shape of a route, in our vocabulary. */
export interface RoadRoute {
  geometry: GeoJsonLineString;
  distanceMeters: number;
  durationSeconds: number;
  legs: RoadRouteLeg[];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Validates one GeoJSON position: exactly `[longitude, latitude]` (extra
 * ordinates like altitude are dropped), finite and within WGS-84 ranges.
 */
function parsePosition(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }
  const longitude = finiteNumber(value[0]);
  const latitude = finiteNumber(value[1]);
  if (longitude === null || latitude === null) {
    return null;
  }
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return null;
  }
  return [longitude, latitude];
}

/** Route-level geometry is strict: a LineString with at least two positions. */
function parseGeometry(value: unknown): GeoJsonLineString | null {
  if (!isRecord(value) || value['type'] !== 'LineString' || !Array.isArray(value['coordinates'])) {
    return null;
  }
  const coordinates: [number, number][] = [];
  for (const raw of value['coordinates'] as unknown[]) {
    const position = parsePosition(raw);
    if (position === null) {
      return null;
    }
    coordinates.push(position);
  }
  // A one-point "LineString" renders nothing a driver could follow.
  if (coordinates.length < 2) {
    return null;
  }
  return { type: 'LineString', coordinates };
}

/** Step-level parsing is lenient: returns null for one bad step, which the caller skips. */
function parseStep(value: unknown): RoadRouteManeuver | null {
  if (!isRecord(value) || !isRecord(value['maneuver'])) {
    return null;
  }
  const maneuver = value['maneuver'];
  if (typeof maneuver['type'] !== 'string' || maneuver['type'] === '') {
    return null;
  }
  const location = parsePosition(maneuver['location']);
  if (location === null) {
    return null;
  }
  return {
    type: maneuver['type'],
    modifier: typeof maneuver['modifier'] === 'string' ? maneuver['modifier'] : null,
    roadName: typeof value['name'] === 'string' ? value['name'] : '',
    distanceMeters: finiteNumber(value['distance']) ?? 0,
    location,
  };
}

function parseLeg(value: unknown): RoadRouteLeg | null {
  if (!isRecord(value)) {
    return null;
  }
  const distanceMeters = finiteNumber(value['distance']);
  const durationSeconds = finiteNumber(value['duration']);
  if (distanceMeters === null || durationSeconds === null) {
    return null;
  }
  const steps = Array.isArray(value['steps']) ? (value['steps'] as unknown[]) : [];
  const maneuvers: RoadRouteManeuver[] = [];
  for (const step of steps) {
    const parsed = parseStep(step);
    if (parsed !== null) {
      maneuvers.push(parsed);
    }
  }
  return { distanceMeters, durationSeconds, maneuvers };
}

/**
 * Parses one OSRM route-service response body into our road-route shape.
 *
 * @returns the first route of the response, or `null` when the response is
 *          not a successful, fully-formed route. Never throws.
 */
export function parseOsrmRouteResponse(json: unknown): RoadRoute | null {
  try {
    if (!isRecord(json) || json['code'] !== 'Ok' || !Array.isArray(json['routes'])) {
      return null;
    }
    const [first] = json['routes'] as unknown[];
    if (!isRecord(first)) {
      return null;
    }
    const geometry = parseGeometry(first['geometry']);
    const distanceMeters = finiteNumber(first['distance']);
    const durationSeconds = finiteNumber(first['duration']);
    if (geometry === null || distanceMeters === null || durationSeconds === null) {
      return null;
    }
    const rawLegs = Array.isArray(first['legs']) ? (first['legs'] as unknown[]) : [];
    const legs: RoadRouteLeg[] = [];
    for (const rawLeg of rawLegs) {
      const leg = parseLeg(rawLeg);
      if (leg !== null) {
        legs.push(leg);
      }
    }
    return { geometry, distanceMeters, durationSeconds, legs };
  } catch {
    // Paranoia only: every access above is guarded, but "never throws" is a
    // contract, not an intention — a caller cacheing geometry must never be
    // crashed by a hostile or corrupted response body.
    return null;
  }
}
