/**
 * Endpoint definitions for the `stops` module.
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
import { StopsService } from '../modules/stops/stops.service';
import { CreateStopDto } from '../modules/stops/dto/create-stop.dto';
import { ListStopsQueryDto } from '../modules/stops/dto/list-stops-query.dto';
import { UpdateStopDto } from '../modules/stops/dto/update-stop.dto';

/** `POST /api/v1/stops` */
export const postStops: EndpointDefinition<CreateStopDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateStopDto,
  handler: async ({ user, body }) => {
    const schoolId = user.school_id as string;
    const dto = body;
    return container().stops().create(schoolId, dto);
  },};

/** `GET /api/v1/stops` */
export const getStops: EndpointDefinition<unknown, ListStopsQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListStopsQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().stops().findAll(schoolId, query);
  },};

/** `GET /api/v1/stops/:id` */
export const getStopsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().stops().findOne(schoolId, id);
  },
};

/** `PATCH /api/v1/stops/:id` */
export const patchStopsById: EndpointDefinition<UpdateStopDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateStopDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().stops().update(schoolId, id, dto);
  },};

/** `DELETE /api/v1/stops/:id` */
export const deleteStopsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().stops().remove(schoolId, id);
  },
};
