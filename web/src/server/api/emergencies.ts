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
import { IDEMPOTENCY_ENDPOINTS } from '../common/idempotency/idempotency.constants';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, type AuditAction } from '../modules/audit/audit.constants';
import { auditRequestContext } from '../modules/audit/audit-request';
import { CancelEmergencyDto, ListEmergenciesQueryDto, SosDto, UpdateEmergencyStatusDto } from '../modules/emergencies/dto';
import { EmergenciesService } from '../modules/emergencies/emergencies.service';

/** Maps a resulting emergency status to its audit action. */
function auditActionForEmergencyStatus(status: EmergencyStatus): AuditAction {
  switch (status) {
    case EmergencyStatus.ACKNOWLEDGED:
      return AUDIT_ACTIONS.EMERGENCY_ACKNOWLEDGE;
    case EmergencyStatus.RESOLVED:
      return AUDIT_ACTIONS.EMERGENCY_RESOLVE;
    case EmergencyStatus.CANCELLED:
      return AUDIT_ACTIONS.EMERGENCY_CANCEL;
    case EmergencyStatus.OPEN:
      return AUDIT_ACTIONS.EMERGENCY_REOPEN;
  }
}

/** `POST /api/v1/emergencies/sos` */
export const postEmergenciesSos: EndpointDefinition<SosDto> = {
  roles: [UserRole.DRIVER, UserRole.CONDUCTOR],
  rateLimit: 'sos_create',
  idempotency: IDEMPOTENCY_ENDPOINTS.SOS,
  status: HttpStatus.CREATED,
  bodyType: SosDto,
  handler: async ({ user, body, request }) => {
    const dto = body;
    const actor = tenantUser(user);
    const event = await container().emergencies().raiseSos(actor, dto);
    // Audited after success: SOS retries replay through the idempotency
    // scope and never reach the handler, so one alarm means one event.
    await container().audit().log({
      school_id: actor.school_id,
      actor_user_id: actor.id,
      action: AUDIT_ACTIONS.EMERGENCY_SOS,
      entity_type: AUDIT_ENTITY_TYPES.EMERGENCY,
      entity_id: event.id,
      ...auditRequestContext({ request }),
      metadata: { type: event.type, trip_id: event.trip_id },
    });
    return event;
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
  idempotency: IDEMPOTENCY_ENDPOINTS.EMERGENCY_STATUS,
  status: HttpStatus.OK,
  bodyType: CancelEmergencyDto,
  handler: async ({ user, body, params, request }) => {
    const id = parseUuidParam(params['id']);
    const dto = body;
    const actor = tenantUser(user);
    const event = await container().emergencies().updateStatus(
    actor,
    id,
    { status: EmergencyStatus.CANCELLED, note: dto.note ?? null },
    { requireOwnership: true },
    );
    await container().audit().log({
      school_id: actor.school_id,
      actor_user_id: actor.id,
      action: AUDIT_ACTIONS.EMERGENCY_CANCEL,
      entity_type: AUDIT_ENTITY_TYPES.EMERGENCY,
      entity_id: event.id,
      ...auditRequestContext({ request }),
      metadata: { trip_id: event.trip_id },
    });
    return event;
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
  idempotency: IDEMPOTENCY_ENDPOINTS.EMERGENCY_STATUS,
  status: HttpStatus.OK,
  bodyType: UpdateEmergencyStatusDto,
  handler: async ({ user, body, params, request }) => {
    const id = parseUuidParam(params['id']);
    const dto = body;
    const actor = tenantUser(user);
    const event = await container().emergencies().updateStatus(actor, id, dto);
    await container().audit().log({
      school_id: actor.school_id,
      actor_user_id: actor.id,
      action: auditActionForEmergencyStatus(event.status),
      entity_type: AUDIT_ENTITY_TYPES.EMERGENCY,
      entity_id: event.id,
      ...auditRequestContext({ request }),
      metadata: { to: event.status, trip_id: event.trip_id },
    });
    return event;
  },};
