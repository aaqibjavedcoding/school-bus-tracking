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
  /**
   * Crew stop marking. Separate scopes for the two actions on purpose: the
   * same key replayed against `arrive` and `skip` must stay two independent
   * operations, so a queued "Arrived" can never be satisfied by a "Skip"
   * receipt (or the reverse) after a retry.
   */
  STOP_ARRIVE: 'crew-stops.arrive',
  STOP_SKIP: 'crew-stops.skip',
  TRIP_CANCEL: 'trips.cancel',
  TRIP_LOCATION: 'live-tracking.location',
  /**
   * Marketing campaign scheduling — the one marketing endpoint that writes a
   * recipient snapshot, so a double submit must never write it twice. (The
   * service layer is idempotent on its own — a campaign already SCHEDULED is
   * returned untouched — this scope additionally short-circuits the replay
   * before the handler runs.)
   */
  MARKETING_CAMPAIGN_SCHEDULE: 'marketing.campaign_schedule',
  /**
   * Platform-level marketing creates. Each names its **resource type**, which
   * is the half of the scope that stops a console from replaying "create
   * template" into "create campaign" when it reuses one request id for a
   * multi-step wizard.
   */
  MARKETING_TEMPLATE_CREATE: 'marketing.template_create',
  MARKETING_TEMPLATE_VERSION_PUBLISH: 'marketing.template_version_publish',
  MARKETING_CAMPAIGN_CREATE: 'marketing.campaign_create',
} as const;

/**
 * Prefix marking a key that belongs to the **platform** (SUPER_ADMIN) scope
 * rather than to a tenant. See {@link buildIdempotencyScope}.
 */
export const IDEMPOTENCY_PLATFORM_SCOPE_PREFIX = 'platform:';

/** Prefix marking a key that belongs to one school's tenant scope. */
export const IDEMPOTENCY_TENANT_SCOPE_PREFIX = 'school:';

/**
 * Builds the stored `endpoint` value of one idempotent operation.
 *
 * Two dimensions are folded into it, and both are load-bearing:
 *
 * - the **resource type** (the `IDEMPOTENCY_ENDPOINTS` value itself), so the
 *   same client key sent to "create template" and "create campaign" is two
 *   independent operations rather than one replay that returns the wrong
 *   entity;
 * - the **scope**, so a platform record (`school_id IS NULL`) and a tenant
 *   record can never share a row. A tenant row is additionally isolated by
 *   its `school_id` column; the platform prefix is what keeps the pair
 *   distinguishable in the `(user_id, endpoint, key)` index that governs
 *   platform rows, where there is no tenant column to isolate by.
 *
 * The scope is derived from the **authenticated** principal only — a
 * client-supplied `school_id` never reaches this function.
 */
export function buildIdempotencyScope(endpoint: string, schoolId: string | null): string {
  return schoolId === null
    ? `${IDEMPOTENCY_PLATFORM_SCOPE_PREFIX}${endpoint}`
    : `${IDEMPOTENCY_TENANT_SCOPE_PREFIX}${endpoint}`;
}
