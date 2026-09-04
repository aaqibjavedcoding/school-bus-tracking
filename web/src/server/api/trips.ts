/**
 * Endpoint definitions for the `trips` module.
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
import { TripsService } from '../modules/trips/trips.service';
import { CancelTripDto } from '../modules/trips/dto/cancel-trip.dto';
import { CreateTripDto } from '../modules/trips/dto/create-trip.dto';
import { ListTripsQueryDto } from '../modules/trips/dto/list-trips-query.dto';
import { UpdateTripDto } from '../modules/trips/dto/update-trip.dto';
import { UpdateTripStatusDto } from '../modules/trips/dto/update-trip-status.dto';

/** `POST /api/v1/trips` */
export const postTrips: EndpointDefinition<CreateTripDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateTripDto,
  handler: async ({ user, body }) => {
    const schoolId = user.school_id as string;
    const dto = body;
    return container().trips().create(schoolId, dto);
  },};

/** `GET /api/v1/trips` */
export const getTrips: EndpointDefinition<unknown, ListTripsQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT],
  status: HttpStatus.OK,
  queryType: ListTripsQueryDto,
  handler: async ({ user, query }) => {
    const actor = tenantUser(user);
    return container().trips().findAllForActor(actor, query);
  },};

/** `GET /api/v1/trips/:id` */
export const getTripsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const actor = tenantUser(user);
    const id = parseUuidParam(params['id']);
    return container().trips().findOneForActor(actor, id);
  },
};

/** `PATCH /api/v1/trips/:id` */
export const patchTripsById: EndpointDefinition<UpdateTripDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateTripDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().trips().update(schoolId, id, dto);
  },};

/** `PATCH /api/v1/trips/:id/status` */
export const patchTripsByIdStatus: EndpointDefinition<UpdateTripStatusDto> = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR],
  status: HttpStatus.OK,
  bodyType: UpdateTripStatusDto,
  handler: async ({ user, body, params }) => {
    const actor = tenantUser(user);
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().trips().updateStatusForActor(actor, id, dto);
  },};

/** `POST /api/v1/trips/:id/cancel` */
export const postTripsByIdCancel: EndpointDefinition<CancelTripDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: CancelTripDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().trips().cancel(schoolId, id, dto);
  },};

/** `DELETE /api/v1/trips/:id` */
export const deleteTripsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().trips().remove(schoolId, id);
  },
};
