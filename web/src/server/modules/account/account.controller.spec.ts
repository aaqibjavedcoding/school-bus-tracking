import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService, Reflector } from '../../framework';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { callHandler, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import { deleteAccountMePhoto, putAccountMePhoto } from '../../api/account';
import type { AccountProfilePhotoResponse } from '@school-bus-tracking/shared-types';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import { AccountService } from './account.service';
import { AuditService } from '../audit/audit.service';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DRIVER_A = '07070707-0707-4707-8707-070707070701';
const SECRET = 'unit-test-jwt-secret';

const jwtService = new JwtService({ secret: SECRET });
const jwtAuthGuard = new JwtAuthGuard(jwtService);
const rolesGuard = new RolesGuard(new Reflector());

const putHandler = putAccountMePhoto as EndpointDefinition<never, never>;
const deleteHandler = deleteAccountMePhoto as EndpointDefinition<never, never>;

async function signAccessToken(role: UserRole, schoolId = SCHOOL_A, userId = DRIVER_A) {
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

/** A multipart request carrying (or omitting) a `file` photo part. */
function multipartRequest(withFile = true): Request {
  const form = new FormData();
  if (withFile) {
    form.append('file', new File([new Uint8Array(64).fill(1)], 'me.jpg', { type: 'image/jpeg' }));
  }
  return new Request('http://localhost:3001/api/v1/account/me/photo', {
    method: 'PUT',
    body: form,
  });
}

const RESPONSE: AccountProfilePhotoResponse = {
  id: DRIVER_A,
  profile_photo_key: `${SCHOOL_A}/profile-photos/${DRIVER_A}/abcd1234-photo.jpg`,
  profile_photo_updated_at: '2026-09-27T12:00:00.000Z',
};

describe('Account photo endpoints authorization', () => {
  it('declares DRIVER + CONDUCTOR roles on both photo routes', () => {
    assert.deepEqual(putAccountMePhoto.roles, [UserRole.DRIVER, UserRole.CONDUCTOR]);
    assert.deepEqual(deleteAccountMePhoto.roles, [UserRole.DRIVER, UserRole.CONDUCTOR]);
  });

  it('allows crew and rejects every other role on both routes', async () => {
    for (const definition of [putHandler, deleteHandler]) {
      for (const role of [UserRole.DRIVER, UserRole.CONDUCTOR]) {
        const request: MockRequest = {
          headers: { authorization: `Bearer ${await signAccessToken(role)}` },
        };
        await activateGuards(request, definition);
        assert.equal(request.user?.school_id, SCHOOL_A);
      }

      for (const role of [UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.PARENT]) {
        const request: MockRequest = {
          headers: { authorization: `Bearer ${await signAccessToken(role)}` },
        };
        await assert.rejects(activateGuards(request, definition), (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403);
          return true;
        });
      }
    }
  });

  it('rejects unauthenticated requests with 401', async () => {
    for (const definition of [putHandler, deleteHandler]) {
      await assert.rejects(activateGuards({ headers: {} }, definition), (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 401);
        return true;
      });
    }
  });
});

describe('Account photo endpoints wiring', () => {
  it('PUT resolves the account from the JWT only and forwards the parsed photo', async () => {
    const seen: { schoolId?: string; userId?: string; upload?: unknown } = {};
    const account = {
      setProfilePhoto: async (schoolId: string, userId: string, upload: unknown) => {
        Object.assign(seen, { schoolId, userId, upload });
        return RESPONSE;
      },
      clearProfilePhoto: async () => RESPONSE,
    } as unknown as AccountService;
    const audit = { log: async () => undefined } as unknown as AuditService;

    const restoreAccount = overrideContainer('account', account);
    const restoreAudit = overrideContainer('audit', audit);
    try {
      const result = await callHandler(putAccountMePhoto, {
        user: { id: DRIVER_A, school_id: SCHOOL_B, role: UserRole.DRIVER },
        raw: multipartRequest(),
      });

      assert.equal(seen.schoolId, SCHOOL_B, 'the JWT tenant wins — there is no other source');
      assert.equal(seen.userId, DRIVER_A, 'the JWT subject is the only id the route knows');
      const upload = seen.upload as { originalname: string; mimetype: string; size: number; buffer: Buffer };
      assert.equal(upload.originalname, 'me.jpg');
      assert.equal(upload.mimetype, 'image/jpeg');
      assert.equal(upload.buffer.length, 64);
      assert.deepEqual(result, RESPONSE);
    } finally {
      restoreAudit();
      restoreAccount();
    }
  });

  it('PUT hands an absent file part through to the service, which owns the 400', async () => {
    const seen: { upload?: unknown } = { upload: 'unset' };
    const account = {
      setProfilePhoto: async (_schoolId: string, _userId: string, upload: unknown) => {
        seen.upload = upload;
        return RESPONSE;
      },
      clearProfilePhoto: async () => RESPONSE,
    } as unknown as AccountService;
    const audit = { log: async () => undefined } as unknown as AuditService;

    const restoreAccount = overrideContainer('account', account);
    const restoreAudit = overrideContainer('audit', audit);
    try {
      await callHandler(putAccountMePhoto, {
        user: { id: DRIVER_A, school_id: SCHOOL_A, role: UserRole.CONDUCTOR },
        raw: multipartRequest(false),
      });
      assert.equal(seen.upload, undefined);
    } finally {
      restoreAudit();
      restoreAccount();
    }
  });

  it('PUT writes exactly one audit row for the set', async () => {
    const audited: Array<Record<string, unknown>> = [];
    const account = {
      setProfilePhoto: async () => RESPONSE,
      clearProfilePhoto: async () => RESPONSE,
    } as unknown as AccountService;
    const audit = {
      log: async (input: Record<string, unknown>) => {
        audited.push(input);
      },
    } as unknown as AuditService;

    const restoreAccount = overrideContainer('account', account);
    const restoreAudit = overrideContainer('audit', audit);
    try {
      await callHandler(putAccountMePhoto, {
        user: { id: DRIVER_A, school_id: SCHOOL_A, role: UserRole.DRIVER },
        raw: multipartRequest(),
      });
    } finally {
      restoreAudit();
      restoreAccount();
    }

    assert.equal(audited.length, 1, 'one log line on set — no elaborate metadata');
    assert.deepEqual(audited[0], {
      school_id: SCHOOL_A,
      actor_user_id: DRIVER_A,
      action: AUDIT_ACTIONS.ACCOUNT_PHOTO_SET,
      entity_type: AUDIT_ENTITY_TYPES.USER,
      entity_id: DRIVER_A,
      request_id: null,
      ip_address: '127.0.0.1',
    });
  });

  it('DELETE clears for the JWT account and writes exactly one audit row', async () => {
    const seen: { schoolId?: string; userId?: string } = {};
    const audited: Array<Record<string, unknown>> = [];
    const account = {
      setProfilePhoto: async () => RESPONSE,
      clearProfilePhoto: async (schoolId: string, userId: string) => {
        Object.assign(seen, { schoolId, userId });
        return { id: userId, profile_photo_key: null, profile_photo_updated_at: null };
      },
    } as unknown as AccountService;
    const audit = {
      log: async (input: Record<string, unknown>) => {
        audited.push(input);
      },
    } as unknown as AuditService;

    const restoreAccount = overrideContainer('account', account);
    const restoreAudit = overrideContainer('audit', audit);
    try {
      const result = await callHandler(deleteAccountMePhoto, {
        user: { id: DRIVER_A, school_id: SCHOOL_B, role: UserRole.CONDUCTOR },
      });

      assert.deepEqual(seen, { schoolId: SCHOOL_B, userId: DRIVER_A });
      assert.deepEqual(result, { id: DRIVER_A, profile_photo_key: null, profile_photo_updated_at: null });
    } finally {
      restoreAudit();
      restoreAccount();
    }

    assert.equal(audited.length, 1, 'one log line on clear');
    assert.equal(audited[0].action, AUDIT_ACTIONS.ACCOUNT_PHOTO_CLEAR);
    assert.equal(audited[0].entity_type, AUDIT_ENTITY_TYPES.USER);
    assert.equal(audited[0].entity_id, DRIVER_A);
    assert.equal(audited[0].school_id, SCHOOL_B);
  });
});
