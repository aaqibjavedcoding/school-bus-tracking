/**
 * Endpoint definitions for the `trip-attendance` module.
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
import { IDEMPOTENCY_ENDPOINTS } from '../common/idempotency/idempotency.constants';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../modules/audit/audit.constants';
import { auditRequestContext } from '../modules/audit/audit-request';
import { TripAttendanceService } from '../modules/trip-attendance/trip-attendance.service';
import { ListTripStudentsQueryDto } from '../modules/trip-attendance/dto/list-trip-students-query.dto';

/** `GET /api/v1/trips/:tripId/students` */
export const getTripsByTripIdStudents: EndpointDefinition<unknown, ListTripStudentsQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT],
  status: HttpStatus.OK,
  queryType: ListTripStudentsQueryDto,
  handler: async ({ user, query, params }) => {
    const actor = tenantUser(user);
    const tripId = parseUuidParam(params['tripId']);
    return container().tripAttendance().getManifest(actor, tripId, query);
  },};

/** `GET /api/v1/trips/:tripId/students/:studentId` */
export const getTripsByTripIdStudentsByStudentId: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const actor = tenantUser(user);
    const tripId = parseUuidParam(params['tripId']);
    const studentId = parseUuidParam(params['studentId']);
    return container().tripAttendance().getStudent(actor, tripId, studentId);
  },
};

/** `POST /api/v1/trips/:tripId/students/:studentId/board` */
export const postTripsByTripIdStudentsByStudentIdBoard: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR],
  rateLimit: 'attendance_write',
  idempotency: IDEMPOTENCY_ENDPOINTS.BOARD,
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const actor = tenantUser(user);
    const tripId = parseUuidParam(params['tripId']);
    const studentId = parseUuidParam(params['studentId']);
    const record = await container().tripAttendance().board(actor, tripId, studentId);
    // Audited after success: idempotent replays never reach the handler, so a
    // retried scan produces exactly one event. `AuditService.log` is
    // best-effort — a failing audit trail cannot fail the boarding itself.
    await container().audit().log({
      school_id: actor.school_id,
      actor_user_id: actor.id,
      action: AUDIT_ACTIONS.ATTENDANCE_BOARD,
      entity_type: AUDIT_ENTITY_TYPES.ATTENDANCE,
      entity_id: record.id,
      ...auditRequestContext({ request }),
      metadata: { trip_id: tripId, student_id: studentId },
    });
    return record;
  },
};

/** `POST /api/v1/trips/:tripId/students/:studentId/drop` */
export const postTripsByTripIdStudentsByStudentIdDrop: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR],
  rateLimit: 'attendance_write',
  idempotency: IDEMPOTENCY_ENDPOINTS.DROP,
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const actor = tenantUser(user);
    const tripId = parseUuidParam(params['tripId']);
    const studentId = parseUuidParam(params['studentId']);
    const record = await container().tripAttendance().drop(actor, tripId, studentId);
    // Same replay reasoning as the board handler above: one event per scan.
    await container().audit().log({
      school_id: actor.school_id,
      actor_user_id: actor.id,
      action: AUDIT_ACTIONS.ATTENDANCE_DROP,
      entity_type: AUDIT_ENTITY_TYPES.ATTENDANCE,
      entity_id: record.id,
      ...auditRequestContext({ request }),
      metadata: { trip_id: tripId, student_id: studentId },
    });
    return record;
  },
};
