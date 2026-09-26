/**
 * Messages of the crew stop-marking endpoints.
 *
 * Every "you may not" collapses into the same generic not-found sentence as
 * the rest of the trip surface: an unknown trip, another school's trip, a
 * trip this crew member does not drive and a stop that is not on the trip's
 * route must be indistinguishable from the outside, or the 404 becomes an
 * oracle for probing which trips and stops exist.
 */
export const CREW_STOPS_TRIP_NOT_FOUND_MESSAGE = 'Trip not found.';

/** The stop is not on this trip's route (or belongs to another tenant). */
export const CREW_STOPS_STOP_NOT_ON_TRIP_MESSAGE = 'Stop not found on this trip.';

/** The run is finished or cancelled — its stop record is now an audit trail. */
export const CREW_STOPS_TRIP_CLOSED_MESSAGE =
  'This trip is closed, so its stops can no longer be marked.';
