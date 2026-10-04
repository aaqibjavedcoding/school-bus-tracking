import type { StopResponse } from '@school-bus-tracking/shared-types';

export type RouteCoordinate = [number, number];
export type RouteLine = { type: 'LineString'; coordinates: RouteCoordinate[] };
export type ChosenRouteLine = { kind: 'road' | 'planned'; line: RouteLine };

interface RoadGeometryLike {
  type?: unknown;
  coordinates?: unknown;
}

function validCoordinate(value: unknown): value is RouteCoordinate {
  if (!Array.isArray(value) || value.length < 2) return false;
  const [longitude, latitude] = value;
  return (
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90
  );
}

/** Selects the truthful route line without depending on React or MapLibre. */
export function chooseRouteLine({
  roadGeometry,
  stops,
}: {
  roadGeometry?: RoadGeometryLike | null;
  stops: readonly StopResponse[];
}): ChosenRouteLine | null {
  if (roadGeometry?.type === 'LineString' && Array.isArray(roadGeometry.coordinates)) {
    const coordinates = roadGeometry.coordinates.filter(validCoordinate).map(([lng, lat]) => [lng, lat] as RouteCoordinate);
    if (coordinates.length >= 2) return { kind: 'road', line: { type: 'LineString', coordinates } };
  }

  const coordinates = stops
    .filter(
      (stop): stop is StopResponse & { latitude: number; longitude: number } =>
        validCoordinate([stop.longitude, stop.latitude]),
    )
    .slice()
    .sort((a, b) => a.sequence_number - b.sequence_number)
    .map((stop) => [stop.longitude, stop.latitude] as RouteCoordinate);

  return coordinates.length >= 2
    ? { kind: 'planned', line: { type: 'LineString', coordinates } }
    : null;
}
