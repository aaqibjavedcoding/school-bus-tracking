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
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const actor = tenantUser(user);
    const tripId = parseUuidParam(params['tripId']);
    const studentId = parseUuidParam(params['studentId']);
    return container().tripAttendance().board(actor, tripId, studentId);
  },
};

/** `POST /api/v1/trips/:tripId/students/:studentId/drop` */
export const postTripsByTripIdStudentsByStudentIdDrop: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR],
  rateLimit: 'attendance_write',
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const actor = tenantUser(user);
    const tripId = parseUuidParam(params['tripId']);
    const studentId = parseUuidParam(params['studentId']);
    return container().tripAttendance().drop(actor, tripId, studentId);
  },
};
