/**
 * Endpoint definitions for the `dashboard` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { UserRole } from '@school-bus-tracking/shared-types';

/**
 * `GET /api/v1/dashboard/stats`
 *
 * The school-admin dashboard's four headline counts (students, buses, routes
 * and today's live trips) in one call — four parallel COUNT queries instead
 * of four enriched list endpoints.
 */
export const getDashboardStats: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  handler: async ({ user }) => {
    const schoolId = user.school_id as string;
    return container().dashboard().stats(schoolId);
  },
};
