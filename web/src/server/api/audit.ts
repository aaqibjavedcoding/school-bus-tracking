/**
 * Endpoint definitions for the `audit` module.
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
import { AuditService, type AuditLogListResponse, type ListAuditLogsQuery } from '../modules/audit/audit.service';

/** `GET /api/v1/audit-logs` */
export const getAuditlogs: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, query }) => {
    // School Admin is always scoped to their own school.
    const typedQuery = query as ListAuditLogsQuery;
    const schoolId =
      user.role === UserRole.SCHOOL_ADMIN
        ? (user.school_id ?? undefined)
        : typedQuery.school_id;

    return container().audit().list(typedQuery, { schoolId });
  },};
