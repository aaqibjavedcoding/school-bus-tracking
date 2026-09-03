/** Injection tokens for the audit module. */
export const AUDIT_REPOSITORY = 'AUDIT_REPOSITORY';
export const AUDIT_USER_REPOSITORY = 'AUDIT_USER_REPOSITORY';
export const AUDIT_SCHOOL_REPOSITORY = 'AUDIT_SCHOOL_REPOSITORY';

/** Well-known audit actions. */
export const AUDIT_ACTIONS = {
  // School lifecycle
  SCHOOL_CREATE: 'school.create',
  SCHOOL_UPDATE: 'school.update',
  SCHOOL_ACTIVATE: 'school.activate',
  SCHOOL_DEACTIVATE: 'school.deactivate',

  // School admin management
  SCHOOL_ADMIN_CREATE: 'school_admin.create',
  SCHOOL_ADMIN_UPDATE: 'school_admin.update',
  SCHOOL_ADMIN_PASSWORD_RESET: 'school_admin.password_reset',

  // Plan / subscription
  PLAN_CREATE: 'plan.create',
  PLAN_UPDATE: 'plan.update',
  PLAN_DEACTIVATE: 'plan.deactivate',
  SUBSCRIPTION_ASSIGN: 'subscription.assign',
  SUBSCRIPTION_CHANGE: 'subscription.change',
  SUBSCRIPTION_CANCEL: 'subscription.cancel',

  // Student
  STUDENT_CREATE: 'student.create',
  STUDENT_UPDATE: 'student.update',
  STUDENT_DEACTIVATE: 'student.deactivate',

  // Guardian / parent
  GUARDIAN_CREATE: 'guardian.create',
  GUARDIAN_UPDATE: 'guardian.update',
  GUARDIAN_DEACTIVATE: 'guardian.deactivate',

  // Staff
  STAFF_CREATE: 'staff.create',
  STAFF_UPDATE: 'staff.update',
  STAFF_DEACTIVATE: 'staff.deactivate',

  // Bus
  BUS_CREATE: 'bus.create',
  BUS_UPDATE: 'bus.update',
  BUS_DEACTIVATE: 'bus.deactivate',

  // Route / stop
  ROUTE_CREATE: 'route.create',
  ROUTE_UPDATE: 'route.update',
  ROUTE_DEACTIVATE: 'route.deactivate',
  STOP_CREATE: 'stop.create',
  STOP_UPDATE: 'stop.update',
  STOP_DEACTIVATE: 'stop.deactivate',

  // Assignment
  ASSIGNMENT_CREATE: 'assignment.create',
  ASSIGNMENT_UPDATE: 'assignment.update',
  ASSIGNMENT_DEACTIVATE: 'assignment.deactivate',

  // Trip
  TRIP_CREATE: 'trip.create',
  TRIP_UPDATE: 'trip.update',
  TRIP_STATUS_CHANGE: 'trip.status_change',
  TRIP_CANCEL: 'trip.cancel',

  // Attendance
  ATTENDANCE_CORRECTION: 'attendance.correction',

  // Document
  DOCUMENT_CREATE: 'document.create',
  DOCUMENT_UPDATE: 'document.update',
  DOCUMENT_DELETE: 'document.delete',

  // Emergency
  EMERGENCY_SOS: 'emergency.sos',
  EMERGENCY_ACKNOWLEDGE: 'emergency.acknowledge',
  EMERGENCY_RESOLVE: 'emergency.resolve',
  EMERGENCY_CANCEL: 'emergency.cancel',

  // Bulk data transfer (import / export / reports)
  IMPORT_VALIDATE: 'import.validate',
  IMPORT_COMMIT: 'import.commit',
  IMPORT_TEMPLATE_DOWNLOAD: 'import.template_download',
  IMPORT_ERROR_FILE_DOWNLOAD: 'import.error_file_download',
  EXPORT_DOWNLOAD: 'export.download',
  REPORT_EXPORT: 'report.export',

  // Super Admin assisted school management ("Manage Data"). The platform
  // operator manages a school's operational data as themselves — never as the
  // school admin — so these actions carry the Super Admin as the actor and the
  // managed school as the tenant, with the session id in the metadata.
  ASSISTED_SESSION_START: 'assisted.session_start',
  ASSISTED_SESSION_END: 'assisted.session_end',
  /** Generic create/update/delete through an assisted-management endpoint. */
  ASSISTED_MUTATION: 'assisted.mutation',

  // Auth / security
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_PASSWORD_RESET: 'auth.password_reset',
  AUTH_TOKEN_REFRESH: 'auth.token_refresh',
  USER_DEACTIVATE: 'user.deactivate',
  USER_ACTIVATE: 'user.activate',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Well-known entity types for audit logs. */
export const AUDIT_ENTITY_TYPES = {
  SCHOOL: 'school',
  USER: 'user',
  STUDENT: 'student',
  GUARDIAN: 'guardian',
  BUS: 'bus',
  ROUTE: 'route',
  STOP: 'stop',
  ASSIGNMENT: 'assignment',
  TRIP: 'trip',
  ATTENDANCE: 'attendance',
  DOCUMENT: 'document',
  EMERGENCY: 'emergency',
  PLAN: 'plan',
  SUBSCRIPTION: 'subscription',
  NOTIFICATION: 'notification',
  IMPORT_JOB: 'import_job',
  EXPORT: 'export',
  REPORT: 'report',
  ASSISTED_MANAGEMENT_SESSION: 'assisted_management_session',
} as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[keyof typeof AUDIT_ENTITY_TYPES];

/** Maximum metadata size to prevent unbounded JSONB growth. */
export const AUDIT_METADATA_MAX_BYTES = 4096;

/** Fields that must never appear in audit metadata. */
export const AUDIT_REDACTED_FIELDS = [
  'password',
  'password_hash',
  'refresh_token',
  'refresh_token_hash',
  'csrf_token',
  'access_token',
  'jwt',
  'token',
  'secret',
  'medical',
  'medical_info',
  'medical_notes',
  'health_conditions',
] as const;

/**
 * Value written into audit `metadata.context` for every event produced by the
 * Super Admin assisted-management surface ("Manage Data"). Present in the
 * metadata of rows that already record the Super Admin as `actor_user_id` and
 * the managed school as `school_id`, so platform-operator activity is
 * identifiable at a glance in the existing audit UI.
 */
export const AUDIT_CONTEXT_ASSISTED_MANAGEMENT = 'assisted_management';

/**
 * Optional audit context handed to reusable services (import, export,
 * reports) when they run inside an assisted-management session. It carries no
 * identity — the actor and school are already known — only the session link.
 */
export interface AssistedAuditContext {
  assisted_session_id?: string | null;
}
