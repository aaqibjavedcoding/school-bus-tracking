/**
 * Endpoint definitions for the `buses` module.
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
import { BusesService } from '../modules/buses/buses.service';
import { CreateBusDto } from '../modules/buses/dto/create-bus.dto';
import { ListBusesQueryDto } from '../modules/buses/dto/list-buses-query.dto';
import { UpdateBusDto } from '../modules/buses/dto/update-bus.dto';

/** `POST /api/v1/buses` */
export const postBuses: EndpointDefinition<CreateBusDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateBusDto,
  handler: async ({ user, body }) => {
    const schoolId = user.school_id as string;
    const dto = body;
    return container().buses().create(schoolId, dto);
  },};

/** `GET /api/v1/buses` */
export const getBuses: EndpointDefinition<unknown, ListBusesQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListBusesQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().buses().findAll(schoolId, query);
  },};

/** `GET /api/v1/buses/:busId` */
export const getBusesById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['busId']);
    return container().buses().findOne(schoolId, id);
  },
};

/** `PATCH /api/v1/buses/:busId` */
export const patchBusesById: EndpointDefinition<UpdateBusDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateBusDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['busId']);
    const dto = body;
    return container().buses().update(schoolId, id, dto);
  },};

/** `DELETE /api/v1/buses/:busId` */
export const deleteBusesById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['busId']);
    return container().buses().remove(schoolId, id);
  },
};
