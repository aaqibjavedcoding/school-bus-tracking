/** Injection token for the tenant-scoped PARENT user repository. */
export const PARENTS_REPOSITORY = 'PARENTS_REPOSITORY';

/** Injection token for the tenant-scoped student repository used by links. */
export const PARENTS_STUDENTS_REPOSITORY = 'PARENTS_STUDENTS_REPOSITORY';

/** Injection token for the student_guardians join repository. */
export const STUDENT_GUARDIANS_REPOSITORY = 'STUDENT_GUARDIANS_REPOSITORY';

/** Generic account not-found message; also covers another tenant. */
export const PARENT_NOT_FOUND_MESSAGE = 'Parent account not found';

/** Generic relationship not-found message; also covers another tenant. */
export const STUDENT_GUARDIAN_NOT_FOUND_MESSAGE = 'Student-parent relationship not found';

/** Email is unique across all users within a school. */
export const PARENT_EMAIL_TAKEN_MESSAGE = 'A user with this email already exists in this school';

/** Duplicate active student ↔ parent link. */
export const STUDENT_GUARDIAN_ALREADY_EXISTS_MESSAGE =
  'This parent is already linked to this student';

/** Confirmation returned after a parent account is soft-deleted. */
export const PARENT_DELETED_MESSAGE = 'Parent account deleted successfully';

/** Confirmation returned after a relationship is soft-deleted. */
export const STUDENT_GUARDIAN_DELETED_MESSAGE = 'Student-parent relationship deleted successfully';
