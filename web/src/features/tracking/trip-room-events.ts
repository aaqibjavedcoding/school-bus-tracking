import {
  LIVE_TRACKING_EVENTS,
  type TripEtaUpdateEvent,
  type TripLocationUpdateEvent,
  type TripStopArrivedEvent,
  type TripStudentAttendanceEvent,
  type TripTrackingStartedEvent,
  type TripTrackingStoppedEvent,
} from '@school-bus-tracking/shared-types';

/**
 * The server → room half of one trip-room subscription, as a pure module.
 *
 * Both live-tracking hooks (web and its mobile port) subscribe to the same
 * six server-pushed events on one process-wide socket, and every handler
 * begins with the same guard — "is this frame about *my* trip?". That wiring
 * used to live inline in the hooks where no Node test could reach it; this
 * module is the seam that makes it provable:
 *
 * - every event of the set is registered and, crucially, **removed** again
 *   (a missed `off` is how one screen starts receiving another's frames
 *   after a remount);
 * - a frame carrying a different `trip_id` never reaches a handler — the
 *   socket is shared across screens, so without the guard a parent watching
 *   one run would see the crew activity of another;
 * - the payload types stay the shared contract from
 *   `packages/shared-types`, so client and server cannot drift.
 *
 * Free of React and of the socket factory: the structural `TripRoomSocket`
 * is satisfied by the real `socket.io-client` `Socket`, which is what lets
 * `trip-room-events.spec.ts` drive it with a plain fake under `node --test`.
 */

/** The six frames the server pushes into an authorization-gated trip room. */
export interface TripRoomEventHandlers {
  onLocation(payload: TripLocationUpdateEvent): void;
  onTrackingStarted(payload: TripTrackingStartedEvent): void;
  onTrackingStopped(payload: TripTrackingStoppedEvent): void;
  onEtaUpdate(payload: TripEtaUpdateEvent): void;
  onStopArrived(payload: TripStopArrivedEvent): void;
  /** A board/drop on (usually) the other crew device — refresh the manifest. */
  onStudentAttendance(payload: TripStudentAttendanceEvent): void;
}

/** The slice of `socket.io-client`'s `Socket` this module uses. */
export interface TripRoomSocket {
  on(event: string, handler: (payload: unknown) => void): unknown;
  off(event: string, handler: (payload: unknown) => void): unknown;
}

/** Runtime check of the one field every frame of the set carries. */
function isTripScopedPayload(payload: unknown): payload is { trip_id: string } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { trip_id?: unknown }).trip_id === 'string'
  );
}

/**
 * Subscribes all trip-room events for one trip; returns the detacher.
 *
 * Each handler is wrapped with the same-trip guard, so the callbacks handed
 * in can assume the frame belongs to `tripId`. The detach function removes
 * exactly the listeners this call registered — never another subscription's.
 */
export function attachTripRoomEvents(
  socket: TripRoomSocket,
  tripId: string,
  handlers: TripRoomEventHandlers,
): () => void {
  // The guard is the one cast boundary: a raw socket frame is checked for
  // the trip id, and only a frame shaped like this trip's reaches the typed
  // handler (the server owns the rest of the shape, as everywhere else).
  const guard =
    <T extends { trip_id: string }>(handler: (payload: T) => void) =>
    (payload: unknown): void => {
      if (!isTripScopedPayload(payload) || payload.trip_id !== tripId) {
        return;
      }
      handler(payload as T);
    };

  const bindings: Array<[string, (payload: unknown) => void]> = [
    [LIVE_TRACKING_EVENTS.locationUpdate, guard(handlers.onLocation)],
    [LIVE_TRACKING_EVENTS.trackingStarted, guard(handlers.onTrackingStarted)],
    [LIVE_TRACKING_EVENTS.trackingStopped, guard(handlers.onTrackingStopped)],
    [LIVE_TRACKING_EVENTS.etaUpdate, guard(handlers.onEtaUpdate)],
    [LIVE_TRACKING_EVENTS.stopArrived, guard(handlers.onStopArrived)],
    [LIVE_TRACKING_EVENTS.studentAttendance, guard(handlers.onStudentAttendance)],
  ];

  for (const [event, handler] of bindings) {
    socket.on(event, handler);
  }

  let detached = false;
  return () => {
    if (detached) {
      return; // detach twice and nothing is removed that was re-registered
    }
    detached = true;
    for (const [event, handler] of bindings) {
      socket.off(event, handler);
    }
  };
}
