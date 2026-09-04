/**
 * Injection tokens and user-facing messages for live GPS tracking.
 *
 * Repository classes are injected behind tokens instead of using
 * `SequelizeModule.forFeature`, matching every other feature module. This
 * keeps the API bootable with `DB_AUTO_CONNECT=false` and makes the service
 * straightforward to unit test with in-memory repositories.
 */
export const LIVE_TRACKING_REPOSITORY = 'LIVE_TRACKING_REPOSITORY';
export const LIVE_TRACKING_TRIPS_REPOSITORY = 'LIVE_TRACKING_TRIPS_REPOSITORY';
export const LIVE_TRACKING_ASSIGNMENTS_REPOSITORY = 'LIVE_TRACKING_ASSIGNMENTS_REPOSITORY';
export const LIVE_TRACKING_STUDENTS_REPOSITORY = 'LIVE_TRACKING_STUDENTS_REPOSITORY';
export const LIVE_TRACKING_STOPS_REPOSITORY = 'LIVE_TRACKING_STOPS_REPOSITORY';
export const LIVE_TRACKING_GUARDIANS_REPOSITORY = 'LIVE_TRACKING_GUARDIANS_REPOSITORY';

/** Environment-backed tuning of the tracking pipeline (see `config/`). */
export const LIVE_TRACKING_CONFIG = 'LIVE_TRACKING_CONFIG';

/** Default minimum gap between accepted fixes of one crew device (2.5 s). */
export const DEFAULT_GPS_MIN_INTERVAL_MS = 2500;

/** Default tolerance for a device clock ahead of the server (5 min). */
export const DEFAULT_GPS_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

/** Default tolerance for a device clock behind the server (24 h). */
export const DEFAULT_GPS_MAX_PAST_SKEW_MS = 24 * 60 * 60 * 1000;

/** Default page size and hard bound of the location history endpoint. */
export const DEFAULT_HISTORY_LIMIT = 100;
export const MAX_HISTORY_LIMIT = 500;

/**
 * Generic not-found message for the trip.
 *
 * Deliberately identical for an unknown id, a trip of another school and a
 * trip the caller is not rostered on, so probing ids can never confirm that
 * a resource exists.
 */
export const LIVE_TRACKING_TRIP_NOT_FOUND_MESSAGE = 'Trip not found';

/** Raised when an authorised trip has no accepted GPS fix yet. */
export const LIVE_TRACKING_NO_LOCATION_MESSAGE = 'No location has been recorded for this trip yet';

/** Generic rejection message for a malformed tracking payload. */
export const LIVE_TRACKING_INVALID_PAYLOAD_MESSAGE = 'Location update payload is malformed';

/** Raised when the history query is out of bounds. */
export const LIVE_TRACKING_HISTORY_QUERY_MESSAGE =
  'Location history query is malformed: from and to must be valid ISO-8601 date-times with to on or after from, and limit between 1 and 500';

/** Raised when the repository layer is not backed by a Sequelize instance. */
export const LIVE_TRACKING_NO_SEQUELIZE_MESSAGE =
  'Sequelize instance is unavailable for live tracking';
