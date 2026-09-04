/**
 * Endpoint definitions for the `emergencies` module.
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
import { EmergencyActiveListResponse, EmergencyEventListResponse, EmergencyEventResponse, EmergencyStatus, UserRole } from '@school-bus-tracking/shared-types';
import { CancelEmergencyDto, ListEmergenciesQueryDto, SosDto, UpdateEmergencyStatusDto } from '../modules/emergencies/dto';
import { EmergenciesService } from '../modules/emergencies/emergencies.service';

/** `POST /api/v1/emergencies/sos` */
export const postEmergenciesSos: EndpointDefinition<SosDto> = {
  roles: [UserRole.DRIVER, UserRole.CONDUCTOR],
  rateLimit: 'sos_create',
  status: HttpStatus.CREATED,
  bodyType: SosDto,
  handler: async ({ user, body }) => {
    const dto = body;
    return container().emergencies().raiseSos(tenantUser(user), dto);
  },};

/** `GET /api/v1/emergencies/mine` */
export const getEmergenciesMine: EndpointDefinition<unknown, ListEmergenciesQueryDto> = {
  roles: [UserRole.DRIVER, UserRole.CONDUCTOR],
  status: HttpStatus.OK,
  queryType: ListEmergenciesQueryDto,
  handler: async ({ user, query }) => {
    return container().emergencies().listMine(tenantUser(user), query);
  },};

/** `PATCH /api/v1/emergencies/:id/cancel` */
export const patchEmergenciesByIdCancel: EndpointDefinition<CancelEmergencyDto> = {
  roles: [UserRole.DRIVER, UserRole.CONDUCTOR],
  status: HttpStatus.OK,
  bodyType: CancelEmergencyDto,
  handler: async ({ user, body, params }) => {
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().emergencies().updateStatus(
    tenantUser(user),
    id,
    { status: EmergencyStatus.CANCELLED, note: dto.note ?? null },
    { requireOwnership: true },
    );
  },};

/** `GET /api/v1/emergencies/active` */
export const getEmergenciesActive: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user }) => {
    const schoolId = user.school_id as string;
    return container().emergencies().listActive(schoolId);
  },
};

/** `GET /api/v1/emergencies` */
export const getEmergencies: EndpointDefinition<unknown, ListEmergenciesQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  queryType: ListEmergenciesQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().emergencies().listForSchool(schoolId, query);
  },};

/** `GET /api/v1/emergencies/:id` */
export const getEmergenciesById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().emergencies().findOne(schoolId, id);
  },
};

/** `PATCH /api/v1/emergencies/:id/status` */
export const patchEmergenciesByIdStatus: EndpointDefinition<UpdateEmergencyStatusDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateEmergencyStatusDto,
  handler: async ({ user, body, params }) => {
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().emergencies().updateStatus(tenantUser(user), id, dto);
  },};
