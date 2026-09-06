import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService, Reflector } from '../../framework';
import {
  DashboardStatsResponse,
  JwtAccessTokenPayload,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { callHandler, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { getDashboardStats } from '../../api/dashboard';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'unit-test-jwt-secret';

const jwtService = new JwtService({ secret: SECRET });
const jwtAuthGuard = new JwtAuthGuard(jwtService);
const rolesGuard = new RolesGuard(new Reflector());

async function signAccessToken(role: UserRole, schoolId = SCHOOL_A): Promise<string> {
  const payload: JwtAccessTokenPayload = {
    sub: USER_ID,
    school_id: role === UserRole.SUPER_ADMIN ? null : schoolId,
    role,
  };
  return jwtService.signAsync(payload);
}

interface MockRequest {
  headers: Record<string, unknown>;
  user?: AuthenticatedRequestUser;
}

function makeContext(request: MockRequest, definition: EndpointDefinition<never, never>) {
  return makeGuardContext(definition, request as unknown as Record<string, unknown>);
}

/** Authenticated SCHOOL_ADMIN actor, as the guards would have populated it. */
const ADMIN_USER = {
  id: USER_ID,
  school_id: SCHOOL_A,
  role: UserRole.SCHOOL_ADMIN,
} as AuthenticatedRequestUser;

const statsHandler = getDashboardStats as EndpointDefinition<never, never>;

describe('DashboardController (authorization)', () => {
  it('restricts stats to SCHOOL_ADMIN', () => {
    assert.deepEqual(statsHandler.roles, [UserRole.SCHOOL_ADMIN]);
  });

  it('rejects anonymous callers through the JWT guard', async () => {
    const request: MockRequest = { headers: {} };
    const context = makeContext(request, statsHandler);
    await assert.rejects(() => jwtAuthGuard.canActivate(context));
  });

  it('rejects non-admin roles through the roles guard', async () => {
    for (const role of [UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT]) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(role)}` },
      };
      const context = makeContext(request, statsHandler);
      await jwtAuthGuard.canActivate(context);
      assert.throws(() => rolesGuard.canActivate(context));
    }
  });
});

describe('DashboardController (stats)', () => {
  it('answers with the stats of the token-scoped school', async () => {
    const payload: DashboardStatsResponse = {
      students: 42,
      buses: 7,
      routes: 9,
      active_trips: 3,
      generated_at: '2026-09-06T07:00:00.000Z',
    };
    const seen: string[] = [];
    const restore = overrideContainer('dashboard', {
      stats: async (schoolId: string) => {
        seen.push(schoolId);
        return payload;
      },
    } as never);

    try {
      const result = (await callHandler(statsHandler, {
        user: ADMIN_USER,
      })) as DashboardStatsResponse;
      assert.deepEqual(seen, [SCHOOL_A]);
      assert.equal(result.students, 42);
      assert.equal(result.active_trips, 3);
    } finally {
      restore();
    }
  });

  it('never takes the school id from the query string', async () => {
    const seen: string[] = [];
    const restore = overrideContainer('dashboard', {
      stats: async (schoolId: string) => {
        seen.push(schoolId);
        return {
          students: 0,
          buses: 0,
          routes: 0,
          active_trips: 0,
          generated_at: '2026-09-06T07:00:00.000Z',
        };
      },
    } as never);

    try {
      await callHandler(statsHandler, {
        user: ADMIN_USER,
        // A tenant probe in the query string must be ignored entirely.
        query: { school_id: SCHOOL_B },
      });
      assert.deepEqual(seen, [SCHOOL_A]);
    } finally {
      restore();
    }
  });
});
