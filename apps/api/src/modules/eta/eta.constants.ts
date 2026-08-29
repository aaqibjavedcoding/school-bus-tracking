/**
 * DI tokens and user-facing messages for the Task 22 ETA + stop-arrival
 * feature.
 *
 * Repository classes are injected behind tokens instead of using
 * `SequelizeModule.forFeature`, matching every other feature module. This
 * keeps the API bootable with `DB_AUTO_CONNECT=false` and makes the services
 * straightforward to unit test with in-memory repositories.
 */
export const ETA_STOPS_REPOSITORY = 'ETA_STOPS_REPOSITORY';
export const ETA_ARRIVALS_REPOSITORY = 'ETA_ARRIVALS_REPOSITORY';
export const ETA_CONFIG = 'ETA_CONFIG';

/** Default fallback speed (km/h) used when the device reports none/zero. */
export const DEFAULT_FALLBACK_SPEED_KMH = 25;

/** Operational speed band the effective speed is clamped into (km/h). */
export const DEFAULT_MIN_SPEED_KMH = 5;
export const DEFAULT_MAX_SPEED_KMH = 90;

/**
 * Generic not-found message for ETA / arrival reads.
 *
 * Deliberately identical for an unknown trip, a trip of another school and a
 * trip the caller may not observe, so probing ids can never confirm that a
 * resource exists — the same rule the location endpoints apply.
 */
export const ETA_TRIP_NOT_FOUND_MESSAGE = 'Trip not found';
