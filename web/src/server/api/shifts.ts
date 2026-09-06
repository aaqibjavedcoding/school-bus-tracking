/**
 * Endpoint definitions for the `shifts` module (`docs/operating-model.md`
 * §8.1) — the named time-of-day windows runs are attached to.
 *
 * `school_id` is always taken from the verified JWT claims; it is never a body
 * or query field. `route.ts` files under `src/app/api/v1/shifts` re-export
 * these as App Router verb handlers.
 */
import { HttpStatus, parseUuidParam } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { UserRole } from '@school-bus-tracking/shared-types';
import { CreateShiftDto } from '../modules/shifts/dto/create-shift.dto';
import { ListShiftsQueryDto } from '../modules/shifts/dto/list-shifts-query.dto';
import { UpdateShiftDto } from '../modules/shifts/dto/update-shift.dto';

/** `POST /api/v1/shifts` */
export const postShifts: EndpointDefinition<CreateShiftDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateShiftDto,
  handler: async ({ user, body }) => {
    const schoolId = user.school_id as string;
    return container().shifts().create(schoolId, body);
  },
};

/** `GET /api/v1/shifts` */
export const getShifts: EndpointDefinition<unknown, ListShiftsQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListShiftsQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().shifts().findAll(schoolId, query);
  },
};

/** `GET /api/v1/shifts/:id` */
export const getShiftsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().shifts().findOne(schoolId, id);
  },
};

/** `PATCH /api/v1/shifts/:id` */
export const patchShiftsById: EndpointDefinition<UpdateShiftDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateShiftDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().shifts().update(schoolId, id, body);
  },
};

/** `DELETE /api/v1/shifts/:id` — 409 while any live run references the shift. */
export const deleteShiftsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().shifts().remove(schoolId, id);
  },
};
