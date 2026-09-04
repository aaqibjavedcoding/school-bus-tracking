/**
 * Endpoint definitions for the `parent-portal` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, parseUuidParam, validateDto } from '../framework';
import { container } from '../container';
import { tenantUser } from '../http/route-runtime';
import type { EndpointDefinition } from '../http/route-runtime';
import { UserRole } from '@school-bus-tracking/shared-types';
import { ParentPortalService } from '../modules/parent-portal/parent-portal.service';

/** `GET /api/v1/parent/dashboard` */
export const getParentDashboard: EndpointDefinition = {
  roles: [UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user }) => {
    const actor = tenantUser(user);
    return container().parentPortal().getDashboard(actor);
  },
};

/** `GET /api/v1/parent/children` */
export const getParentChildren: EndpointDefinition = {
  roles: [UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user }) => {
    const actor = tenantUser(user);
    return container().parentPortal().listChildren(actor);
  },
};

/** `GET /api/v1/parent/children/:id` */
export const getParentChildrenById: EndpointDefinition = {
  roles: [UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const actor = tenantUser(user);
    const id = parseUuidParam(params['id']);
    return container().parentPortal().getChild(actor, id);
  },
};

/** `GET /api/v1/parent/children/:id/today` */
export const getParentChildrenByIdToday: EndpointDefinition = {
  roles: [UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const actor = tenantUser(user);
    const id = parseUuidParam(params['id']);
    return container().parentPortal().getChildToday(actor, id);
  },
};

/** `GET /api/v1/parent/children/:id/tracking` */
export const getParentChildrenByIdTracking: EndpointDefinition = {
  roles: [UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const actor = tenantUser(user);
    const id = parseUuidParam(params['id']);
    return container().parentPortal().getChildTracking(actor, id);
  },
};
