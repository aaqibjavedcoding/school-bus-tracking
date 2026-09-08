import 'reflect-metadata';
import { afterEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UserRole } from '@school-bus-tracking/shared-types';
import { overrideContainer } from '../container';
import type { AuditService } from '../modules/audit/audit.service';
import type { JwtService } from '../framework';
import type { SchoolAccessService } from '../common/access/school-access.service';
import type { IdempotencyService } from '../common/idempotency/idempotency.service';
import type { IdempotencyResult } from '../common/idempotency/idempotency.service';
import type { TripAttendanceService } from '../modules/trip-attendance/trip-attendance.service';
import { postTripsByTripIdStudentsByStudentIdBoard } from '../api/trip-attendance';
import { invokeRoute } from './route-testing';
import type { EndpointDefinition } from './route-runtime';

/**
 * Route-runtime idempotency enforcement.
 *
 * The `x-idempotency-key` header used to be accepted by the mobile offline
 * queue and ignored by the server. These specs drive the real attendance
 * board endpoint through the real route runtime (JWT guard → roles →
 * idempotency → handler → envelope) and prove that a declared
 * `EndpointDefinition.idempotency` scope actually deduplicates: the first
 * request executes, replays return the stored response without executing,
 * and keys never leak across tenants, users or endpoints.
 *
 * Only the JWT verification and the database-backed services are stubbed;
 * the guard chain, the runtime sequencing and the envelope are production
 * code.
 */
describe('route runtime idempotency', () => {
  const restores: Array<() => void> = [];
  const TRIP_ID = '11111111-1111-4111-8111-111111111111';
  const STUDENT_ID = '22222222-2222-4222-8222-222222222222';

  afterEach(() => {
    while (restores.length > 0) {
      restores.pop()?.();
    }
  });

  /** In-memory `IdempotencyService` double with the real scoping semantics. */
  function stubIdempotencyService() {
    const rows = new Map<
      string,
      { status: number; body: Record<string, unknown>; expiresAt: number }
    >();
    const stub = {
      async check(params: {
        schoolId: string;
        userId: string;
        endpoint: string;
        idempotencyKey: string;
      }): Promise<IdempotencyResult> {
        const key = `${params.schoolId}:${params.userId}:${params.endpoint}:${params.idempotencyKey}`;
        const existing = rows.get(key);
        if (!existing || existing.expiresAt < Date.now()) {
          return { status: 'new' };
        }
        return {
          status: 'duplicate',
          responseStatus: existing.status,
          responseBody: existing.body,
        };
      },
      async store(params: {
        schoolId: string;
        userId: string;
        endpoint: string;
        idempotencyKey: string;
        responseStatus: number;
        responseBody: Record<string, unknown>;
      }): Promise<void> {
        const key = `${params.schoolId}:${params.userId}:${params.endpoint}:${params.idempotencyKey}`;
        if (!rows.has(key)) {
          rows.set(key, {
            status: params.responseStatus,
            body: params.responseBody,
            expiresAt: Date.now() + 86_400_000,
          });
        }
      },
    } as unknown as IdempotencyService;
    restores.push(overrideContainer('idempotency', stub));
    return { stub, rows };
  }

  /**
   * Stubs JWT verification: each token string maps to a fixed user. The
   * school/user lifecycle checks always pass — lifecycle enforcement has its
   * own specs; here the claims only need to reach the handler.
   */
  function stubAuth(users: Record<string, { sub: string; school_id: string; role: UserRole }>) {
    const jwt = {
      verifyAsync: async (token: string) => {
        const user = users[token];
        if (!user) {
          throw new Error('invalid token');
        }
        return user;
      },
    } as unknown as JwtService;
    const schoolAccess = {
      isSchoolAccessible: async () => true,
      isUserActive: async () => true,
    } as unknown as SchoolAccessService;
    restores.push(overrideContainer('jwt', jwt));
    restores.push(overrideContainer('schoolAccess', schoolAccess));
  }

  function stubAttendance() {
    let calls = 0;
    const stub = {
      board: async () => {
        calls += 1;
        return { id: `attendance-${calls}`, trip_id: TRIP_ID, student_id: STUDENT_ID };
      },
    } as unknown as TripAttendanceService;
    restores.push(overrideContainer('tripAttendance', stub));
    return { calls: () => calls };
  }

  function stubAudit() {
    const events: Array<Record<string, unknown>> = [];
    const stub = {
      log: async (input: Record<string, unknown>) => {
        events.push(input);
      },
    } as unknown as AuditService;
    restores.push(overrideContainer('audit', stub));
    return { events };
  }

  function boardRequest(token: string, key?: string, requestId?: string) {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (key !== undefined) {
      headers['x-idempotency-key'] = key;
    }
    if (requestId !== undefined) {
      headers['x-request-id'] = requestId;
    }
    return invokeRoute(
      postTripsByTripIdStudentsByStudentIdBoard as EndpointDefinition<never, never>,
      {
        method: 'POST',
        url: `http://localhost/api/v1/trips/${TRIP_ID}/students/${STUDENT_ID}/board`,
        headers,
        params: { tripId: TRIP_ID, studentId: STUDENT_ID },
      },
    );
  }

  const DRIVER_A = { sub: 'user-a', school_id: 'school-a', role: UserRole.DRIVER };

  it('replays the stored response without re-executing the handler', async () => {
    stubIdempotencyService();
    stubAuth({ 'token-a': DRIVER_A });
    const attendance = stubAttendance();
    stubAudit();

    const first = await boardRequest('token-a', 'offline-queue-key-1');
    const second = await boardRequest('token-a', 'offline-queue-key-1');

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    // The replay returns the stored data re-wrapped in a fresh envelope (new
    // `timestamp`): the payload must be identical, the handler untouched.
    assert.deepEqual(
      (second.body as { data: unknown }).data,
      (first.body as { data: unknown }).data,
    );
    assert.equal(attendance.calls(), 1);
  });

  it('executes again for a fresh key', async () => {
    stubIdempotencyService();
    stubAuth({ 'token-a': DRIVER_A });
    const attendance = stubAttendance();
    stubAudit();

    await boardRequest('token-a', 'key-one');
    const second = await boardRequest('token-a', 'key-two');

    assert.equal(second.status, 200);
    assert.equal(attendance.calls(), 2);
    assert.equal(
      (second.body as { data: { id: string } }).data.id,
      'attendance-2',
      'a fresh key must execute, not replay',
    );
  });

  it('executes every request that carries no key', async () => {
    stubIdempotencyService();
    stubAuth({ 'token-a': DRIVER_A });
    const attendance = stubAttendance();
    stubAudit();

    await boardRequest('token-a');
    await boardRequest('token-a');

    assert.equal(attendance.calls(), 2);
  });

  it('isolates keys per user: the same key string is independent across users', async () => {
    stubIdempotencyService();
    stubAuth({
      'token-a': DRIVER_A,
      'token-b': { sub: 'user-b', school_id: 'school-a', role: UserRole.DRIVER },
    });
    const attendance = stubAttendance();
    stubAudit();

    await boardRequest('token-a', 'shared-key');
    await boardRequest('token-b', 'shared-key');

    assert.equal(attendance.calls(), 2);
  });

  it('isolates keys per tenant: the same key string is independent across schools', async () => {
    stubIdempotencyService();
    stubAuth({
      'token-a': DRIVER_A,
      'token-b': { sub: 'user-a', school_id: 'school-b', role: UserRole.DRIVER },
    });
    const attendance = stubAttendance();
    stubAudit();

    await boardRequest('token-a', 'shared-key');
    await boardRequest('token-b', 'shared-key');

    assert.equal(attendance.calls(), 2);
  });

  it('rejects an oversized idempotency key with 400 and never executes', async () => {
    stubIdempotencyService();
    stubAuth({ 'token-a': DRIVER_A });
    const attendance = stubAttendance();
    stubAudit();

    const response = await boardRequest('token-a', 'k'.repeat(256));

    assert.equal(response.status, 400);
    assert.equal(attendance.calls(), 0);
  });

  it('emits no duplicate audit event for a replay', async () => {
    stubIdempotencyService();
    stubAuth({ 'token-a': DRIVER_A });
    stubAttendance();
    const audit = stubAudit();

    await boardRequest('token-a', 'audited-key');
    await boardRequest('token-a', 'audited-key');

    const boardingEvents = audit.events.filter((event) => event.action === 'attendance.board');
    assert.equal(boardingEvents.length, 1);
  });

  it('echoes a client-supplied request id on success', async () => {
    stubIdempotencyService();
    stubAuth({ 'token-a': DRIVER_A });
    stubAttendance();
    stubAudit();

    const response = await boardRequest('token-a', 'key-req-id', 'client-correlation-1');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), 'client-correlation-1');
  });

  it('carries a request id on errors too', async () => {
    stubIdempotencyService();
    stubAuth({ 'token-a': DRIVER_A });
    stubAttendance();
    stubAudit();

    const response = await invokeRoute(
      postTripsByTripIdStudentsByStudentIdBoard as EndpointDefinition<never, never>,
      {
        method: 'POST',
        url: 'http://localhost/api/v1/trips/not-a-uuid/students/x/board',
        headers: { Authorization: 'Bearer token-a', 'x-request-id': 'client-correlation-err' },
        params: { tripId: 'not-a-uuid', studentId: 'not-a-uuid' },
      },
    );

    assert.equal(response.status, 400);
    assert.equal(response.headers.get('x-request-id'), 'client-correlation-err');
  });

  it('mints a request id when the client sent none', async () => {
    stubIdempotencyService();
    stubAuth({ 'token-a': DRIVER_A });
    stubAttendance();
    stubAudit();

    const response = await boardRequest('token-a');

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('x-request-id') ?? '',
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
