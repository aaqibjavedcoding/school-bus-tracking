import type { RouteGeometryLeg, RouteGeometryManeuver, StopResponse } from '@school-bus-tracking/shared-types';
import { isValidCoordinate } from '../../lib/navigation.ts';

/** A GPS position is the only client fact used to decide which step is ahead. */
export interface ManeuverPosition {
  latitude: number;
  longitude: number;
}

/** The three display facts for one engine maneuver. */
export interface ManeuverDisplay {
  instruction: string;
  roadName: string | null;
  distanceMeters: number;
}

/** The strip's current step and the following step, when one exists. */
export interface CurrentManeuver extends ManeuverDisplay {
  preview: ManeuverDisplay | null;
}

/** The small translation seam keeps the selection logic pure and testable. */
export type ManeuverInstructionBuilder = (
  type: string,
  modifier: string | null,
  roadName: string | null,
) => string;

export interface CurrentManeuverInput {
  legs: readonly RouteGeometryLeg[] | null | undefined;
  position: ManeuverPosition | null | undefined;
  nextStopId: string | null | undefined;
  stops: readonly Pick<StopResponse, 'id' | 'sequence_number' | 'latitude' | 'longitude'>[];
  /** Optional locale-aware formatter. Tests and pure callers get English. */
  instructionBuilder?: ManeuverInstructionBuilder;
}

/**
 * The small, engine-vocabulary lookup used by the default formatter. The
 * engine's type is deliberately a string because providers can add a type;
 * unknown types degrade to a readable "Continue" rather than a guess.
 */
const TYPE_PREFIX: Readonly<Record<string, string>> = {
  depart: 'Head',
  turn: 'Turn',
  continue: 'Continue',
  merge: 'Merge',
  fork: 'Keep',
  'end of road': 'At the end of the road, turn',
  'on ramp': 'Take the ramp',
  'off ramp': 'Take the exit',
  roundabout: 'At the roundabout, take the',
  arrive: 'Arrive',
  notification: 'Continue',
};

const MODIFIER_FALLBACK = 'ahead';

/** Builds the English fallback used by the pure module and its specs. */
export function defaultManeuverInstruction(
  type: string,
  modifier: string | null,
  roadName: string | null,
): string {
  const normalizedType = type.trim().toLowerCase();
  const prefix = TYPE_PREFIX[normalizedType] ?? 'Continue';
  const direction = modifier?.trim() || null;
  const road = roadName?.trim() || null;

  if (normalizedType === 'arrive') return road ? `${prefix} at ${road}` : prefix;
  if (normalizedType === 'depart') {
    return road ? `${prefix} onto ${road}` : prefix;
  }
  if (normalizedType === 'roundabout') {
    const exit = direction ?? MODIFIER_FALLBACK;
    return road ? `${prefix} ${exit} exit onto ${road}` : `${prefix} ${exit} exit`;
  }
  if (normalizedType === 'end of road') {
    const turn = direction ?? MODIFIER_FALLBACK;
    return road ? `${prefix} ${turn} onto ${road}` : `${prefix} ${turn}`;
  }

  const suffix = direction ? ` ${direction}` : '';
  return road ? `${prefix}${suffix} onto ${road}` : `${prefix}${suffix}`;
}

/** A maneuver with coordinates and an engine distance that can be displayed. */
interface UsableManeuver {
  source: RouteGeometryManeuver;
  roadName: string | null;
  progress: number;
}

function usablePosition(position: ManeuverPosition | null | undefined): boolean {
  return Boolean(
    position && isValidCoordinate(position.latitude, position.longitude),
  );
}

function usableManeuver(maneuver: RouteGeometryManeuver): boolean {
  return (
    typeof maneuver.type === 'string' &&
    maneuver.type.trim().length > 0 &&
    typeof maneuver.distance_meters === 'number' &&
    Number.isFinite(maneuver.distance_meters) &&
    maneuver.distance_meters >= 0 &&
    Array.isArray(maneuver.location) &&
    maneuver.location.length >= 2 &&
    isValidCoordinate(maneuver.location[1], maneuver.location[0])
  );
}

/**
 * Project a point onto the straight start/end axis only to decide ordering.
 * It is intentionally never used as a distance readout: the driver's number
 * always comes from `maneuver.distance_meters` supplied by the engine.
 */
function routeProgress(
  point: ManeuverPosition,
  start: ManeuverPosition,
  end: ManeuverPosition,
): number | null {
  const latitudeScale = Math.cos((start.latitude + end.latitude) * (Math.PI / 360));
  const startX = start.longitude * latitudeScale;
  const startY = start.latitude;
  const endX = end.longitude * latitudeScale;
  const endY = end.latitude;
  const pointX = point.longitude * latitudeScale;
  const pointY = point.latitude;
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  if (!Number.isFinite(lengthSquared) || lengthSquared <= Number.EPSILON) return null;
  return ((pointX - startX) * dx + (pointY - startY) * dy) / lengthSquared;
}

function legManeuvers(
  leg: RouteGeometryLeg,
  position: ManeuverPosition,
  start: ManeuverPosition,
  end: ManeuverPosition,
): UsableManeuver[] {
  const values: UsableManeuver[] = [];
  for (const source of leg.maneuvers ?? []) {
    if (!usableManeuver(source)) continue;
    const progress = routeProgress(
      { latitude: source.location[1], longitude: source.location[0] },
      start,
      end,
    );
    if (progress === null) continue;
    values.push({ source, roadName: source.road_name.trim() || null, progress });
  }
  return values;
}

function displayOf(
  maneuver: UsableManeuver,
  builder: ManeuverInstructionBuilder,
): ManeuverDisplay {
  return {
    instruction: builder(maneuver.source.type, maneuver.source.modifier, maneuver.roadName),
    roadName: maneuver.roadName,
    // This is the engine's step/leg distance. Never replace it with a GPS
    // distance to the maneuver location.
    distanceMeters: maneuver.source.distance_meters,
  };
}

/**
 * Selects the nearest upcoming engine maneuver on the leg ending at the
 * server-authoritative next stop.
 *
 * A route without legs, a next stop without a preceding leg, stale/malformed
 * geometry, or a missing position returns `null`. In particular, this helper
 * never falls back to a straight-line distance or to a maneuver from another
 * leg — that is what makes a failed/stale geometry load render no strip.
 */
export function currentManeuver(input: CurrentManeuverInput): CurrentManeuver | null {
  const { legs, position, nextStopId, stops } = input;
  if (!legs || legs.length === 0 || !nextStopId || !usablePosition(position)) return null;

  const orderedStops = [...stops]
    .filter((stop) => Number.isFinite(stop.sequence_number))
    .sort((a, b) => a.sequence_number - b.sequence_number);
  const stopIndex = orderedStops.findIndex((stop) => stop.id === nextStopId);
  if (stopIndex <= 0 || stopIndex - 1 >= legs.length) return null;

  const startStop = orderedStops[stopIndex - 1];
  const endStop = orderedStops[stopIndex];
  if (
    !isValidCoordinate(startStop.latitude ?? Number.NaN, startStop.longitude ?? Number.NaN) ||
    !isValidCoordinate(endStop.latitude ?? Number.NaN, endStop.longitude ?? Number.NaN)
  ) {
    return null;
  }

  const start: ManeuverPosition = {
    latitude: startStop.latitude as number,
    longitude: startStop.longitude as number,
  };
  const end: ManeuverPosition = {
    latitude: endStop.latitude as number,
    longitude: endStop.longitude as number,
  };
  const candidates = legManeuvers(legs[stopIndex - 1], position as ManeuverPosition, start, end);
  if (candidates.length === 0) return null;

  const positionProgress = routeProgress(position as ManeuverPosition, start, end);
  if (positionProgress === null) return null;
  const upcoming = candidates.filter((candidate) => candidate.progress + 0.01 >= positionProgress);
  if (upcoming.length === 0) return null;
  upcoming.sort((a, b) => a.progress - b.progress);

  const builder = input.instructionBuilder ?? defaultManeuverInstruction;
  return {
    ...displayOf(upcoming[0], builder),
    preview: upcoming[1] ? displayOf(upcoming[1], builder) : null,
  };
}
