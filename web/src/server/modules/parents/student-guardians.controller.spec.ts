import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { callHandler, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import {
  deleteStudentsByStudentIdGuardiansByParentId,
  getStudentsByStudentIdGuardians,
  patchStudentsByStudentIdGuardiansByParentId,
  postStudentsByStudentIdGuardians,
} from '../../api/parents';
import { ParentGuardiansService } from './parent-guardians.service';
import { CreateStudentGuardianDto } from './dto/create-student-guardian.dto';
import { UpdateParentStudentRelationshipDto } from './dto/update-parent-student-relationship.dto';

const SCHOOL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
/** Authenticated SCHOOL_ADMIN of the fixture school. */
const ADMIN = { id: ADMIN_ID, school_id: SCHOOL_ID, role: UserRole.SCHOOL_ADMIN };

describe('StudentGuardiansController', () => {
  it('restricts student-centred relationship management to SCHOOL_ADMIN', () => {
    assert.deepEqual(postStudentsByStudentIdGuardians.roles, [
      UserRole.SCHOOL_ADMIN,
    ]);
  });

  it('delegates resource ids and JWT school scope without accepting a tenant id', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const service = {
      createForStudent: async (
        schoolId: string,
        studentId: string,
        _dto: CreateStudentGuardianDto,
      ) => {
        seen.push({ method: 'create', schoolId, studentId });
        return { id: 'link-1' };
      },
      listForStudent: async (schoolId: string, studentId: string) => {
        seen.push({ method: 'list', schoolId, studentId });
        return { items: [] };
      },
      updateForStudent: async (
        schoolId: string,
        studentId: string,
        parentId: string,
        _dto: UpdateParentStudentRelationshipDto,
      ) => {
        seen.push({ method: 'update', schoolId, studentId, parentId });
        return { id: 'link-1' };
      },
      removeForStudent: async (schoolId: string, studentId: string, parentId: string) => {
        seen.push({ method: 'remove', schoolId, studentId, parentId });
        return { id: 'link-1', message: 'deleted' };
      },
    } as unknown as ParentGuardiansService;
    const restore = overrideContainer('parentGuardians', service);
    try {
      await callHandler(postStudentsByStudentIdGuardians, {
        user: ADMIN,
        params: { studentId: STUDENT_ID },
        body: new CreateStudentGuardianDto(),
      });
      await callHandler(getStudentsByStudentIdGuardians, {
        user: ADMIN,
        params: { studentId: STUDENT_ID },
      });
      await callHandler(patchStudentsByStudentIdGuardiansByParentId, {
        user: ADMIN,
        params: { studentId: STUDENT_ID, parentId: PARENT_ID },
        body: new UpdateParentStudentRelationshipDto(),
      });
      await callHandler(deleteStudentsByStudentIdGuardiansByParentId, {
        user: ADMIN,
        params: { studentId: STUDENT_ID, parentId: PARENT_ID },
      });
    } finally {
      restore();
    }

    assert.deepEqual(seen, [
      { method: 'create', schoolId: SCHOOL_ID, studentId: STUDENT_ID },
      { method: 'list', schoolId: SCHOOL_ID, studentId: STUDENT_ID },
      { method: 'update', schoolId: SCHOOL_ID, studentId: STUDENT_ID, parentId: PARENT_ID },
      { method: 'remove', schoolId: SCHOOL_ID, studentId: STUDENT_ID, parentId: PARENT_ID },
    ]);
  });
});
