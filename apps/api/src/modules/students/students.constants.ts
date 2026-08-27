/**
 * Injection tokens and user-facing messages for the student management module.
 *
 * Models are injected behind tokens (instead of `SequelizeModule.forFeature`)
 * so the application still boots while `DB_AUTO_CONNECT=false` and unit tests
 * can substitute in-memory stubs — the same pattern used by AuthModule.
 */
export const STUDENTS_REPOSITORY = 'STUDENTS_REPOSITORY';
export const STUDENTS_STOPS_REPOSITORY = 'STUDENTS_STOPS_REPOSITORY';

/**
 * Generic not-found message. It deliberately does not distinguish "does not
 * exist" from "exists in another tenant" so cross-tenant probes cannot learn
 * anything about other schools' students.
 */
export const STUDENT_NOT_FOUND_MESSAGE = 'Student not found';

/**
 * Message returned when a referenced `home_stop_id` does not belong to the
 * authenticated school. Also generic: a stop of another tenant is reported the
 * same way as a stop that does not exist at all.
 */
export const STUDENT_HOME_STOP_INVALID_MESSAGE =
  'Referenced home stop does not belong to this school';

/** Message returned on an admission-number conflict inside the same school. */
export const STUDENT_ADMISSION_NUMBER_TAKEN_MESSAGE =
  'A student with this admission number already exists in this school';

/** Message returned when a calendar-valid shape is not a real date. */
export const STUDENT_DATE_OF_BIRTH_INVALID_MESSAGE = 'date_of_birth must be a valid calendar date';

/** Confirmation message returned by soft delete. */
export const STUDENT_DELETED_MESSAGE = 'Student deleted successfully';
