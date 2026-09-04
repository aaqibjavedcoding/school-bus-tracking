/**
 * Injection tokens and shared messages for the import / export / reports
 * feature.
 *
 * Models are injected behind string tokens (never `SequelizeModule.forFeature`)
 * so the API still boots with `DB_AUTO_CONNECT=false` and unit tests can supply
 * in-memory stubs — the same convention every other feature module follows.
 */

export const DATA_TRANSFER_STUDENTS_REPOSITORY = 'DATA_TRANSFER_STUDENTS_REPOSITORY';
export const DATA_TRANSFER_GUARDIANS_REPOSITORY = 'DATA_TRANSFER_GUARDIANS_REPOSITORY';
export const DATA_TRANSFER_USERS_REPOSITORY = 'DATA_TRANSFER_USERS_REPOSITORY';
export const DATA_TRANSFER_BUSES_REPOSITORY = 'DATA_TRANSFER_BUSES_REPOSITORY';
export const DATA_TRANSFER_ROUTES_REPOSITORY = 'DATA_TRANSFER_ROUTES_REPOSITORY';
export const DATA_TRANSFER_STOPS_REPOSITORY = 'DATA_TRANSFER_STOPS_REPOSITORY';
export const DATA_TRANSFER_ASSIGNMENTS_REPOSITORY = 'DATA_TRANSFER_ASSIGNMENTS_REPOSITORY';
export const DATA_TRANSFER_TRIPS_REPOSITORY = 'DATA_TRANSFER_TRIPS_REPOSITORY';
export const DATA_TRANSFER_ATTENDANCE_REPOSITORY = 'DATA_TRANSFER_ATTENDANCE_REPOSITORY';
export const DATA_TRANSFER_NOTIFICATIONS_REPOSITORY = 'DATA_TRANSFER_NOTIFICATIONS_REPOSITORY';
export const DATA_TRANSFER_BUS_DOCUMENTS_REPOSITORY = 'DATA_TRANSFER_BUS_DOCUMENTS_REPOSITORY';
export const DATA_TRANSFER_DRIVER_DOCUMENTS_REPOSITORY =
  'DATA_TRANSFER_DRIVER_DOCUMENTS_REPOSITORY';
export const DATA_TRANSFER_IMPORT_JOBS_REPOSITORY = 'DATA_TRANSFER_IMPORT_JOBS_REPOSITORY';
export const DATA_TRANSFER_SEQUELIZE = 'DATA_TRANSFER_SEQUELIZE';

/** Generic not-found message: never distinguishes "missing" from "other tenant". */
export const IMPORT_JOB_NOT_FOUND_MESSAGE = 'Import job not found';

/** Returned when a job has no stored row errors to download. */
export const IMPORT_ERROR_FILE_UNAVAILABLE_MESSAGE =
  'This import run has no error file to download';

/** Returned when the multipart request carried no file part. */
export const IMPORT_FILE_REQUIRED_MESSAGE = 'A spreadsheet file is required';

/** Returned for an unsupported extension / content type. */
export const IMPORT_FILE_TYPE_MESSAGE =
  'Unsupported file type. Upload a .xlsx or .csv file exported from the template.';

/** Returned when the uploaded file is larger than the accepted size. */
export const IMPORT_FILE_TOO_LARGE_MESSAGE = 'The file is larger than the 5 MB upload limit';

/** Returned when the file has no importable rows at all. */
export const IMPORT_FILE_EMPTY_MESSAGE = 'The file does not contain any data rows below the header';

/** Returned by commit when nothing in the file can be written. */
export const IMPORT_NOTHING_TO_IMPORT_MESSAGE =
  'No valid rows to import. Download the error file, fix the highlighted rows and upload again.';

/** Preview rows returned by validate / commit. */
export const IMPORT_PREVIEW_LIMIT = 50;

/**
 * Row errors persisted on an `import_jobs` row.
 *
 * Errors are stored so the error workbook can be re-downloaded later, but a
 * pathological 5 000-row file of garbage should not write a multi-megabyte
 * JSONB document, so the stored list is capped and the summary keeps the true
 * counts.
 */
export const IMPORT_STORED_ERROR_LIMIT = 1000;
