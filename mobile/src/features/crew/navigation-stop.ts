import type { StopResponse } from '@school-bus-tracking/shared-types';
import { isValidCoordinate, type NavigationTarget } from '../../lib/navigation.ts';

/**
 * Which route stop the driver should be heading to (Task 44).
 *
 * Kept free of React Native so it can be unit-tested with the Node runner —
 * and so the "never navigate to a guessed coordinate" rule is enforced in one
 * place: a stop without real coordinates is simply not a navigation target.
 */

/** A stop is only navigable once it carries real, in-range coordinates. */
export function navigationTargetOf(stop: StopResponse): NavigationTarget | null {
  if (stop.latitude === null || stop.longitude === null) {
    return null;
  }
  if (!isValidCoordinate(stop.latitude, stop.longitude)) {
    return null;
  }
  return { name: stop.name, latitude: stop.latitude, longitude: stop.longitude };
}

/**
 * The stop the driver is heading to.
 *
 * The server's own "next stop" wins when it is navigable; otherwise the first
 * geofenced stop of the route is used. `null` means the route has nothing to
 * drive to yet, and the card says so instead of inventing a destination.
 */
export function pickNextStop(
  stops: StopResponse[],
  nextStopId?: string | null,
): StopResponse | null {
  if (stops.length === 0) {
    return null;
  }
  const chosen = nextStopId ? stops.find((stop) => stop.id === nextStopId) : undefined;
  if (chosen && navigationTargetOf(chosen)) {
    return chosen;
  }
  return stops.find((stop) => navigationTargetOf(stop) !== null) ?? null;
}
