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
import { SetCrewPinDto } from '../modules/staff/dto/set-crew-pin.dto';
import { UpdateStaffDto } from '../modules/staff/dto/update-staff.dto';
import type { CrewPairingResponse, CrewPinSetResponse } from '@school-bus-tracking/shared-types';
import type { CrewLoginRoleArg } from '../modules/auth/crew-auth.service';
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


// ── Crew mobile login administration (Mobile-UX Phase 4) ─────────────────────
//
// PIN issue/reset and QR pairing-code generation for drivers and conductors.
// Administrator-driven only: there is deliberately **no** self-service PIN
// change, because the admin-issued PIN is what ties a phone to a person the
// school vouched for.
//
// All four endpoints are SCHOOL_ADMIN-gated, tenant-scoped by the caller's own
// `school_id` (never by anything in the body or query) and role-pinned per
// resource, exactly like the CRUD endpoints above. Super Admin assisted
// management ("Manage Data") does **not** cover them: the api-client's
// `MANAGED_TENANT_PATH_RULES` remaps `/drivers/:id` but not `/drivers/:id/pin`,
// so a platform operator in a managed session gets a 403 rather than a silently
// redirected write to a surface that was never reviewed for it. The admin
// console hides both actions in that mode.

/**
 * Audits a crew-credential administration action.
 *
 * The metadata records **that** a PIN was set or cleared and a code was minted —
 * never the PIN, never its hash, and never the pairing token. A PIN has 10,000
 * possible values, so an audit trail containing attempted or issued PINs would
 * be a dictionary of the ones real drivers use; a logged live pairing token
 * would be a replayable credential sitting in a table kept for 365 days.
 */
async function auditCrewCredentialChange(input: {
  schoolId: string;
  actorUserId: string;
  action: string;
  entityId: string;
  role: CrewLoginRoleArg;
  request: Parameters<typeof auditRequestContext>[0]['request'];
  metadata: Record<string, unknown>;
}): Promise<void> {
  await container()
    .audit()
    .log({
      school_id: input.schoolId,
      actor_user_id: input.actorUserId,
      action: input.action as (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
      entity_type: AUDIT_ENTITY_TYPES.USER,
      entity_id: input.entityId,
      ...auditRequestContext({ request: input.request }),
      metadata: { role: input.role, ...input.metadata },
    });
}

/** `PUT /api/v1/drivers/:driverId/pin` */
export const putDriversByIdPin: EndpointDefinition<SetCrewPinDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'password_reset',
  status: HttpStatus.OK,
  bodyType: SetCrewPinDto,
  handler: async ({ user, body, params, request }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['driverId']);
    const result: CrewPinSetResponse = await container()
      .crewAuth()
      .setPin(schoolId, UserRole.DRIVER, id, body.pin ?? null);
    // `pin_set` is the only thing recorded: whether a PIN now exists, not what
    // it is. That is enough to reconstruct who had one and when it changed.
    await auditCrewCredentialChange({
      schoolId,
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AUTH_CREW_PIN_SET,
      entityId: result.id,
      role: UserRole.DRIVER,
      request,
      metadata: { pin_set: result.pin_set },
    });
    return result;
  },
};

/** `PUT /api/v1/conductors/:id/pin` */
export const putConductorsByIdPin: EndpointDefinition<SetCrewPinDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'password_reset',
  status: HttpStatus.OK,
  bodyType: SetCrewPinDto,
  handler: async ({ user, body, params, request }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    const result: CrewPinSetResponse = await container()
      .crewAuth()
      .setPin(schoolId, UserRole.CONDUCTOR, id, body.pin ?? null);
    await auditCrewCredentialChange({
      schoolId,
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AUTH_CREW_PIN_SET,
      entityId: result.id,
      role: UserRole.CONDUCTOR,
      request,
      metadata: { pin_set: result.pin_set },
    });
    return result;
  },
};

/**
 * `POST /api/v1/drivers/:driverId/pairing-qr`
 *
 * Mints the short-lived code the admin console renders as a QR. The plaintext
 * token comes back exactly once and only its SHA-256 digest is stored, so the
 * console must render the QR while the response is on screen — there is no
 * "show it again", by design.
 */
export const postDriversByIdPairingQr: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'crew_pairing',
  status: HttpStatus.CREATED,
  handler: async ({ user, params, request }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['driverId']);
    const result: CrewPairingResponse = await container()
      .crewAuth()
      .createPairingCode(schoolId, UserRole.DRIVER, id);
    // Lifetime and supersession are recorded; the token is not.
    await auditCrewCredentialChange({
      schoolId,
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AUTH_CREW_PAIRING_CREATE,
      entityId: result.user.id,
      role: UserRole.DRIVER,
      request,
      metadata: { expires_in_ms: result.expires_in_ms },
    });
    return result;
  },
};

/** `POST /api/v1/conductors/:id/pairing-qr` */
export const postConductorsByIdPairingQr: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'crew_pairing',
  status: HttpStatus.CREATED,
  handler: async ({ user, params, request }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    const result: CrewPairingResponse = await container()
      .crewAuth()
      .createPairingCode(schoolId, UserRole.CONDUCTOR, id);
    await auditCrewCredentialChange({
      schoolId,
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AUTH_CREW_PAIRING_CREATE,
      entityId: result.user.id,
      role: UserRole.CONDUCTOR,
      request,
      metadata: { expires_in_ms: result.expires_in_ms },
    });
    return result;
  },
};
