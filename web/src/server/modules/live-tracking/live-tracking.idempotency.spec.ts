import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { TripStatus, UserRole } from '@school-bus-tracking/shared-types';
import {
  Trip,
  RouteAssignment,
  Stop,
  Student,
  StudentGuardian,
  TripLocation,
} from '../../database/models';
import type {
  IdempotencyService,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.service';
import { LiveTrackingService } from './live-tracking.service';
import {
  ASSIGNMENTS,
  DRIVER_A,
  GUARDIANS,
  STOPS,
  STUDENTS,
  TRIP_A,
  actorOf,
  locationPayload,
  makeBroadcastCapture,
  makeLocationStore,
  makeNoopArrivalsStub,
  makeTrip,
  matchesWhere,
  type StubTrip,
} from './live-tracking.test-utils';

/**
 * Socket GPS idempotency.
 *
 * `recordLocation` is the Socket.IO ingestion path for crew GPS fixes; the
 * mobile client re-emits a fix when its acknowledgement is lost, so the
 * service must recognize a redelivered `(tripId, idempotency_key)` and
 * return the original receipt instead of inserting and broadcasting a
 * duplicate point.
 */
describe('LiveTrackingService.recordLocation idempotency', () => {
  const TRIPS: StubTrip[] = [makeTrip({ id: TRIP_A, status: TripStatus.IN_PROGRESS })];
  const DRIVER = actorOf(UserRole.DRIVER, DRIVER_A);

  /** In-memory `IdempotencyService` double with the real scoping semantics. */
  function stubIdempotencyService() {
    const rows = new Map<string, { status: number; body: Record<string, unknown> }>();
    const service = {
      async check(params: {
        schoolId: string;
        userId: string;
        endpoint: string;
        idempotencyKey: string;
      }): Promise<IdempotencyResult> {
        const key = `${params.schoolId}:${params.userId}:${params.endpoint}:${params.idempotencyKey}`;
        const existing = rows.get(key);
        if (!existing) {
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
          rows.set(key, { status: params.responseStatus, body: params.responseBody });
        }
      },
    } as unknown as IdempotencyService;
    return { service, rows };
  }

  function makeService(idempotency?: IdempotencyService) {
    const store = makeLocationStore();
    const capture = makeBroadcastCapture();
    const service = new LiveTrackingService(
      store.repo as unknown as typeof TripLocation,
      {
        findOne: async (query: { where: Record<string, unknown> }) =>
          (TRIPS.find((trip) =>
            matchesWhere(trip as unknown as Record<string, unknown>, query.where),
          ) ?? null) as unknown as Trip,
      } as unknown as typeof Trip,
      {
        findAll: async (query: { where: Record<string, unknown> }) =>
          ASSIGNMENTS.filter((assignment) =>
            matchesWhere(assignment as unknown as Record<string, unknown>, query.where),
          ) as unknown as RouteAssignment[],
      } as unknown as typeof RouteAssignment,
      {
        findAll: async (query: { where: Record<string, unknown> }) =>
          STUDENTS.filter((student) =>
            matchesWhere(student as unknown as Record<string, unknown>, query.where),
          ) as unknown as Student[],
      } as unknown as typeof Student,
      {
        findAll: async (query: { where: Record<string, unknown> }) =>
          STOPS.filter((stop) =>
            matchesWhere(stop as unknown as Record<string, unknown>, query.where),
          ) as unknown as Stop[],
      } as unknown as typeof Stop,
      {
        findAll: async (query: { where: Record<string, unknown> }) =>
          GUARDIANS.filter((guardian) =>
            matchesWhere(guardian as unknown as Record<string, unknown>, query.where),
          ) as unknown as StudentGuardian[],
      } as unknown as typeof StudentGuardian,
      { gpsMinIntervalMs: 0, maxFutureSkewMs: 300_000, maxPastSkewMs: 86_400_000 },
      makeNoopArrivalsStub(),
      { findOne: async () => null, findAll: async () => [] } as never,
      idempotency,
    );
    service.attachBroadcaster(capture.fn);
    return { service, store, capture };
  }

  it('inserts and broadcasts a redelivered fix exactly once', async () => {
    const idempotency = stubIdempotencyService();
    const { service, store, capture } = makeService(idempotency.service);
    const fix = locationPayload(TRIP_A);

    const first = await service.recordLocation(DRIVER, { ...fix, idempotency_key: 'fix-key-1' });
    const second = await service.recordLocation(DRIVER, { ...fix, idempotency_key: 'fix-key-1' });

    assert.equal(first.ack.status, 'accepted');
    assert.equal(second.ack.status, 'accepted');
    assert.deepEqual(second.ack, first.ack);
    assert.equal(store.createPayloads.length, 1);
    assert.equal(store.createPayloads[0]?.latitude, fix.latitude);
    assert.equal(capture.emitted.length, 1);
    assert.equal(idempotency.rows.size, 1);
  });

  it('treats a missing key as always-new (backwards compatibility)', async () => {
    const idempotency = stubIdempotencyService();
    const { service, store, capture } = makeService(idempotency.service);
    const fix = locationPayload(TRIP_A);

    await service.recordLocation(DRIVER, { ...fix });
    await service.recordLocation(DRIVER, { ...fix });

    assert.equal(store.createPayloads.length, 2);
    assert.equal(capture.emitted.length, 2);
    assert.equal(idempotency.rows.size, 0);
  });

  it('treats distinct keys as distinct fixes', async () => {
    const idempotency = stubIdempotencyService();
    const { service, store } = makeService(idempotency.service);
    const fix = locationPayload(TRIP_A);

    await service.recordLocation(DRIVER, { ...fix, idempotency_key: 'fix-key-a' });
    await service.recordLocation(DRIVER, { ...fix, idempotency_key: 'fix-key-b' });

    assert.equal(store.createPayloads.length, 2);
    assert.equal(idempotency.rows.size, 2);
  });

  it('never replays a rejected fix: the same key with a valid fix executes', async () => {
    const idempotency = stubIdempotencyService();
    const { service, store } = makeService(idempotency.service);

    const rejected = await service.recordLocation(DRIVER, {
      ...locationPayload(TRIP_A),
      // Beyond the 5-minute future-skew window: rejected by the clock-skew
      // guard, so the key must not be stored — otherwise the valid retry
      // would replay the rejection.
      recorded_at: new Date(Date.now() + 600_000).toISOString(),
      idempotency_key: 'fix-key-retry',
    });
    assert.equal(rejected.ack.status, 'rejected');

    const valid = await service.recordLocation(DRIVER, {
      ...locationPayload(TRIP_A),
      idempotency_key: 'fix-key-retry',
    });

    assert.equal(valid.ack.status, 'accepted');
    assert.equal(store.createPayloads.length, 1);
    assert.equal(idempotency.rows.size, 1);
  });

  it('fails open when the idempotency store is unavailable', async () => {
    const { service, store } = makeService({
      check: async () => {
        throw new Error('redis down');
      },
      store: async () => {
        throw new Error('redis down');
      },
    } as unknown as IdempotencyService);

    const result = await service.recordLocation(DRIVER, {
      ...locationPayload(TRIP_A),
      idempotency_key: 'fix-key-failopen',
    });

    assert.equal(result.ack.status, 'accepted');
    assert.equal(store.createPayloads.length, 1);
  });

  it('keeps constructor source-compatibility for the nine-argument form', () => {
    // The idempotency dependency is trailing and optional; existing
    // instantiations (and the legacy socket adapter) keep working without
    // it. This pins that the service still functions with no store at all.
    const { service, store } = makeService();
    assert.ok(service instanceof LiveTrackingService);
    assert.equal(store.createPayloads.length, 0);
  });
});
