import { UserRole } from '@school-bus-tracking/shared-types';

/**
 * Role-based navigation map for the mobile app.
 *
 * Routes live in expo-router groups — `(crew)`, `(parent)`, `(admin)` — whose
 * directories do not appear in the URL, so `/trip` is `app/(crew)/trip.tsx`.
 * Driver and conductor intentionally share one crew experience: the server
 * scopes every crew request to the caller's own trips and authorizes both
 * roles identically, so one set of screens serves both.
 */

export const CREW_ROLES: readonly UserRole[] = [UserRole.DRIVER, UserRole.CONDUCTOR];

export function isCrewRole(role: UserRole): boolean {
  return role === UserRole.DRIVER || role === UserRole.CONDUCTOR;
}

/** Landing route after login / refresh for each role. */
export function homeRoute(role: UserRole): string {
  switch (role) {
    case UserRole.DRIVER:
    case UserRole.CONDUCTOR:
      return '/trip';
    case UserRole.PARENT:
      return '/home';
    case UserRole.SCHOOL_ADMIN:
      return '/today';
    case UserRole.SUPER_ADMIN:
      return '/platform';
    default:
      return '/login';
  }
}

/** May `role` enter the route group mounted at `groupRoute`? */
export function canEnterGroup(
  role: UserRole | null | undefined,
  group: 'crew' | 'parent' | 'admin',
): boolean {
  if (!role) return false;
  switch (group) {
    case 'crew':
      return isCrewRole(role);
    case 'parent':
      return role === UserRole.PARENT;
    case 'admin':
      return role === UserRole.SCHOOL_ADMIN;
    default:
      return false;
  }
}

/** Tab-bar label for the crew tabs, personalised by role. */
export function crewRoleLabel(role: UserRole): string {
  return role === UserRole.CONDUCTOR ? 'Conductor' : 'Driver';
}
