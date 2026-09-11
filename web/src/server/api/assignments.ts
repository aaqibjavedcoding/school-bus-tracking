/**
 * Endpoint definitions for the `assignments` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 *
 * Phase 4 retirement (`docs/operating-model.md` §6.3, "read-only, then
 * unread"): `route_assignments` is no longer the roster of record —
 * `run_crew` is. These endpoints remain as a **readable mirror** of the
 * authoritative run crew, but every write permanently returns 410 Gone.
 * Every response (read or 410) carries the RFC 9745 `Deprecation` / RFC 8594
 * `Sunset` headers and a `Link` to the successor, applied centrally by the
 * route runtime from `deprecation`.
 */
import { HttpStatus, parseUuidParam } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import type { DeprecationDeclaration } from '../http/deprecation';
import { UserRole } from '@school-bus-tracking/shared-types';
import { ListRouteAssignmentsQueryDto } from '../modules/assignments/dto/list-route-assignments-query.dto';
import {
  ROUTE_ASSIGNMENTS_DEPRECATED_SUNSET,
  ROUTE_ASSIGNMENTS_RETIRED_WRITE_MESSAGE,
  ROUTE_ASSIGNMENTS_SUCCESSOR_PATH,
} from '../modules/assignments/assignments.constants';

/** Shared retirement declaration for the legacy roster surface. */
const deprecation: DeprecationDeclaration = {
  sunset: ROUTE_ASSIGNMENTS_DEPRECATED_SUNSET,
  successor: ROUTE_ASSIGNMENTS_SUCCESSOR_PATH,
  retiredWrite: true,
  retiredMessage: ROUTE_ASSIGNMENTS_RETIRED_WRITE_MESSAGE,
};

/** `POST /api/v1/route-assignments` — retired: rosters live on run crew. */
export const postRouteassignments: EndpointDefinition = {
  deprecation,
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.GONE,
  handler: async () => {
    // The route runtime answers this with 410 Gone before the handler runs;
    // the handler stays present so the App Router still exports the verb.
    throw new Error('unreachable');
  },
};

/** `GET /api/v1/route-assignments` — readable mirror, with deprecation headers. */
export const getRouteassignments: EndpointDefinition<unknown, ListRouteAssignmentsQueryDto> = {
  deprecation,
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  queryType: ListRouteAssignmentsQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().routeAssignments().findAll(schoolId, query);
  },
};

/** `GET /api/v1/route-assignments/:id` */
export const getRouteassignmentsById: EndpointDefinition = {
  deprecation,
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().routeAssignments().findOne(schoolId, id);
  },
};

/** `PATCH /api/v1/route-assignments/:id` — retired. */
export const patchRouteassignmentsById: EndpointDefinition = {
  deprecation,
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.GONE,
  handler: async () => {
    throw new Error('unreachable');
  },
};

/** `DELETE /api/v1/route-assignments/:id` — retired. */
export const deleteRouteassignmentsById: EndpointDefinition = {
  deprecation,
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.GONE,
  handler: async () => {
    throw new Error('unreachable');
  },
};

/** `POST /api/v1/assignments` — retired alias. */
export const postAssignments: EndpointDefinition = {
  deprecation,
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.GONE,
  handler: async () => {
    throw new Error('unreachable');
  },
};

/** `GET /api/v1/assignments` — readable mirror alias. */
export const getAssignments: EndpointDefinition<unknown, ListRouteAssignmentsQueryDto> = {
  deprecation,
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  queryType: ListRouteAssignmentsQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().routeAssignments().findAll(schoolId, query);
  },
};

/** `GET /api/v1/assignments/:id` */
export const getAssignmentsById: EndpointDefinition = {
  deprecation,
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().routeAssignments().findOne(schoolId, id);
  },
};

/** `PATCH /api/v1/assignments/:id` — retired alias. */
export const patchAssignmentsById: EndpointDefinition = {
  deprecation,
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.GONE,
  handler: async () => {
    throw new Error('unreachable');
  },
};

/** `DELETE /api/v1/assignments/:id` — retired alias. */
export const deleteAssignmentsById: EndpointDefinition = {
  deprecation,
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.GONE,
  handler: async () => {
    throw new Error('unreachable');
  },
};
