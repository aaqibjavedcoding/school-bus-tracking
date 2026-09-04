import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '../../framework';
import { JwtService, Reflector } from '../../framework';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CreateParentDto } from './dto/create-parent.dto';
import { CreateParentStudentRelationshipDto } from './dto/create-parent-student-relationship.dto';
import { ListParentsQueryDto } from './dto/list-parents-query.dto';
import { UpdateParentDto } from './dto/update-parent.dto';
import { UpdateParentStudentRelationshipDto } from './dto/update-parent-student-relationship.dto';
import { ParentGuardiansService } from './parent-guardians.service';
import { ParentsController } from './parents.controller';
import { ParentsService } from './parents.service';
import { StudentGuardiansController } from './student-guardians.controller';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const SECRET = 'unit-test-jwt-secret';

const jwtService = new JwtService({ secret: SECRET });
const jwtAuthGuard = new JwtAuthGuard(jwtService);
const rolesGuard = new RolesGuard(new Reflector());

async function signAccessToken(role: UserRole, schoolId = SCHOOL_A, userId = USER_ID) {
  const payload: JwtAccessTokenPayload = {
    sub: userId,
    school_id: role === UserRole.SUPER_ADMIN ? null : schoolId,
    role,
  };
  return jwtService.signAsync(payload);
}

interface MockRequest {
  headers: Record<string, unknown>;
  user?: AuthenticatedRequestUser;
}

type ControllerClass = typeof ParentsController | typeof StudentGuardiansController;

function makeContext(
  request: MockRequest,
  handler: (...args: never[]) => unknown,
  target: ControllerClass = ParentsController,
) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => target,
  } as unknown as ExecutionContext;
}

async function activateGuards(
  request: MockRequest,
  handler: (...args: never[]) => unknown,
  target: ControllerClass = ParentsController,
): Promise<void> {
  const context = makeContext(request, handler, target);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
}

const createHandler = ParentsController.prototype.create as unknown as (
  ...args: never[]
) => unknown;
const myStudentsHandler = ParentsController.prototype.findMyStudents as unknown as (
  ...args: never[]
) => unknown;
const studentGuardianCreateHandler = StudentGuardiansController.prototype.create as unknown as (
  ...args: never[]
) => unknown;

describe('ParentsController authorization and tenant propagation', () => {
  it('restricts account management to SCHOOL_ADMIN', () => {
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, ParentsController), [UserRole.SCHOOL_ADMIN]);
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, StudentGuardiansController), [
      UserRole.SCHOOL_ADMIN,
    ]);
  });

  it('allows a school admin and rejects every other role for account management', async () => {
    const adminRequest: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.SCHOOL_ADMIN)}` },
    };
    await activateGuards(adminRequest, createHandler);
    assert.equal(adminRequest.user?.school_id, SCHOOL_A);

    for (const role of [
      UserRole.SUPER_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ]) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(role)}` },
      };
      await assert.rejects(
        activateGuards(request, createHandler),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403);
          return true;
        },
      );
    }
  });

  it('allows a PARENT only on the self-service relationship route', async () => {
    const request: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.PARENT)}` },
    };
    await activateGuards(request, myStudentsHandler);
    assert.equal(request.user?.id, USER_ID);

    await assert.rejects(
      activateGuards(request, createHandler),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 403);
        return true;
      },
    );
  });

  it('rejects unauthenticated account and relationship requests with 401', async () => {
    await assert.rejects(
      activateGuards({ headers: {} }, createHandler),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 401);
        return true;
      },
    );
    await assert.rejects(
      activateGuards({ headers: {} }, studentGuardianCreateHandler, StudentGuardiansController),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 401);
        return true;
      },
    );
  });

  it('passes only the JWT school_id to parent account service methods', async () => {
    const calls: Array<{ method: string; schoolId: string; id?: string }> = [];
    const service = {
      create: async (schoolId: string) => {
        calls.push({ method: 'create', schoolId });
        return { id: 'parent-1' };
      },
      findAll: async (schoolId: string, _query: ListParentsQueryDto) => {
        calls.push({ method: 'findAll', schoolId });
        return { items: [], meta: {} };
      },
      findOne: async (schoolId: string, id: string) => {
        calls.push({ method: 'findOne', schoolId, id });
        return { id };
      },
      update: async (schoolId: string, id: string, _dto: UpdateParentDto) => {
        calls.push({ method: 'update', schoolId, id });
        return { id };
      },
      remove: async (schoolId: string, id: string) => {
        calls.push({ method: 'remove', schoolId, id });
        return { id, message: 'deleted' };
      },
    } as unknown as ParentsService;
    const relationshipService = {} as ParentGuardiansService;
    const controller = new ParentsController(service, relationshipService);

    await controller.create(SCHOOL_A, new CreateParentDto());
    await controller.findAll(SCHOOL_A, new ListParentsQueryDto());
    await controller.findOne(SCHOOL_A, USER_ID);
    await controller.update(SCHOOL_A, USER_ID, new UpdateParentDto());
    await controller.remove(SCHOOL_A, USER_ID);

    assert.deepEqual(
      calls.map((call) => call.method),
      ['create', 'findAll', 'findOne', 'update', 'remove'],
    );
    assert.ok(calls.every((call) => call.schoolId === SCHOOL_A));
  });

  it('passes JWT subject and tenant to parent self-service, never a path tenant', async () => {
    let seen: { schoolId?: string; parentId?: string } = {};
    const relationshipService = {
      listForCurrentParent: async (schoolId: string, parentId: string) => {
        seen = { schoolId, parentId };
        return { items: [] };
      },
    } as unknown as ParentGuardiansService;
    const controller = new ParentsController({} as ParentsService, relationshipService);

    await controller.findMyStudents(SCHOOL_B, USER_ID);
    assert.deepEqual(seen, { schoolId: SCHOOL_B, parentId: USER_ID });
  });

  it('delegates relationship routes with authenticated school and resource ids', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const relationshipService = {
      createForParent: async (
        schoolId: string,
        parentId: string,
        _dto: CreateParentStudentRelationshipDto,
      ) => {
        seen.push({ method: 'create', schoolId, parentId });
        return { id: 'link-1' };
      },
      updateForParent: async (
        schoolId: string,
        parentId: string,
        studentId: string,
        _dto: UpdateParentStudentRelationshipDto,
      ) => {
        seen.push({ method: 'update', schoolId, parentId, studentId });
        return { id: 'link-1' };
      },
      removeForParent: async (schoolId: string, parentId: string, studentId: string) => {
        seen.push({ method: 'remove', schoolId, parentId, studentId });
        return { id: 'link-1', message: 'deleted' };
      },
    } as unknown as ParentGuardiansService;
    const controller = new ParentsController({} as ParentsService, relationshipService);
    const createDto = new CreateParentStudentRelationshipDto();
    const updateDto = new UpdateParentStudentRelationshipDto();

    await controller.linkStudent(SCHOOL_A, USER_ID, createDto);
    await controller.updateStudentLink(SCHOOL_A, USER_ID, STUDENT_ID, updateDto);
    await controller.unlinkStudent(SCHOOL_A, USER_ID, STUDENT_ID);

    assert.deepEqual(seen, [
      { method: 'create', schoolId: SCHOOL_A, parentId: USER_ID },
      { method: 'update', schoolId: SCHOOL_A, parentId: USER_ID, studentId: STUDENT_ID },
      { method: 'remove', schoolId: SCHOOL_A, parentId: USER_ID, studentId: STUDENT_ID },
    ]);
  });
});
