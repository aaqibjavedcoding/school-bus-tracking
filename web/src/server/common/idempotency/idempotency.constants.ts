/** Injection token for the idempotency key repository. */
export const IDEMPOTENCY_REPOSITORY = 'IDEMPOTENCY_REPOSITORY';

/** Header name for the client-generated idempotency key. */
export const IDEMPOTENCY_HEADER = 'x-idempotency-key';

/** Endpoints that support idempotency. */
export const IDEMPOTENCY_ENDPOINTS = {
  BOARD: 'trip-attendance.board',
  DROP: 'trip-attendance.drop',
  SOS: 'emergencies.sos',
  TRIP_STATUS: 'trips.status',
} as const;
