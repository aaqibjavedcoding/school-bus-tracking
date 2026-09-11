/**
 * Endpoint definitions for the `staff` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, parseUuidParam } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { CreateStaffDto } from '../modules/staff/dto/create-staff.dto';
import { ListStaffQueryDto } from '../modules/staff/dto/list-staff-query.dto';
import { UpdateStaffDto } from '../modules/staff/dto/update-staff.dto';
import { UserRole } from '@school-bus-tracking/shared-types';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../modules/audit/audit.constants';
import { auditRequestContext } from '../modules/audit/audit-request';
/** `POST /api/v1/conductors` */
export const postConductors: EndpointDefinition<CreateStaffDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateStaffDto,
  handler: async ({ user, body, request }) => {
    const schoolId = user.school_id as string;
    const dto = body;
    const member = await container().staff().create(schoolId, UserRole.CONDUCTOR, dto);
    // Crew accounts can move buses and children: creation, update and
    // removal are all audited against the user row they manage.
    await container()
      .audit()
      .log({
        school_id: schoolId,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.STAFF_CREATE,
        entity_type: AUDIT_ENTITY_TYPES.USER,
        entity_id: member.id,
        ...auditRequestContext({ request }),
        metadata: { role: UserRole.CONDUCTOR },
      });
    return member;
  },
};

/** `GET /api/v1/conductors` */
export const getConductors: EndpointDefinition<unknown, ListStaffQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListStaffQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().staff().findAll(schoolId, UserRole.CONDUCTOR, query);
  },
};

/** `GET /api/v1/conductors/:id` */
export const getConductorsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().staff().findOne(schoolId, UserRole.CONDUCTOR, id);
  },
};

/** `PATCH /api/v1/conductors/:id` */
export const patchConductorsById: EndpointDefinition<UpdateStaffDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateStaffDto,
  handler: async ({ user, body, params, request }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    const dto = body;
    const member = await container().staff().update(schoolId, UserRole.CONDUCTOR, id, dto);
    await container()
      .audit()
      .log({
        school_id: schoolId,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.STAFF_UPDATE,
        entity_type: AUDIT_ENTITY_TYPES.USER,
        entity_id: member.id,
        ...auditRequestContext({ request }),
        metadata: { role: UserRole.CONDUCTOR },
      });
    return member;
  },
};

/** `DELETE /api/v1/conductors/:id` */
export const deleteConductorsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    const result = await container().staff().remove(schoolId, UserRole.CONDUCTOR, id);
    await container()
      .audit()
      .log({
        school_id: schoolId,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.STAFF_DEACTIVATE,
        entity_type: AUDIT_ENTITY_TYPES.USER,
        entity_id: result.id,
        ...auditRequestContext({ request }),
        metadata: { role: UserRole.CONDUCTOR },
      });
    return result;
  },
};

/** `POST /api/v1/drivers` */
export const postDrivers: EndpointDefinition<CreateStaffDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateStaffDto,
  handler: async ({ user, body, request }) => {
    const schoolId = user.school_id as string;
    const dto = body;
    const member = await container().staff().create(schoolId, UserRole.DRIVER, dto);
    await container()
      .audit()
      .log({
        school_id: schoolId,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.STAFF_CREATE,
        entity_type: AUDIT_ENTITY_TYPES.USER,
        entity_id: member.id,
        ...auditRequestContext({ request }),
        metadata: { role: UserRole.DRIVER },
      });
    return member;
  },
};

/** `GET /api/v1/drivers` */
export const getDrivers: EndpointDefinition<unknown, ListStaffQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListStaffQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().staff().findAll(schoolId, UserRole.DRIVER, query);
  },
};

/** `GET /api/v1/drivers/:driverId` */
export const getDriversById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['driverId']);
    return container().staff().findOne(schoolId, UserRole.DRIVER, id);
  },
};

/** `PATCH /api/v1/drivers/:driverId` */
export const patchDriversById: EndpointDefinition<UpdateStaffDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateStaffDto,
  handler: async ({ user, body, params, request }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['driverId']);
    const dto = body;
    const member = await container().staff().update(schoolId, UserRole.DRIVER, id, dto);
    await container()
      .audit()
      .log({
        school_id: schoolId,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.STAFF_UPDATE,
        entity_type: AUDIT_ENTITY_TYPES.USER,
        entity_id: member.id,
        ...auditRequestContext({ request }),
        metadata: { role: UserRole.DRIVER },
      });
    return member;
  },
};

/** `DELETE /api/v1/drivers/:driverId` */
export const deleteDriversById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['driverId']);
    const result = await container().staff().remove(schoolId, UserRole.DRIVER, id);
    await container()
      .audit()
      .log({
        school_id: schoolId,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.STAFF_DEACTIVATE,
        entity_type: AUDIT_ENTITY_TYPES.USER,
        entity_id: result.id,
        ...auditRequestContext({ request }),
        metadata: { role: UserRole.DRIVER },
      });
    return result;
  },
};
