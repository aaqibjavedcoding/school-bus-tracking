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
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../modules/audit/audit.constants';
import { auditRequestContext } from '../modules/audit/audit-request';
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
  handler: async ({ user, body, request }) => {
    const schoolId = user.school_id as string;
    const dto = body;
    const parent = await container().parents().create(schoolId, dto);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.GUARDIAN_CREATE,
      entity_type: AUDIT_ENTITY_TYPES.GUARDIAN,
      entity_id: parent.id,
      ...auditRequestContext({ request }),
    });
    return parent;
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
  handler: async ({ user, body, params, request }) => {
    const schoolId = user.school_id as string;
    const parentId = parseUuidParam(params['parentId']);
    const dto = body;
    const link = await container().parentGuardians().createForParent(schoolId, parentId, dto);
    // Guardian links decide which parent sees which child: record both ends.
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.GUARDIAN_CREATE,
      entity_type: AUDIT_ENTITY_TYPES.GUARDIAN,
      entity_id: link.id,
      ...auditRequestContext({ request }),
      metadata: { parent_id: parentId, student_id: link.student_id },
    });
    return link;
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
  handler: async ({ user, body, params, request }) => {
    const schoolId = user.school_id as string;
    const parentId = parseUuidParam(params['parentId']);
    const studentId = parseUuidParam(params['studentId']);
    const dto = body;
    const link = await container().parentGuardians().updateForParent(schoolId, parentId, studentId, dto);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.GUARDIAN_UPDATE,
      entity_type: AUDIT_ENTITY_TYPES.GUARDIAN,
      entity_id: link.id,
      ...auditRequestContext({ request }),
      metadata: { parent_id: parentId, student_id: studentId },
    });
    return link;
  },};

/** `DELETE /api/v1/parents/:parentId/students/:studentId` */
export const deleteParentsByParentIdStudentsByStudentId: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const schoolId = user.school_id as string;
    const parentId = parseUuidParam(params['parentId']);
    const studentId = parseUuidParam(params['studentId']);
    const result = await container().parentGuardians().removeForParent(schoolId, parentId, studentId);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.GUARDIAN_DEACTIVATE,
      entity_type: AUDIT_ENTITY_TYPES.GUARDIAN,
      entity_id: result.id,
      ...auditRequestContext({ request }),
      metadata: { parent_id: parentId, student_id: studentId },
    });
    return result;
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
  handler: async ({ user, body, params, request }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['parentId']);
    const dto = body;
    const parent = await container().parents().update(schoolId, id, dto);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.GUARDIAN_UPDATE,
      entity_type: AUDIT_ENTITY_TYPES.GUARDIAN,
      entity_id: parent.id,
      ...auditRequestContext({ request }),
    });
    return parent;
  },};

/** `DELETE /api/v1/parents/:parentId` */
export const deleteParentsById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['parentId']);
    const result = await container().parents().remove(schoolId, id);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.GUARDIAN_DEACTIVATE,
      entity_type: AUDIT_ENTITY_TYPES.GUARDIAN,
      entity_id: result.id,
      ...auditRequestContext({ request }),
    });
    return result;
  },
};

/** `POST /api/v1/students/:studentId/guardians` */
export const postStudentsByStudentIdGuardians: EndpointDefinition<CreateStudentGuardianDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateStudentGuardianDto,
  handler: async ({ user, body, params, request }) => {
    const schoolId = user.school_id as string;
    const studentId = parseUuidParam(params['studentId']);
    const dto = body;
    const link = await container().parentGuardians().createForStudent(schoolId, studentId, dto);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.GUARDIAN_CREATE,
      entity_type: AUDIT_ENTITY_TYPES.GUARDIAN,
      entity_id: link.id,
      ...auditRequestContext({ request }),
      metadata: { parent_id: link.parent_id, student_id: studentId },
    });
    return link;
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
  handler: async ({ user, body, params, request }) => {
    const schoolId = user.school_id as string;
    const studentId = parseUuidParam(params['studentId']);
    const parentId = parseUuidParam(params['parentId']);
    const dto = body;
    const link = await container().parentGuardians().updateForStudent(schoolId, studentId, parentId, dto);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.GUARDIAN_UPDATE,
      entity_type: AUDIT_ENTITY_TYPES.GUARDIAN,
      entity_id: link.id,
      ...auditRequestContext({ request }),
      metadata: { parent_id: parentId, student_id: studentId },
    });
    return link;
  },};

/** `DELETE /api/v1/students/:studentId/guardians/:parentId` */
export const deleteStudentsByStudentIdGuardiansByParentId: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const schoolId = user.school_id as string;
    const studentId = parseUuidParam(params['studentId']);
    const parentId = parseUuidParam(params['parentId']);
    const result = await container().parentGuardians().removeForStudent(schoolId, studentId, parentId);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.GUARDIAN_DEACTIVATE,
      entity_type: AUDIT_ENTITY_TYPES.GUARDIAN,
      entity_id: result.id,
      ...auditRequestContext({ request }),
      metadata: { parent_id: parentId, student_id: studentId },
    });
    return result;
  },
};
