/**
 * Endpoint definitions for the `routes` module.
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
import { RoutesService } from '../modules/routes/routes.service';
import { CreateRouteDto } from '../modules/routes/dto/create-route.dto';
import { ListRoutesQueryDto } from '../modules/routes/dto/list-routes-query.dto';
import { UpdateRouteDto } from '../modules/routes/dto/update-route.dto';
import { ReorderRouteStopsDto } from '../modules/routes/dto/reorder-route-stops.dto';

/** `POST /api/v1/routes` */
export const postRoutes: EndpointDefinition<CreateRouteDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateRouteDto,
  handler: async ({ user, body }) => {
    const schoolId = user.school_id as string;
    const dto = body;
    return container().routes().create(schoolId, dto);
  },};

/** `GET /api/v1/routes` */
export const getRoutes: EndpointDefinition<unknown, ListRoutesQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListRoutesQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().routes().findAll(schoolId, query);
  },};

/** `GET /api/v1/routes/:id` */
export const getRoutesById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().routes().findOne(schoolId, id);
  },
};

/** `GET /api/v1/routes/:id/details` */
export const getRoutesByIdDetails: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().routes().getDetails(schoolId, id);
  },
};

/** `PATCH /api/v1/routes/:id` */
export const patchRoutesById: EndpointDefinition<UpdateRouteDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateRouteDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().routes().update(schoolId, id, dto);
  },};

/** `DELETE /api/v1/routes/:id` */
export const deleteRoutesById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().routes().remove(schoolId, id);
  },
};

/** `GET /api/v1/routes/:id/stops` */
export const getRoutesByIdStops: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().routes().findRouteStops(schoolId, id);
  },
};

/** `PUT /api/v1/routes/:id/stops` */
export const putRoutesByIdStops: EndpointDefinition<ReorderRouteStopsDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: ReorderRouteStopsDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().routes().reorderRouteStops(schoolId, id, dto);
  },};
