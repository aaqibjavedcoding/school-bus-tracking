/**
 * Endpoint definitions for the `parents` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, parseUuidParam, validateDto } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { ParentResponse, UserRole } from '@school-bus-tracking/shared-types';
import { CreateParentDto } from '../modules/parents/dto/create-parent.dto';
import { CreateParentStudentRelationshipDto } from '../modules/parents/dto/create-parent-student-relationship.dto';
import { ListParentsQueryDto } from '../modules/parents/dto/list-parents-query.dto';
import { UpdateParentDto } from '../modules/parents/dto/update-parent.dto';
import { UpdateParentStudentRelationshipDto } from '../modules/parents/dto/update-parent-student-relationship.dto';
import { ParentGuardiansService } from '../modules/parents/parent-guardians.service';
import { ParentsService } from '../modules/parents/parents.service';
import { CreateStudentGuardianDto } from '../modules/parents/dto/create-student-guardian.dto';

/** `POST /api/v1/parents` */
export const postParents: EndpointDefinition<CreateParentDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateParentDto,
  handler: async ({ user, body }) => {
    const schoolId = user.school_id as string;
    const dto = body;
    return container().parents().create(schoolId, dto);
  },};

/** `GET /api/v1/parents` */
export const getParents: EndpointDefinition<unknown, ListParentsQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListParentsQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().parents().findAll(schoolId, query);
  },};

/** `GET /api/v1/parents/me/students` */
export const getParentsMeStudents: EndpointDefinition = {
  roles: [UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user }) => {
    const schoolId = user.school_id as string;
    const parentId = user.id as string;
    return container().parentGuardians().listForCurrentParent(schoolId, parentId);
  },
};

/** `POST /api/v1/parents/:parentId/students` */
export const postParentsByParentIdStudents: EndpointDefinition<CreateParentStudentRelationshipDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateParentStudentRelationshipDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const parentId = parseUuidParam(params['parentId']);
    const dto = body;
    return container().parentGuardians().createForParent(schoolId, parentId, dto);
  },};

/** `GET /api/v1/parents/:parentId/students` */
export const getParentsByParentIdStudents: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const parentId = parseUuidParam(params['parentId']);
    return container().parentGuardians().listForParent(schoolId, parentId);
  },
};

/** `PATCH /api/v1/parents/:parentId/students/:studentId` */
export const patchParentsByParentIdStudentsByStudentId: EndpointDefinition<UpdateParentStudentRelationshipDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateParentStudentRelationshipDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const parentId = parseUuidParam(params['parentId']);
    const studentId = parseUuidParam(params['studentId']);
    const dto = body;
    return container().parentGuardians().updateForParent(schoolId, parentId, studentId, dto);
  },};

/** `DELETE /api/v1/parents/:parentId/students/:studentId` */
export const deleteParentsByParentIdStudentsByStudentId: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const parentId = parseUuidParam(params['parentId']);
    const studentId = parseUuidParam(params['studentId']);
    return container().parentGuardians().removeForParent(schoolId, parentId, studentId);
  },
};

/** `GET /api/v1/parents/:parentId` */
export const getParentsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['parentId']);
    return container().parents().findOne(schoolId, id);
  },
};

/** `PATCH /api/v1/parents/:parentId` */
export const patchParentsById: EndpointDefinition<UpdateParentDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateParentDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['parentId']);
    const dto = body;
    return container().parents().update(schoolId, id, dto);
  },};

/** `DELETE /api/v1/parents/:parentId` */
export const deleteParentsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['parentId']);
    return container().parents().remove(schoolId, id);
  },
};

/** `POST /api/v1/students/:studentId/guardians` */
export const postStudentsByStudentIdGuardians: EndpointDefinition<CreateStudentGuardianDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateStudentGuardianDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const studentId = parseUuidParam(params['studentId']);
    const dto = body;
    return container().parentGuardians().createForStudent(schoolId, studentId, dto);
  },};

/** `GET /api/v1/students/:studentId/guardians` */
export const getStudentsByStudentIdGuardians: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const studentId = parseUuidParam(params['studentId']);
    return container().parentGuardians().listForStudent(schoolId, studentId);
  },
};

/** `PATCH /api/v1/students/:studentId/guardians/:parentId` */
export const patchStudentsByStudentIdGuardiansByParentId: EndpointDefinition<UpdateParentStudentRelationshipDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateParentStudentRelationshipDto,
  handler: async ({ user, body, params }) => {
    const schoolId = user.school_id as string;
    const studentId = parseUuidParam(params['studentId']);
    const parentId = parseUuidParam(params['parentId']);
    const dto = body;
    return container().parentGuardians().updateForStudent(schoolId, studentId, parentId, dto);
  },};

/** `DELETE /api/v1/students/:studentId/guardians/:parentId` */
export const deleteStudentsByStudentIdGuardiansByParentId: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const studentId = parseUuidParam(params['studentId']);
    const parentId = parseUuidParam(params['parentId']);
    return container().parentGuardians().removeForStudent(schoolId, studentId, parentId);
  },
};
