/**
 * Endpoint definitions for the `auth-test` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, parseUuidParam, validateDto } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { UserRole } from '@school-bus-tracking/shared-types';
import type { AuthenticatedRequestUser } from '../common/guards';

/** Payload of `GET /api/v1/auth-test/me`. */
export interface AuthTestMeResponse {
  user: AuthenticatedRequestUser;
}

/** Payload of the two role-probe endpoints. */
export interface AuthTestRoleResponse {
  message: string;
  role: UserRole;
}

export const ADMIN_ONLY_MESSAGE = 'Authenticated as school admin';
export const STAFF_ONLY_MESSAGE = 'Authenticated as operations staff';

/** `GET /api/v1/auth-test/me` */
export const getAuthtestMe: EndpointDefinition = {
  status: HttpStatus.OK,
  handler: async ({ user }) => {
    return { user };
  },
};

/** `GET /api/v1/auth-test/admin-only` */
export const getAuthtestAdminonly: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user }) => {
    const role = user.role as UserRole;
    return { message: ADMIN_ONLY_MESSAGE, role };
  },
};

/** `GET /api/v1/auth-test/staff-only` */
export const getAuthtestStaffonly: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR],
  status: HttpStatus.OK,
  handler: async ({ user }) => {
    const role = user.role as UserRole;
    return { message: STAFF_ONLY_MESSAGE, role };
  },
};
