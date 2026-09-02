/**
 * Injection tokens for the reports module.
 *
 * Reports read from a wide slice of the schema, so every model arrives behind
 * its own token — the app still boots with `DB_AUTO_CONNECT=false` and unit
 * tests can inject stubs for exactly the tables a given report touches.
 */
export const REPORTS_STUDENTS_REPOSITORY = 'REPORTS_STUDENTS_REPOSITORY';
export const REPORTS_GUARDIANS_REPOSITORY = 'REPORTS_GUARDIANS_REPOSITORY';
export const REPORTS_USERS_REPOSITORY = 'REPORTS_USERS_REPOSITORY';
export const REPORTS_BUSES_REPOSITORY = 'REPORTS_BUSES_REPOSITORY';
export const REPORTS_ROUTES_REPOSITORY = 'REPORTS_ROUTES_REPOSITORY';
export const REPORTS_STOPS_REPOSITORY = 'REPORTS_STOPS_REPOSITORY';
export const REPORTS_ASSIGNMENTS_REPOSITORY = 'REPORTS_ASSIGNMENTS_REPOSITORY';
export const REPORTS_TRIPS_REPOSITORY = 'REPORTS_TRIPS_REPOSITORY';
export const REPORTS_ATTENDANCE_REPOSITORY = 'REPORTS_ATTENDANCE_REPOSITORY';
export const REPORTS_NOTIFICATIONS_REPOSITORY = 'REPORTS_NOTIFICATIONS_REPOSITORY';
export const REPORTS_BUS_DOCUMENTS_REPOSITORY = 'REPORTS_BUS_DOCUMENTS_REPOSITORY';
export const REPORTS_DRIVER_DOCUMENTS_REPOSITORY = 'REPORTS_DRIVER_DOCUMENTS_REPOSITORY';

/** Returned when the requested report does not exist. */
export const REPORT_NOT_FOUND_MESSAGE = 'Report not found';
