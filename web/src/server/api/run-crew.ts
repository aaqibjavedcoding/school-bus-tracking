/**
 * Endpoint definitions for the `run-crew` module (`docs/operating-model.md`
 * §8.3) — the per-run DRIVER / CONDUCTOR roster.
 *
 * Rows are created under their run (`POST /runs/:id/crew`) and managed by
 * id (`/run-crew/:id`); `GET /users/:userId/run-crew` answers "what is this
 * person rostered on". `school_id` always comes from the JWT claims.
 */
import { ForbiddenException, HttpStatus, parseUuidParam } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { UserRole } from '@school-bus-tracking/shared-types';
import { CreateRunCrewDto } from '../modules/run-crew/dto/create-run-crew.dto';
import { ListRunCrewQueryDto } from '../modules/run-crew/dto/list-run-crew-query.dto';
import { UpdateRunCrewDto } from '../modules/run-crew/dto/update-run-crew.dto';

const CREW_READERS = [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR];

/** `GET /api/v1/runs/:id/crew` */
export const getRunsByIdCrew: EndpointDefinition<unknown, ListRunCrewQueryDto> = {
  roles: CREW_READERS,
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListRunCrewQueryDto,
  handler: async ({ user, query, params }) => {
    const schoolId = user.school_id as string;
    const runId = parseUuidParam(params['id']);
    return container().runCrew().findAllForRun(schoolId, runId, query);
  },
};

/** `POST /api/v1/runs/:id/crew` */
export const postRunsByIdCrew: EndpointDefinition<CreateRunCrewDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateRunCrewDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const runId = parseUuidParam(params['id']);
    return container().runCrew().create(schoolId, runId, body);
  },
};

/** `GET /api/v1/run-crew/:id` */
export const getRunCrewById: EndpointDefinition = {
  roles: CREW_READERS,
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().runCrew().findOne(schoolId, id);
  },
};

/** `PATCH /api/v1/run-crew/:id` — the run itself is immutable. */
export const patchRunCrewById: EndpointDefinition<UpdateRunCrewDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateRunCrewDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().runCrew().update(schoolId, id, body);
  },
};

/** `DELETE /api/v1/run-crew/:id` */
export const deleteRunCrewById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id']);
    return container().runCrew().remove(schoolId, id);
  },
};

/**
 * `GET /api/v1/users/:userId/run-crew` — a staff member's roster. Drivers and
 * conductors may only read their own; admins may read any staff member's.
 */
export const getUsersByIdRunCrew: EndpointDefinition<unknown, ListRunCrewQueryDto> = {
  roles: CREW_READERS,
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListRunCrewQueryDto,
  handler: async ({ user, query, params }) => {
    const schoolId = user.school_id as string;
    const userId = parseUuidParam(params['userId']);
    if (user.role !== UserRole.SCHOOL_ADMIN && user.id !== userId) {
      throw new ForbiddenException('Staff may only view their own roster');
    }
    return container().runCrew().findAllForUser(schoolId, userId, query);
  },
};
