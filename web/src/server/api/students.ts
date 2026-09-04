/**
 * Endpoint definitions for the `students` module.
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
import { StudentsService } from '../modules/students/students.service';
import { CreateStudentDto } from '../modules/students/dto/create-student.dto';
import { ListStudentsQueryDto } from '../modules/students/dto/list-students-query.dto';
import { UpdateStudentDto } from '../modules/students/dto/update-student.dto';

/** `POST /api/v1/students` */
export const postStudents: EndpointDefinition<CreateStudentDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateStudentDto,
  handler: async ({ user, body }) => {
    const schoolId = user.school_id as string;
    const dto = body;
    return container().students().create(schoolId, dto);
  },};

/** `GET /api/v1/students` */
export const getStudents: EndpointDefinition<unknown, ListStudentsQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListStudentsQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().students().findAll(schoolId, query);
  },};

/** `GET /api/v1/students/:studentId` */
export const getStudentsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const actor = tenantUser(user);
    const id = parseUuidParam(params['studentId']);
    return container().students().findOneForActor(actor, id);
  },
};

/** `PATCH /api/v1/students/:studentId` */
export const patchStudentsById: EndpointDefinition<UpdateStudentDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateStudentDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['studentId']);
    const dto = body;
    return container().students().update(schoolId, id, dto);
  },};

/** `DELETE /api/v1/students/:studentId` */
export const deleteStudentsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['studentId']);
    return container().students().remove(schoolId, id);
  },
};
