import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService, Reflector } from '../../framework';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { callHandler, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import {
  postSchools,
} from '../../api/schools';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { SchoolsService } from './schools.service';
import { OnboardSchoolDto } from './dto/onboard-school.dto';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'unit-test-jwt-secret';

const jwtService = new JwtService({ secret: SECRET });
const jwtAuthGuard = new JwtAuthGuard(jwtService);
const rolesGuard = new RolesGuard(new Reflector());

async function signAccessToken(role: UserRole): Promise<string> {
  const payload: JwtAccessTokenPayload = {
    sub: USER_ID,
    school_id: role === UserRole.SUPER_ADMIN ? null : SCHOOL_ID,
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

async function activateGuards(
  request: MockRequest,
  definition: EndpointDefinition<never, never>,
): Promise<void> {
  const context = makeContext(request, definition);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
}

const onboardHandler = postSchools as EndpointDefinition<never, never>;

describe('SchoolsController (onboarding)', () => {
  it('routes POST /schools through JWT + Roles guards restricted to SUPER_ADMIN', async () => {
    const metadata = postSchools.roles;
    assert.deepEqual(metadata, [UserRole.SUPER_ADMIN]);
  });

  it('allows a SUPER_ADMIN to reach the onboarding handler', async () => {
    const request: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.SUPER_ADMIN)}` },
    };
    await activateGuards(request, onboardHandler);

    assert.equal((request.user as AuthenticatedRequestUser).role, UserRole.SUPER_ADMIN);
  });

  it('rejects every non-super-admin role with 403', async () => {
    for (const role of [
      UserRole.SCHOOL_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ]) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(role)}` },
      };
      await assert.rejects(
        activateGuards(request, onboardHandler),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403);
          return true;
        },
      );
    }
  });

  it('delegates to SchoolsService.onboard and returns the clean response', async () => {
    const expected = {
      school: {
        id: 'school-1',
        name: 'Lincoln High School',
        code: 'lincoln-high',
        is_active: true,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      admin: {
        id: 'user-1',
        school_id: 'school-1',
        role: UserRole.SCHOOL_ADMIN,
        first_name: 'Alicia',
        last_name: 'Adams',
        email: 'admin@lincoln-high.org',
      },
    };
    let receivedDto: OnboardSchoolDto | undefined;
    const service = {
      onboard: async (dto: OnboardSchoolDto) => {
        receivedDto = dto;
        return expected;
      },
    } as unknown as SchoolsService;
    const restore = overrideContainer('schools', service);
    let result: unknown;
    try {
      result = await callHandler(postSchools, { body: makeOnboardDto() });
    } finally {
      restore();
    }

    assert.ok(receivedDto, 'service must receive the validated DTO');
    assert.deepEqual(result, expected);
  });
});

function makeOnboardDto(): OnboardSchoolDto {
  const dto = new OnboardSchoolDto();
  dto.school = { name: 'Lincoln High School', code: 'lincoln-high' };
  dto.admin = {
    name: 'Alicia Adams',
    email: 'admin@lincoln-high.org',
    password: 'correct-horse-battery',
  };
  return dto;
}
