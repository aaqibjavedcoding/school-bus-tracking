/**
 * Endpoint definitions for the `crew-stops` module — the crew's manual stop
 * marking, the fallback for everything the 100 m geofence cannot see.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, idempotency scope,
 * success status and the body DTO — plus the handler itself. `route.ts` files
 * under `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, parseUuidParam } from '../framework';
import { container } from '../container';
import { tenantUser } from '../http/route-runtime';
import type { EndpointDefinition } from '../http/route-runtime';
import { UserRole } from '@school-bus-tracking/shared-types';
import { IDEMPOTENCY_ENDPOINTS } from '../common/idempotency/idempotency.constants';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../modules/audit/audit.constants';
import { auditRequestContext } from '../modules/audit/audit-request';
import { SkipStopDto } from '../modules/crew-stops/dto';

/**
 * Crew only — no `SCHOOL_ADMIN`.
 *
 * Marking a stop is testimony about where a bus physically was; an admin at a
 * desk has not been there. Oversight and corrections are a separate concern
 * with a separate audit story, and widening this list later is a one-line
 * change, whereas narrowing it after clients depend on it is not.
 */
const CREW_ONLY = [UserRole.DRIVER, UserRole.CONDUCTOR];

/** `POST /api/v1/trips/:tripId/stops/:stopId/arrive` */
export const postTripsByTripIdStopsByStopIdArrive: EndpointDefinition = {
  roles: CREW_ONLY,
  // Same policy as board/drop: a crew write on a moving bus, tapped by hand.
  rateLimit: 'attendance_write',
  idempotency: IDEMPOTENCY_ENDPOINTS.STOP_ARRIVE,
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const actor = tenantUser(user);
    const tripId = parseUuidParam(params['tripId'], { label: 'trip' });
    const stopId = parseUuidParam(params['stopId'], { label: 'stop' });
    const record = await container().crewStopMarking().markArrived(actor, tripId, stopId);
    // Audited after success, exactly like board/drop: an idempotent replay
    // never reaches the handler, so a retried tap produces one event. The
    // audit itself is best-effort — a failing trail cannot fail the marking.
    await container()
      .audit()
      .log({
        school_id: actor.school_id,
        actor_user_id: actor.id,
        action: AUDIT_ACTIONS.STOP_CREW_ARRIVE,
        entity_type: AUDIT_ENTITY_TYPES.TRIP_STOP_ARRIVAL,
        entity_id: record.arrival.id,
        ...auditRequestContext({ request }),
        metadata: {
          trip_id: tripId,
          stop_id: stopId,
          // False means the stop was already recorded (geofence, or an
          // earlier tap) and this call changed nothing — worth keeping, it is
          // the difference between "the crew fixed a stuck run" and "the
          // crew's queue replayed".
          created: record.created,
        },
      });
    return record;
  },
};

/** `POST /api/v1/trips/:tripId/stops/:stopId/skip` */
export const postTripsByTripIdStopsByStopIdSkip: EndpointDefinition<SkipStopDto> = {
  roles: CREW_ONLY,
  rateLimit: 'attendance_write',
  idempotency: IDEMPOTENCY_ENDPOINTS.STOP_SKIP,
  status: HttpStatus.OK,
  bodyType: SkipStopDto,
  handler: async ({ user, params, body, request }) => {
    const actor = tenantUser(user);
    const tripId = parseUuidParam(params['tripId'], { label: 'trip' });
    const stopId = parseUuidParam(params['stopId'], { label: 'stop' });
    const record = await container()
      .crewStopMarking()
      .markSkipped(actor, tripId, stopId, body.reason);
    await container()
      .audit()
      .log({
        school_id: actor.school_id,
        actor_user_id: actor.id,
        action: AUDIT_ACTIONS.STOP_CREW_SKIP,
        entity_type: AUDIT_ENTITY_TYPES.TRIP_STOP_ARRIVAL,
        entity_id: record.arrival.id,
        ...auditRequestContext({ request }),
        metadata: {
          trip_id: tripId,
          stop_id: stopId,
          created: record.created,
          // The reason is the point of the record; it is operational text the
          // crew typed, not personal data, and the audit redaction list is
          // unaffected by it.
          reason: record.arrival.skip_reason,
        },
      });
    return record;
  },
};
