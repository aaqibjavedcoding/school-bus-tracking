/**
 * Injection tokens and user-facing messages for the compliance-document
 * modules (Task 44).
 *
 * Model classes are injected behind tokens (instead of
 * `SequelizeModule.forFeature`) so the application still boots while
 * `DB_AUTO_CONNECT=false` and unit tests can substitute in-memory stubs —
 * the same pattern used by every other feature module.
 */
export const BUS_DOCUMENTS_REPOSITORY = 'BUS_DOCUMENTS_REPOSITORY';
export const DRIVER_DOCUMENTS_REPOSITORY = 'DRIVER_DOCUMENTS_REPOSITORY';
export const DOCUMENT_REQUIREMENTS_REPOSITORY = 'DOCUMENT_REQUIREMENTS_REPOSITORY';
export const DOCUMENTS_BUS_REPOSITORY = 'DOCUMENTS_BUS_REPOSITORY';
export const DOCUMENTS_USER_REPOSITORY = 'DOCUMENTS_USER_REPOSITORY';

/** Default page size and hard bound of the document list endpoints. */
export const DEFAULT_DOCUMENT_LIMIT = 20;
export const MAX_DOCUMENT_LIMIT = 100;

/**
 * Generic not-found message for the *owner* of a document set.
 *
 * Deliberately identical for an unknown id, a resource of another tenant and
 * (for drivers) a user with a different role, so probing ids can never
 * confirm that a resource exists.
 */
export const DOCUMENTS_BUS_NOT_FOUND_MESSAGE = 'Bus not found';
export const DOCUMENTS_DRIVER_NOT_FOUND_MESSAGE = 'Driver not found';

/** Generic not-found message for a document row itself. */
export const BUS_DOCUMENT_NOT_FOUND_MESSAGE = 'Bus document not found';
export const DRIVER_DOCUMENT_NOT_FOUND_MESSAGE = 'Driver document not found';

/** Confirmation returned after a document is soft-deleted. */
export const BUS_DOCUMENT_DELETED_MESSAGE = 'Bus document deleted successfully';
export const DRIVER_DOCUMENT_DELETED_MESSAGE = 'Driver document deleted successfully';

/** Raised when the issue date is later than the expiry date. */
export const DOCUMENT_DATE_RANGE_MESSAGE = 'expiry_date must be on or after issue_date';

/** Raised when a document type does not belong to the catalogue of its owner. */
export const DOCUMENT_TYPE_INVALID_MESSAGE = 'document_type is not valid for this resource';

/** Raised when a required/optional requirement names an unknown document type. */
export const DOCUMENT_REQUIREMENT_TYPE_INVALID_MESSAGE =
  'One or more document types are not valid for this resource';

/** Upper bound of the requirements that can be written in one request. */
export const MAX_DOCUMENT_REQUIREMENTS = 64;
