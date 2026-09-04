import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService, Reflector } from '../../framework';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { callHandler, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import {
  deleteParentsById,
  deleteParentsByParentIdStudentsByStudentId,
  getParents,
  getParentsById,
  getParentsMeStudents,
  patchParentsById,
  patchParentsByParentIdStudentsByStudentId,
  postParents,
  postParentsByParentIdStudents,
  postStudentsByStudentIdGuardians,
} from '../../api/parents';
import { CreateParentDto } from './dto/create-parent.dto';
import { CreateParentStudentRelationshipDto } from './dto/create-parent-student-relationship.dto';
import { ListParentsQueryDto } from './dto/list-parents-query.dto';
import { UpdateParentDto } from './dto/update-parent.dto';
import { UpdateParentStudentRelationshipDto } from './dto/update-parent-student-relationship.dto';
import { ParentGuardiansService } from './parent-guardians.service';
import { ParentsService } from './parents.service';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const SECRET = 'unit-test-jwt-secret';

/** Authenticated SCHOOL_ADMIN of school A, as the guards would populate it. */
const ADMIN_A = { id: USER_ID, school_id: SCHOOL_A, role: UserRole.SCHOOL_ADMIN };

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

async function activateGuards(
  request: MockRequest,
  definition: EndpointDefinition<never, never>,
): Promise<void> {
  const context = makeGuardContext(definition, request as unknown as Record<string, unknown>);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
}

const createHandler = postParents as EndpointDefinition<never, never>;
const myStudentsHandler = getParentsMeStudents as EndpointDefinition<never, never>;
const studentGuardianCreateHandler =
  postStudentsByStudentIdGuardians as EndpointDefinition<never, never>;

describe('Parents endpoints authorization and tenant propagation', () => {
  it('restricts account management to SCHOOL_ADMIN', () => {
    assert.deepEqual(postParents.roles, [UserRole.SCHOOL_ADMIN]);
    assert.deepEqual(postStudentsByStudentIdGuardians.roles, [UserRole.SCHOOL_ADMIN]);
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
      activateGuards({ headers: {} }, studentGuardianCreateHandler),
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

    const restore = overrideContainer('parents', service);
    try {
      await callHandler(postParents, { user: ADMIN_A, body: new CreateParentDto() });
      await callHandler(getParents, { user: ADMIN_A, query: new ListParentsQueryDto() });
      await callHandler(getParentsById, { user: ADMIN_A, params: { id: USER_ID } });
      await callHandler(patchParentsById, {
        user: ADMIN_A,
        params: { id: USER_ID },
        body: new UpdateParentDto(),
      });
      await callHandler(deleteParentsById, { user: ADMIN_A, params: { id: USER_ID } });
    } finally {
      restore();
    }

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

    const restore = overrideContainer('parentGuardians', relationshipService);
    try {
      await callHandler(getParentsMeStudents, {
        user: { id: USER_ID, school_id: SCHOOL_B, role: UserRole.PARENT },
      });
    } finally {
      restore();
    }

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

    const restore = overrideContainer('parentGuardians', relationshipService);
    try {
      const createDto = new CreateParentStudentRelationshipDto();
      const updateDto = new UpdateParentStudentRelationshipDto();

      await callHandler(postParentsByParentIdStudents, {
        user: ADMIN_A,
        params: { parentId: USER_ID },
        body: createDto,
      });
      await callHandler(patchParentsByParentIdStudentsByStudentId, {
        user: ADMIN_A,
        params: { parentId: USER_ID, studentId: STUDENT_ID },
        body: updateDto,
      });
      await callHandler(deleteParentsByParentIdStudentsByStudentId, {
        user: ADMIN_A,
        params: { parentId: USER_ID, studentId: STUDENT_ID },
      });
    } finally {
      restore();
    }

    assert.deepEqual(seen, [
      { method: 'create', schoolId: SCHOOL_A, parentId: USER_ID },
      { method: 'update', schoolId: SCHOOL_A, parentId: USER_ID, studentId: STUDENT_ID },
      { method: 'remove', schoolId: SCHOOL_A, parentId: USER_ID, studentId: STUDENT_ID },
    ]);
  });
});
