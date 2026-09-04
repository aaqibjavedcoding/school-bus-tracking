import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { ParentGuardiansService } from './parent-guardians.service';
import { StudentGuardiansController } from './student-guardians.controller';
import { CreateStudentGuardianDto } from './dto/create-student-guardian.dto';
import { UpdateParentStudentRelationshipDto } from './dto/update-parent-student-relationship.dto';

const SCHOOL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_ID = '22222222-2222-4222-8222-222222222222';

describe('StudentGuardiansController', () => {
  it('restricts student-centred relationship management to SCHOOL_ADMIN', () => {
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, StudentGuardiansController), [
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
    const controller = new StudentGuardiansController(service);

    await controller.create(SCHOOL_ID, STUDENT_ID, new CreateStudentGuardianDto());
    await controller.findAll(SCHOOL_ID, STUDENT_ID);
    await controller.update(
      SCHOOL_ID,
      STUDENT_ID,
      PARENT_ID,
      new UpdateParentStudentRelationshipDto(),
    );
    await controller.remove(SCHOOL_ID, STUDENT_ID, PARENT_ID);

    assert.deepEqual(seen, [
      { method: 'create', schoolId: SCHOOL_ID, studentId: STUDENT_ID },
      { method: 'list', schoolId: SCHOOL_ID, studentId: STUDENT_ID },
      { method: 'update', schoolId: SCHOOL_ID, studentId: STUDENT_ID, parentId: PARENT_ID },
      { method: 'remove', schoolId: SCHOOL_ID, studentId: STUDENT_ID, parentId: PARENT_ID },
    ]);
  });
});
