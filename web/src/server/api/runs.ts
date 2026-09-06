/**
 * Endpoint definitions for the `runs` module (`docs/operating-model.md`
 * §8.2) — one pass of a bus over a route, optionally inside a shift.
 *
 * `school_id` comes from the verified JWT claims and `is_default` is never a
 * request field (the validation pipe rejects unknown keys); the default run
 * of a route is provisioned server-side when the route is created. Nested
 * lists under `/routes/:id/runs` and `/buses/:busId/runs` live here too so the
 * run behaviour stays in one place.
 */
import { HttpStatus, parseUuidParam } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { UserRole } from '@school-bus-tracking/shared-types';
import { CreateRouteRunDto, CreateRunDto } from '../modules/runs/dto/create-run.dto';
import { ListRunsQueryDto } from '../modules/runs/dto/list-runs-query.dto';
import { UpdateRunDto } from '../modules/runs/dto/update-run.dto';

const RUN_READERS = [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR];

/** `POST /api/v1/runs` — reserves the `runs` plan quota. */
export const postRuns: EndpointDefinition<CreateRunDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateRunDto,
  handler: async ({ user, body }) => {
    const schoolId = user.school_id as string;
    return container().runs().create(schoolId, body);
  },
};

/** `GET /api/v1/runs?route_id=&shift_id=&bus_id=&is_active=&search=` */
export const getRuns: EndpointDefinition<unknown, ListRunsQueryDto> = {
  roles: RUN_READERS,
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListRunsQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().runs().findAll(schoolId, query);
  },
};

/** `GET /api/v1/runs/:id` */
export const getRunsById: EndpointDefinition = {
  roles: RUN_READERS,
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().runs().findOne(schoolId, id);
  },
};

/** `PATCH /api/v1/runs/:id` — `route_id` and `is_default` are immutable. */
export const patchRunsById: EndpointDefinition<UpdateRunDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateRunDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().runs().update(schoolId, id, body);
  },
};

/** `DELETE /api/v1/runs/:id` — 409 for the default run of a route. */
export const deleteRunsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().runs().remove(schoolId, id);
  },
};

/** `GET /api/v1/routes/:id/runs` */
export const getRoutesByIdRuns: EndpointDefinition<unknown, ListRunsQueryDto> = {
  roles: RUN_READERS,
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListRunsQueryDto,
  handler: async ({ user, query, params }) => {
    const schoolId = user.school_id as string;
    const routeId = parseUuidParam(params['id']);
    return container().runs().findAllForRoute(schoolId, routeId, query);
  },
};

/** `POST /api/v1/routes/:id/runs` — the route comes from the path. */
export const postRoutesByIdRuns: EndpointDefinition<CreateRouteRunDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateRouteRunDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const routeId = parseUuidParam(params['id']);
    return container().runs().createForRoute(schoolId, routeId, body);
  },
};

/** `GET /api/v1/buses/:busId/runs` — the tiering / bus-day view. */
export const getBusesByIdRuns: EndpointDefinition<unknown, ListRunsQueryDto> = {
  roles: RUN_READERS,
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListRunsQueryDto,
  handler: async ({ user, query, params }) => {
    const schoolId = user.school_id as string;
    const busId = parseUuidParam(params['busId']);
    return container().runs().findAllForBus(schoolId, busId, query);
  },
};
