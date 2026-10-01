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
  PROFILE_PHOTO_ROLES,
  deleteAccountMePhoto,
  getAccountMePhoto,
  putAccountMePhoto,
} from '../../api/account';
import { PROFILE_PHOTO_NOT_FOUND_MESSAGE } from './account.constants';
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

const getHandler = getAccountMePhoto as EndpointDefinition<never, never>;
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

/**
 * The role guard on the three own-account photo routes.
 *
 * **Rewritten in this change** (it previously pinned `[DRIVER, CONDUCTOR]`,
 * which was the bug: a school admin uploading their own photo got a 403 and
 * the console had no account page at all). [DECISION 1] widened the owner
 * list to DRIVER + CONDUCTOR + SCHOOL_ADMIN, and the assertions below now
 * describe that: every allowed role passes the guard chain, every other role
 * — including the platform SUPER_ADMIN, which has no tenant for a storage
 * key to live under — is still refused.
 */
describe('Account photo endpoints authorization', () => {
  it('declares exactly the [DECISION 1] owner roles on all three photo routes', () => {
    for (const definition of [getAccountMePhoto, putAccountMePhoto, deleteAccountMePhoto]) {
      assert.deepEqual(definition.roles, [
        UserRole.DRIVER,
        UserRole.CONDUCTOR,
        UserRole.SCHOOL_ADMIN,
      ]);
    }
    assert.deepEqual(PROFILE_PHOTO_ROLES, [
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.SCHOOL_ADMIN,
    ]);
  });

  it('allows every owner role and rejects every other role on all three routes', async () => {
    for (const definition of [getHandler, putHandler, deleteHandler]) {
      for (const role of [UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.SCHOOL_ADMIN]) {
        const request: MockRequest = {
          headers: { authorization: `Bearer ${await signAccessToken(role)}` },
        };
        await activateGuards(request, definition);
        assert.equal(request.user?.school_id, SCHOOL_A, `${role} keeps its JWT tenant`);
      }

      for (const role of [UserRole.SUPER_ADMIN, UserRole.PARENT]) {
        const request: MockRequest = {
          headers: { authorization: `Bearer ${await signAccessToken(role)}` },
        };
        await assert.rejects(activateGuards(request, definition), (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403, `${role} must not own a profile photo`);
          return true;
        });
      }
    }
  });

  it('rejects unauthenticated requests with 401', async () => {
    for (const definition of [getHandler, putHandler, deleteHandler]) {
      await assert.rejects(activateGuards({ headers: {} }, definition), (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 401);
        return true;
      });
    }
  });
});

describe('GET /account/me/photo — the read-back convenience', () => {
  it('serves the caller\'s own bytes, resolved from the JWT with no key in the URL', async () => {
    const seen: { schoolId?: string; userId?: string } = {};
    const account = {
      readOwnProfilePhoto: async (schoolId: string, userId: string) => {
        Object.assign(seen, { schoolId, userId });
        return {
          key: `${SCHOOL_B}/profile-photos/${DRIVER_A}/abcd-photo.jpg`,
          bytes: Buffer.from([1, 2, 3, 4]),
          contentType: 'image/jpeg' as const,
          owner_id: DRIVER_A,
          owner_role: UserRole.SCHOOL_ADMIN,
          etag: '"1759300000000"',
          updated_at: '2026-10-01T06:00:00.000Z',
        };
      },
    } as unknown as AccountService;

    const restore = overrideContainer('account', account);
    try {
      const response = (await callHandler(getAccountMePhoto, {
        user: { id: DRIVER_A, school_id: SCHOOL_B, role: UserRole.SCHOOL_ADMIN },
      })) as Response;

      assert.deepEqual(seen, { schoolId: SCHOOL_B, userId: DRIVER_A });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/jpeg');
      assert.equal(response.headers.get('etag'), '"1759300000000"');
      assert.match(response.headers.get('cache-control') ?? '', /private/);
    } finally {
      restore();
    }
  });

  it('answers the same generic 404 when the account has no photo', async () => {
    const account = {
      readOwnProfilePhoto: async () => null,
    } as unknown as AccountService;

    const restore = overrideContainer('account', account);
    try {
      await assert.rejects(
        callHandler(getAccountMePhoto, {
          user: { id: DRIVER_A, school_id: SCHOOL_A, role: UserRole.DRIVER },
        }),
        (error: { getStatus?: () => number; message?: string }) => {
          assert.equal(error.getStatus?.(), 404);
          assert.equal(error.message, PROFILE_PHOTO_NOT_FOUND_MESSAGE);
          return true;
        },
      );
    } finally {
      restore();
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
