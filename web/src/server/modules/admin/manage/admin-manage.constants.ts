import type { AuditEntityType } from '../../audit';

/**
 * Constants for the Super Admin assisted school-management surface
 * (`/api/v1/admin/schools/:schoolId/manage/*`).
 *
 * The surface reuses the existing tenant feature services; the only things it
 * owns are the managed-school guard, the session bookkeeping and the audit
 * context. Model classes are provided behind tokens (the convention of every
 * other module) so the app boots with `DB_AUTO_CONNECT=false` and unit tests
 * can inject stubs.
 */
export const ADMIN_MANAGE_SCHOOLS_REPOSITORY = 'ADMIN_MANAGE_SCHOOLS_REPOSITORY';
export const ADMIN_MANAGE_SESSIONS_REPOSITORY = 'ADMIN_MANAGE_SESSIONS_REPOSITORY';
/** Live Sequelize connection (optional; unit tests run without a database). */
export const ADMIN_MANAGE_SEQUELIZE = 'ADMIN_MANAGE_SEQUELIZE';

/** Route parameter that always carries the managed school id. */
export const MANAGED_SCHOOL_PARAM = 'schoolId';

/** Property the {@link ManagedSchoolGuard} attaches to the request. */
export const MANAGED_SCHOOL_REQUEST_PROPERTY = 'managedSchool';

/** Shape attached to the request by {@link ManagedSchoolGuard}. */
export interface ManagedSchoolContext {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

/** Generic 404 when the managed school does not exist (or is soft-deleted). */
export const MANAGED_SCHOOL_NOT_FOUND_MESSAGE = 'School not found';

/**
 * 403 when a mutation is attempted through assisted management while the
 * managed school is deactivated. Reads stay available so a platform operator
 * can inspect a suspended tenant's data; writes would silently bypass the
 * inactive-school rule that prevents the school's own admins from mutating.
 */
export const MANAGED_SCHOOL_INACTIVE_MESSAGE =
  'This school is deactivated — assisted management is read-only until the school is activated';

/**
 * Explicit capability allowlist of assisted management.
 *
 * Everything not listed here is deliberately unreachable from the
 * assisted-management surface: school-admin credentials and MFA operations,
 * parent-portal impersonation, parent message threads, emergency/mass parent
 * notifications, billing/subscription changes, platform configuration and
 * audit-log modification have no assisted-management route at all, and the
 * existing platform endpoints for them remain the only way to perform them.
 */
export const ASSISTED_MANAGEMENT_CAPABILITIES = [
  'students',
  'parents',
  'student_guardians',
  'buses',
  'routes',
  'stops',
  'drivers',
  'conductors',
  'route_assignments',
  'imports',
  'exports',
  'import_templates',
  'import_history',
  'reports',
] as const;

export type AssistedManagementCapability = (typeof ASSISTED_MANAGEMENT_CAPABILITIES)[number];

/**
 * Map of managed URL resource segment → audit entity type, used by the
 * assisted-mutation audit interceptor. Resources whose endpoints audit
 * themselves (imports, exports, reports) are intentionally absent.
 */
export const ASSISTED_AUDIT_ENTITY_BY_RESOURCE: Record<string, AuditEntityType> = {
  students: 'student',
  parents: 'guardian',
  guardians: 'guardian',
  buses: 'bus',
  routes: 'route',
  stops: 'stop',
  drivers: 'user',
  conductors: 'user',
  'route-assignments': 'assignment',
  assignments: 'assignment',
};
