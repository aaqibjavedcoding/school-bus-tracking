/**
 * Endpoint definitions for the `assignments` module.
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
import { RouteAssignmentsService } from '../modules/assignments/assignments.service';
import { CreateRouteAssignmentDto } from '../modules/assignments/dto/create-route-assignment.dto';
import { ListRouteAssignmentsQueryDto } from '../modules/assignments/dto/list-route-assignments-query.dto';
import { UpdateRouteAssignmentDto } from '../modules/assignments/dto/update-route-assignment.dto';

/** `POST /api/v1/route-assignments` */
export const postRouteassignments: EndpointDefinition<CreateRouteAssignmentDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateRouteAssignmentDto,
  handler: async ({ user, body }) => {
    const schoolId = user.school_id as string;
    const dto = body;
    return container().routeAssignments().create(schoolId, dto);
  },};

/** `GET /api/v1/route-assignments` */
export const getRouteassignments: EndpointDefinition<unknown, ListRouteAssignmentsQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  queryType: ListRouteAssignmentsQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().routeAssignments().findAll(schoolId, query);
  },};

/** `GET /api/v1/route-assignments/:id` */
export const getRouteassignmentsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().routeAssignments().findOne(schoolId, id);
  },
};

/** `PATCH /api/v1/route-assignments/:id` */
export const patchRouteassignmentsById: EndpointDefinition<UpdateRouteAssignmentDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateRouteAssignmentDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().routeAssignments().update(schoolId, id, dto);
  },};

/** `DELETE /api/v1/route-assignments/:id` */
export const deleteRouteassignmentsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().routeAssignments().remove(schoolId, id);
  },
};

/** `POST /api/v1/assignments` */
export const postAssignments: EndpointDefinition<CreateRouteAssignmentDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateRouteAssignmentDto,
  handler: async ({ user, body }) => {
    const schoolId = user.school_id as string;
    const dto = body;
    return container().routeAssignments().create(schoolId, dto);
  },};

/** `GET /api/v1/assignments` */
export const getAssignments: EndpointDefinition<unknown, ListRouteAssignmentsQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  queryType: ListRouteAssignmentsQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().routeAssignments().findAll(schoolId, query);
  },};

/** `GET /api/v1/assignments/:id` */
export const getAssignmentsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().routeAssignments().findOne(schoolId, id);
  },
};

/** `PATCH /api/v1/assignments/:id` */
export const patchAssignmentsById: EndpointDefinition<UpdateRouteAssignmentDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateRouteAssignmentDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().routeAssignments().update(schoolId, id, dto);
  },};

/** `DELETE /api/v1/assignments/:id` */
export const deleteAssignmentsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().routeAssignments().remove(schoolId, id);
  },
};
