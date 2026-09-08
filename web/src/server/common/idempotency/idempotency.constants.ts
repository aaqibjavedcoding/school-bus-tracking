/** Injection token for the idempotency key repository. */
export const IDEMPOTENCY_REPOSITORY = 'IDEMPOTENCY_REPOSITORY';

/** Header name for the client-generated idempotency key. */
export const IDEMPOTENCY_HEADER = 'x-idempotency-key';

/**
 * Endpoints that support idempotency.
 *
 * Each value is the endpoint scope stored alongside the key: the same key
 * string used against two different scopes is treated as two independent
 * operations, so a client can never replay a boarding as an SOS by reusing
 * a key. HTTP scopes are declared on the endpoint definitions
 * (`EndpointDefinition.idempotency`) and enforced by the route runtime;
 * `TRIP_LOCATION` is enforced inside `LiveTrackingService.recordLocation`
 * (the socket ingest path), scoped per trip as
 * `live-tracking.location:<tripId>`.
 */
export const IDEMPOTENCY_ENDPOINTS = {
  BOARD: 'trip-attendance.board',
  DROP: 'trip-attendance.drop',
  SOS: 'emergencies.sos',
  EMERGENCY_STATUS: 'emergencies.status',
  TRIP_STATUS: 'trips.status',
  TRIP_CANCEL: 'trips.cancel',
  TRIP_LOCATION: 'live-tracking.location',
} as const;
