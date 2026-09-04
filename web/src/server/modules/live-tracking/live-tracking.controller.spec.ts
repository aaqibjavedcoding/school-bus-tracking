import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService, Reflector } from '../../framework';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { callHandler, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import {
  getTripsByTripIdLocation,
  getTripsByTripIdLocationHistory,
} from '../../api/live-tracking';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { LiveTrackingService } from './live-tracking.service';
import { ListTripLocationHistoryQueryDto } from './dto/list-trip-location-history-query.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TRIP_ID = '33333333-3333-4333-8333-333333333333';
const SECRET = 'live-tracking-controller-test-secret';

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

async function activateGuards(
  request: MockRequest,
  definition: EndpointDefinition<never, never>,
): Promise<void> {
  const context = makeContext(request, definition);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
}

const getLatestHandler = getTripsByTripIdLocation as EndpointDefinition<never, never>;
const getHistoryHandler = getTripsByTripIdLocationHistory as EndpointDefinition<never, never>;

const READ_ROLES = [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT];

describe('LiveTrackingController authorization', () => {
  it('declares the read roles on the controller for both endpoints', () => {
    assert.deepEqual(getTripsByTripIdLocation.roles, READ_ROLES);
    for (const handler of [getLatestHandler, getHistoryHandler]) {
      assert.equal(Reflect.getMetadata(ROLES_KEY, handler), undefined);
    }
  });

  it('lets every allowed role read locations and history', async () => {
    for (const role of READ_ROLES) {
      for (const handler of [getLatestHandler, getHistoryHandler]) {
        const request: MockRequest = {
          headers: { authorization: `Bearer ${await signAccessToken(role)}` },
        };
        await activateGuards(request, handler);
        assert.equal(request.user?.role, role);
        assert.equal(request.user?.school_id, SCHOOL_A);
      }
    }
  });

  it('rejects the platform SUPER_ADMIN on every handler with 403', async () => {
    for (const handler of [getLatestHandler, getHistoryHandler]) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(UserRole.SUPER_ADMIN)}` },
      };
      await assert.rejects(
        activateGuards(request, handler),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403);
          return true;
        },
      );
    }
  });

  it('rejects an anonymous caller with 401', async () => {
    for (const handler of [getLatestHandler, getHistoryHandler]) {
      await assert.rejects(
        activateGuards({ headers: {} }, handler),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 401);
          return true;
        },
      );
    }
  });
});

describe('LiveTrackingController delegation', () => {
  it('forwards only the JWT-derived actor, the trip id and the query', async () => {
    const calls: Array<{
      method: 'getLatest' | 'getHistory';
      actor: AuthenticatedRequestUser;
      tripId: string;
      query?: ListTripLocationHistoryQueryDto;
    }> = [];

    const service = {
      getLatestLocation: async (actor: AuthenticatedRequestUser, tripId: string) => {
        calls.push({ method: 'getLatest', actor, tripId });
        return { trip_id: tripId, latest: null };
      },
      getLocationHistory: async (
        actor: AuthenticatedRequestUser,
        tripId: string,
        query: ListTripLocationHistoryQueryDto,
      ) => {
        calls.push({ method: 'getHistory', actor, tripId, query });
        return { items: [], limit: 100 };
      },
    } as unknown as LiveTrackingService;

    const restore = overrideContainer('liveTracking', service);
    try {
      const actor: AuthenticatedRequestUser = {
        id: USER_ID,
        school_id: SCHOOL_A,
        role: UserRole.PARENT,
      };
      const query = Object.assign(new ListTripLocationHistoryQueryDto(), {
        from: '2026-09-01T06:00:00.000Z',
        limit: 50,
      });

      await callHandler(getTripsByTripIdLocation, { user: actor, params: { tripId: TRIP_ID } });
      await callHandler(getTripsByTripIdLocationHistory, { user: actor, params: { tripId: TRIP_ID }, query: query });
    } finally {
      restore();
    }

    assert.deepEqual(
      calls.map((call) => call.method),
      ['getLatest', 'getHistory'],
    );
    for (const call of calls) {
      assert.equal(call.actor.id, USER_ID);
      assert.equal(call.actor.school_id, SCHOOL_A);
      assert.equal(call.tripId, TRIP_ID);
    }
    assert.equal(calls[1].query?.from, '2026-09-01T06:00:00.000Z');
    assert.equal(calls[1].query?.limit, 50);
  });

  it('declares no request body on any handler', () => {
    // Both endpoints are GETs: the acting user comes from the JWT and every
    // filter comes from the query string. A definition without a `bodyType`
    // is the replacement for a handler without an `@Body()` parameter — the
    // runtime never parses or validates a body for it.
    for (const definition of [getLatestHandler, getHistoryHandler]) {
      assert.equal(definition.bodyType, undefined);
    }
  });
});
