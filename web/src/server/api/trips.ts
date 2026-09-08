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
import { TripStatus, UserRole } from '@school-bus-tracking/shared-types';
import { IDEMPOTENCY_ENDPOINTS } from '../common/idempotency/idempotency.constants';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../modules/audit/audit.constants';
import { auditRequestContext } from '../modules/audit/audit-request';
import { TripsService } from '../modules/trips/trips.service';
import { CancelTripDto } from '../modules/trips/dto/cancel-trip.dto';
import { CreateTripDto } from '../modules/trips/dto/create-trip.dto';
import { ListTripsQueryDto } from '../modules/trips/dto/list-trips-query.dto';
import { UpdateTripDto } from '../modules/trips/dto/update-trip.dto';
import { UpdateTripStatusDto } from '../modules/trips/dto/update-trip-status.dto';
import type { TenantRequestUser } from '../common/guards/jwt-auth.guard';

/**
 * Best-effort pre-read of a trip's current status for transition audit
 * metadata (`{from, to}`). Any failure degrades to `null` — the mutation
 * itself performs the authoritative existence/permission checks, so this
 * read must never change the outcome.
 */
async function currentTripStatus(
  actor: TenantRequestUser,
  tripId: string,
): Promise<TripStatus | null> {
  try {
    const trip = await container().trips().findOneForActor(actor, tripId);
    return trip.status;
  } catch {
    return null;
  }
}

/** `POST /api/v1/trips` */
export const postTrips: EndpointDefinition<CreateTripDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateTripDto,
  handler: async ({ user, body, request }) => {
    const schoolId = user.school_id as string;
    const dto = body;
    const trip = await container().trips().create(schoolId, dto);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.TRIP_CREATE,
      entity_type: AUDIT_ENTITY_TYPES.TRIP,
      entity_id: trip.id,
      ...auditRequestContext({ request }),
      metadata: { status: trip.status },
    });
    return trip;
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

/** `GET /api/v1/trips/:tripId` */
export const getTripsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const actor = tenantUser(user);
    const id = parseUuidParam(params['tripId']);
    return container().trips().findOneForActor(actor, id);
  },
};

/** `PATCH /api/v1/trips/:tripId` */
export const patchTripsById: EndpointDefinition<UpdateTripDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateTripDto,
  handler: async ({ user, body, params, request }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['tripId']);
    const dto = body;
    const trip = await container().trips().update(schoolId, id, dto);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.TRIP_UPDATE,
      entity_type: AUDIT_ENTITY_TYPES.TRIP,
      entity_id: trip.id,
      ...auditRequestContext({ request }),
    });
    return trip;
  },};

/** `PATCH /api/v1/trips/:tripId/status` */
export const patchTripsByIdStatus: EndpointDefinition<UpdateTripStatusDto> = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR],
  idempotency: IDEMPOTENCY_ENDPOINTS.TRIP_STATUS,
  status: HttpStatus.OK,
  bodyType: UpdateTripStatusDto,
  handler: async ({ user, body, params, request }) => {
    const actor = tenantUser(user);
    const id = parseUuidParam(params['tripId']);
    const dto = body;
    const from = await currentTripStatus(actor, id);
    const trip = await container().trips().updateStatusForActor(actor, id, dto);
    // Trip start/complete (and every other transition) with both ends of the
    // move. Retried presses replay through the idempotency scope and never
    // reach the handler, so one transition means one event.
    await container().audit().log({
      school_id: actor.school_id,
      actor_user_id: actor.id,
      action: AUDIT_ACTIONS.TRIP_STATUS_CHANGE,
      entity_type: AUDIT_ENTITY_TYPES.TRIP,
      entity_id: trip.id,
      ...auditRequestContext({ request }),
      metadata: { from, to: trip.status },
    });
    return trip;
  },};

/** `POST /api/v1/trips/:tripId/cancel` */
export const postTripsByIdCancel: EndpointDefinition<CancelTripDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  idempotency: IDEMPOTENCY_ENDPOINTS.TRIP_CANCEL,
  status: HttpStatus.OK,
  bodyType: CancelTripDto,
  handler: async ({ user, body, params, request }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['tripId']);
    const dto = body;
    const from = await currentTripStatus(tenantUser(user), id);
    const trip = await container().trips().cancel(schoolId, id, dto);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.TRIP_CANCEL,
      entity_type: AUDIT_ENTITY_TYPES.TRIP,
      entity_id: trip.id,
      ...auditRequestContext({ request }),
      metadata: { from, to: trip.status },
    });
    return trip;
  },};

/** `DELETE /api/v1/trips/:tripId` */
export const deleteTripsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['tripId']);
    const result = await container().trips().remove(schoolId, id);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.TRIP_DELETE,
      entity_type: AUDIT_ENTITY_TYPES.TRIP,
      entity_id: result.id,
      ...auditRequestContext({ request }),
    });
    return result;
  },
};
