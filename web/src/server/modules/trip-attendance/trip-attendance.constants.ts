/**
 * Injection tokens and user-facing messages for trip student attendance.
 *
 * Repository classes are injected behind tokens instead of using
 * `SequelizeModule.forFeature`, matching every other feature module. This
 * keeps the API bootable with `DB_AUTO_CONNECT=false` and makes the service
 * straightforward to unit test with in-memory repositories.
 */
export const TRIP_ATTENDANCE_REPOSITORY = 'TRIP_ATTENDANCE_REPOSITORY';
export const TRIP_ATTENDANCE_TRIPS_REPOSITORY = 'TRIP_ATTENDANCE_TRIPS_REPOSITORY';
export const TRIP_ATTENDANCE_STOPS_REPOSITORY = 'TRIP_ATTENDANCE_STOPS_REPOSITORY';
export const TRIP_ATTENDANCE_STUDENTS_REPOSITORY = 'TRIP_ATTENDANCE_STUDENTS_REPOSITORY';
export const TRIP_ATTENDANCE_GUARDIANS_REPOSITORY = 'TRIP_ATTENDANCE_GUARDIANS_REPOSITORY';
export const TRIP_ATTENDANCE_ROUTE_ASSIGNMENTS_REPOSITORY =
  'TRIP_ATTENDANCE_ROUTE_ASSIGNMENTS_REPOSITORY';

/**
 * Generic not-found message for the trip.
 *
 * It is deliberately identical for an unknown id, a trip of another school and
 * a trip the caller is not rostered on, so probing ids can never confirm that
 * a resource exists.
 */
export const TRIP_ATTENDANCE_TRIP_NOT_FOUND_MESSAGE = 'Trip not found';

/**
 * Generic not-found message for the student.
 *
 * Covers an unknown student, a student of another school, an inactive
 * student, a student without a home stop and a student whose stop belongs to
 * a different route — none of them are distinguishable from the outside.
 */
export const TRIP_ATTENDANCE_STUDENT_NOT_ON_TRIP_MESSAGE =
  'Student is not on the manifest of this trip';

/** Lifecycle guard: attendance is immutable once the run is closed. */
export const TRIP_ATTENDANCE_TRIP_CLOSED_MESSAGE =
  'Attendance can only be recorded while the trip is scheduled, boarding or in progress';

/** Attendance transition guards. */
export const TRIP_ATTENDANCE_ALREADY_BOARDED_MESSAGE =
  'Student is already marked as boarded on this trip';
export const TRIP_ATTENDANCE_ALREADY_DROPPED_MESSAGE =
  'Student is already marked as dropped off on this trip';
export const TRIP_ATTENDANCE_NOT_BOARDED_MESSAGE =
  'Student must be marked as boarded before being dropped off';

/** Raised when the repository layer is not backed by a Sequelize instance. */
export const TRIP_ATTENDANCE_NO_SEQUELIZE_MESSAGE =
  'Sequelize instance is unavailable for trip attendance writes';
