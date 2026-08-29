import { UserRole, type AuthenticatedUser } from '@school-bus-tracking/shared-types';

/**
 * Post-login landing routes. The role is read from the *verified session*
 * (`AuthenticatedUser` returned by `/auth/login` / `/auth/refresh`) — the
 * client never sends or asserts a role, and this mapping only decides which
 * screen to show. Every endpoint keeps enforcing RBAC server-side.
 */

export type AuthRole = `${UserRole}`;

export const ROLE_HOME_ROUTES = {
  [UserRole.SCHOOL_ADMIN]: '/admin',
  [UserRole.DRIVER]: '/driver',
  [UserRole.CONDUCTOR]: '/conductor',
  [UserRole.PARENT]: '/parent',
  // The platform console is a web surface; mobile deliberately has no
  // SUPER_ADMIN workflow. The screen only explains that and offers sign-out.
  [UserRole.SUPER_ADMIN]: '/platform-unsupported',
} as const satisfies Record<AuthRole, string>;

export function homeRouteForUser(user: AuthenticatedUser | null): string | null {
  if (!user) return null;
  return ROLE_HOME_ROUTES[user.role as AuthRole] ?? '/platform-unsupported';
}

/** Routes a signed-in user of `role` may open inside `(authenticated)`. */
export function canOpenRoute(
  role: AuthenticatedUser['role'] | null,
  group: AuthRole | 'any',
): boolean {
  if (group === 'any') return true;
  return role === group;
}
