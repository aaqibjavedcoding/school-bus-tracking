import '../support/env';
import { after, before, beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { NotificationType, TripStatus, UserRole } from '@school-bus-tracking/shared-types';
import { prepareDatabase, truncateAll } from '../support/database';
import {
  createBus,
  createGuardianLink,
  createRoute,
  createSchool,
  createStop,
  createStudent,
  createTrip,
  createUser,
} from '../support/fixtures';
import {
  DeviceToken,
  Notification,
  Run,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  TripLocation,
  TripStopArrival,
  User,
} from '../../src/server/database/models';
import { DeviceTokensService } from '../../src/server/modules/notifications/device-tokens.service';
import { NotificationsService } from '../../src/server/modules/notifications/notifications.service';
import { DeliveryWorker } from '../../src/server/modules/notifications/outbox/delivery-worker';
import { EtaService } from '../../src/server/modules/eta/eta.service';
import {
  StopArrivalsService,
  type ArrivalDetectionConfig,
} from '../../src/server/modules/eta/stop-arrivals.service';
import {
  emptyDeviceOutcome,
  type DeviceDeliveryOutcome,
  type PushDeliveryResult,
  type PushNotificationPayload,
  type PushNotificationProvider,
} from '../../src/server/modules/notifications/providers';

const POLICY = {
  maxAttempts: 4,
  baseBackoffMs: 2_000,
  expiryMs: 10 * 60 * 1000,
  batchSize: 50,
};

const ETA_CONFIG = {
  fallbackSpeedKmh: 25,
  minSpeedKmh: 5,
  maxSpeedKmh: 90,
  staleAfterMs: 180_000,
};

const ARRIVAL_CONFIG: ArrivalDetectionConfig = {
  maxFixAgeMs: 180_000,
  futureToleranceMs: 60_000,
  maxAccuracyMeters: 100,
  allowMissingAccuracy: true,
  requiredConsecutiveFixes: 2,
  skipExtraFixes: 1,
  maxSkipAhead: 2,
  exitHysteresisMeters: 20,
  minDwellMs: 0,
  maxPlausibleSpeedKmh: 150,
  minJumpDistanceMeters: 500,
};

/** Default fixture stop coordinates (`createStop`). */
const STOP_LAT = 1.23;
const STOP_LNG = 4.56;

/** A provider double that records every payload and returns scripted outcomes. */
class ScriptedPushProvider implements PushNotificationProvider {
  readonly isConfigured = true;
  readonly name = 'scripted';
  readonly sent: PushNotificationPayload[] = [];
  outcomes: Array<(payload: PushNotificationPayload) => PushDeliveryResult> = [];

  async send(payload: PushNotificationPayload): Promise<PushDeliveryResult> {
    this.sent.push(payload);
    const scripted = this.outcomes.shift();
    if (scripted) {
      return scripted(payload);
    }
    return {
      success: true,
      provider: this.name,
      retryable: false,
      deviceOutcome: { ...emptyDeviceOutcome(), delivered: [...payload.deviceTokens] },
    };
  }

  async sendBatch(payloads: PushNotificationPayload[]): Promise<PushDeliveryResult[]> {
    const results: PushDeliveryResult[] = [];
    for (const payload of payloads) {
      results.push(await this.send(payload));
    }
    return results;
  }
}

function scriptedOutcome(overrides: Partial<DeviceDeliveryOutcome>): PushDeliveryResult {
  const outcome = { ...emptyDeviceOutcome(), ...overrides };
  return {
    success: outcome.delivered.length > 0,
    provider: 'scripted',
    retryable: outcome.retryable.length > 0,
    invalidTokens: outcome.invalid,
    deviceOutcome: outcome,
  };
}

describe('notification outbox + arrival durability (real PostgreSQL)', () => {
  let sequelize: Sequelize;

  before(async () => {
    sequelize = await prepareDatabase();
  });

  after(async () => {
    await sequelize?.close();
  });

  beforeEach(async () => {
    await truncateAll(sequelize);
  });

  // -------------------------------------------------------------------
  // A — per-device retry state survives attempts / restarts
  // -------------------------------------------------------------------

  async function outboxFixture() {
    const school = await createSchool();
    const parent = await createUser(school.id, UserRole.PARENT);
    for (const token of ['tok-a', 'tok-b']) {
      await DeviceToken.create({
        id: randomUUID(),
        school_id: school.id,
        user_id: parent.id,
        platform: 'android',
        token,
        is_active: true,
        last_seen_at: new Date(),
      } as never);
    }

    const notification = await Notification.create({
      id: randomUUID(),
      school_id: school.id,
      user_id: parent.id,
      type: NotificationType.STUDENT_BOARDED,
      trip_id: null,
      student_id: null,
      stop_id: null,
      title: 'Aarav boarded',
      message: 'Aarav boarded the bus.',
      payload: null,
      is_read: false,
      read_at: null,
      push_status: 'pending',
      dedup_key: 'a'.repeat(64),
      push_expires_at: new Date(Date.now() + 600_000),
      next_attempt_at: new Date(Date.now() - 1_000),
      delivered_tokens: null,
      delivery_pending_tokens: null,
    } as never);

    return { school, parent, notification };
  }

  function makeWorker(push: PushNotificationProvider): DeliveryWorker {
    return new DeliveryWorker(
      Notification,
      Trip,
      new DeviceTokensService(DeviceToken),
      push,
      sequelize,
      POLICY,
    );
  }

  it('migrates the per-device retry column without breaking legacy rows', async () => {
    const columns = await sequelize.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_name = 'notifications'
          AND column_name IN ('delivery_pending_tokens', 'delivered_tokens')`,
      { type: QueryTypes.SELECT },
    );
    const byName = new Map(columns.map((column) => [column.column_name, column.data_type]));
    assert.equal(byName.get('delivery_pending_tokens'), 'ARRAY');
    assert.equal(byName.get('delivered_tokens'), 'ARRAY');
  });

  it('persists partial per-device success, then retries only the failed device after a restart', async () => {
    const { parent, notification } = await outboxFixture();

    // Attempt 1: device A accepted, device B transient failure.
    const firstPush = new ScriptedPushProvider();
    firstPush.outcomes = [() => scriptedOutcome({ delivered: ['tok-a'], retryable: ['tok-b'] })];
    await makeWorker(firstPush).runOnce();

    const afterFirst = await Notification.findByPk(notification.id);
    assert.ok(afterFirst);
    assert.equal(afterFirst.push_status, 'failed', 'a device is still owed a delivery');
    assert.deepEqual(afterFirst.delivered_tokens, ['tok-a'], 'accepted device persisted');
    assert.deepEqual(afterFirst.delivery_pending_tokens, ['tok-b'], 'failed device persisted');
    assert.ok(afterFirst.next_attempt_at && afterFirst.next_attempt_at.getTime() > Date.now());

    // Simulate "the process restarted": a brand new worker instance.
    await Notification.update(
      { next_attempt_at: new Date(Date.now() - 1_000) },
      { where: { id: notification.id } },
    );
    const secondPush = new ScriptedPushProvider();
    await makeWorker(secondPush).runOnce();

    assert.equal(secondPush.sent.length, 1);
    assert.deepEqual(
      secondPush.sent[0].deviceTokens,
      ['tok-b'],
      'only the device that was still owed a delivery',
    );

    const afterSecond = await Notification.findByPk(notification.id);
    assert.ok(afterSecond);
    assert.equal(afterSecond.push_status, 'sent');
    assert.deepEqual(afterSecond.delivered_tokens?.slice().sort(), ['tok-a', 'tok-b']);
    assert.equal(afterSecond.delivery_pending_tokens, null);
    assert.equal(afterSecond.next_attempt_at, null);
    assert.equal(parent.id, afterSecond.user_id);
  });

  it('records a partial terminal row at the attempt limit instead of claiming sent', async () => {
    const { notification } = await outboxFixture();
    await Notification.update(
      {
        delivery_retry_count: POLICY.maxAttempts - 1,
        delivery_pending_tokens: ['tok-a', 'tok-b'],
      },
      { where: { id: notification.id } },
    );

    const push = new ScriptedPushProvider();
    push.outcomes = [() => scriptedOutcome({ delivered: ['tok-a'], retryable: ['tok-b'] })];
    await makeWorker(push).runOnce();

    const row = await Notification.findByPk(notification.id);
    assert.ok(row);
    assert.equal(row.push_status, 'partial');
    assert.deepEqual(row.delivered_tokens, ['tok-a']);
    assert.deepEqual(row.delivery_pending_tokens, ['tok-b'], 'the undelivered device is recorded');
    assert.match(String(row.delivery_abandoned_reason), /Maximum delivery attempts/);
    assert.equal(row.next_attempt_at, null);
  });

  it('never calls the provider for an expired row and passes the persisted deadline on a live one', async () => {
    const { notification } = await outboxFixture();
    const expiredPush = new ScriptedPushProvider();
    await Notification.update(
      { push_expires_at: new Date(Date.now() - 1_000) },
      { where: { id: notification.id } },
    );

    await makeWorker(expiredPush).runOnce();
    assert.equal(expiredPush.sent.length, 0, 'an expired alert is never sent');

    const expiresAt = new Date(Date.now() + 120_000);
    await Notification.update(
      {
        push_expires_at: expiresAt,
        push_status: 'pending',
        next_attempt_at: new Date(Date.now() - 1_000),
      },
      { where: { id: notification.id } },
    );
    const livePush = new ScriptedPushProvider();
    await makeWorker(livePush).runOnce();

    assert.equal(livePush.sent.length, 1);
    assert.equal(livePush.sent[0].expiresAt?.getTime(), expiresAt.getTime());
  });

  // -------------------------------------------------------------------
  // D — arrival → notification durability
  // -------------------------------------------------------------------

  async function arrivalFixture() {
    const school = await createSchool();
    const otherSchool = await createSchool();
    const driver = await createUser(school.id, UserRole.DRIVER);
    const parent = await createUser(school.id, UserRole.PARENT);
    const otherParent = await createUser(otherSchool.id, UserRole.PARENT);
    const bus = await createBus(school.id);
    const route = await createRoute(school.id);
    const otherRoute = await createRoute(otherSchool.id);
    const stop = await createStop(school.id, route.id, 1);
    const otherStop = await createStop(otherSchool.id, otherRoute.id, 1);
    const student = await createStudent(school.id, stop.id);
    const otherStudent = await createStudent(otherSchool.id, otherStop.id);
    await createGuardianLink(school.id, student.id, parent.id);
    await createGuardianLink(otherSchool.id, otherStudent.id, otherParent.id);
    const trip = await createTrip(
      school.id,
      route.id,
      bus.id,
      driver.id,
      null,
      TripStatus.IN_PROGRESS,
    );
    return { school, otherSchool, parent, otherParent, trip, stop, student, route, bus, driver };
  }

  function makeNotifications(
    push: PushNotificationProvider,
    notificationsModel: typeof Notification = Notification,
  ): NotificationsService {
    return new NotificationsService(
      notificationsModel,
      User,
      StudentGuardian,
      Student,
      Stop,
      Trip,
      new DeviceTokensService(DeviceToken),
      push,
      Run,
      POLICY,
    );
  }

  function makeArrivals(push: PushNotificationProvider, notificationsModel?: typeof Notification) {
    const notifications = makeNotifications(push, notificationsModel);
    const service = new StopArrivalsService(
      Stop,
      TripStopArrival,
      new EtaService(Stop, TripStopArrival, ETA_CONFIG),
      notifications,
      ARRIVAL_CONFIG,
      sequelize,
    );
    return { service, notifications };
  }

  function fixAt(trip: Trip, recordedAt: Date): TripLocation {
    return {
      id: randomUUID(),
      school_id: trip.school_id,
      trip_id: trip.id,
      latitude: STOP_LAT,
      longitude: STOP_LNG,
      accuracy: 10,
      speed: 0,
      heading: null,
      recorded_at: recordedAt,
      received_at: new Date(recordedAt.getTime() + 500),
    } as unknown as TripLocation;
  }

  /** Three inside-geofence fixes: the first accrues evidence, the rest confirm. */
  async function confirmArrival(
    service: StopArrivalsService,
    trip: Trip,
    base: number,
  ): Promise<void> {
    await service.onAcceptedFix(trip, fixAt(trip, new Date(base)), new Date(base + 500));
    await service.onAcceptedFix(trip, fixAt(trip, new Date(base + 3_000)), new Date(base + 3_500));
  }

  it('commits the arrival and its notification rows together — with no push call in the request path', async () => {
    const { trip, parent } = await arrivalFixture();
    const push = new ScriptedPushProvider();
    const { service } = makeArrivals(push);
    const base = Date.now();

    await confirmArrival(service, trip, base);

    const arrivals = await TripStopArrival.findAll({ where: { trip_id: trip.id } });
    assert.equal(arrivals.length, 1, 'the arrival is committed');

    const rows = await Notification.findAll({ where: { trip_id: trip.id } });
    assert.equal(rows.length, 1, 'the notification intent is committed with it');
    assert.equal(rows[0].user_id, parent.id);
    assert.equal(rows[0].type, NotificationType.STOP_ARRIVED);
    assert.equal(rows[0].push_status, 'pending', 'delivery is left to the outbox worker');
    assert.equal(push.sent.length, 0, 'no external push call inside the GPS request');

    const expiresAt = rows[0].push_expires_at?.getTime() ?? 0;
    assert.ok(expiresAt <= base + 3_000 + POLICY.expiryMs + 1_000, 'window runs from the arrival');
  });

  it('rolls the arrival back when the notification fan-out fails (no phantom arrival)', async () => {
    const { trip } = await arrivalFixture();
    const push = new ScriptedPushProvider();

    // Fault injection *inside* the transaction: the notification insert fails
    // before the transaction can commit (a crash mid-fan-out).
    const flakyNotifications = {
      findOne: Notification.findOne.bind(Notification),
      create: async (...args: Parameters<typeof Notification.create>) => {
        void args;
        throw new Error('simulated fan-out failure');
      },
    } as unknown as typeof Notification;
    const { service } = makeArrivals(push, flakyNotifications);
    const base = Date.now();

    await service.onAcceptedFix(trip, fixAt(trip, new Date(base)), new Date(base + 500));
    const result = await service.onAcceptedFix(
      trip,
      fixAt(trip, new Date(base + 3_000)),
      new Date(base + 3_500),
    );

    assert.equal(result, null, 'the failed evaluation records nothing');
    assert.equal(
      await TripStopArrival.count({ where: { trip_id: trip.id } }),
      0,
      'the arrival rolled back with the fan-out',
    );
    assert.equal(await Notification.count({ where: { trip_id: trip.id } }), 0);
  });

  it('is idempotent: a replayed arrival evaluation creates no second inbox row', async () => {
    const { trip } = await arrivalFixture();
    const { service } = makeArrivals(new ScriptedPushProvider());
    const base = Date.now();

    await confirmArrival(service, trip, base);

    // Replay: a second service instance (restart) re-evaluates the same stop.
    const replayed = makeArrivals(new ScriptedPushProvider()).service;
    await replayed.onAcceptedFix(trip, fixAt(trip, new Date(base + 6_000)), new Date(base + 6_500));

    assert.equal(await TripStopArrival.count({ where: { trip_id: trip.id } }), 1);
    assert.equal(await Notification.count({ where: { trip_id: trip.id } }), 1);
  });

  it('keeps the fan-out tenant-scoped: another school’s parent is never notified', async () => {
    const { trip, otherParent } = await arrivalFixture();
    const { service } = makeArrivals(new ScriptedPushProvider());
    const base = Date.now();

    await confirmArrival(service, trip, base);

    const rows = await Notification.findAll({ where: { trip_id: trip.id } });
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].user_id, otherParent.id);
    assert.equal(rows[0].school_id, trip.school_id);
  });

  it('delivers a committed arrival notification through the outbox (no real provider)', async () => {
    const { trip } = await arrivalFixture();
    const push = new ScriptedPushProvider();
    const { service } = makeArrivals(push);
    const base = Date.now();

    await confirmArrival(service, trip, base);

    const row = await Notification.findOne({ where: { trip_id: trip.id } });
    assert.ok(row, 'the arrival notification exists before any delivery attempt');
    await DeviceToken.create({
      id: randomUUID(),
      school_id: row.school_id,
      user_id: row.user_id,
      platform: 'android',
      token: 'tok-arrival',
      is_active: true,
      last_seen_at: new Date(),
    } as never);

    await makeWorker(push).runOnce();

    const delivered = await Notification.findByPk(row.id);
    assert.equal(delivered?.push_status, 'sent');
    assert.deepEqual(delivered?.delivered_tokens, ['tok-arrival']);
    assert.equal(push.sent.length, 1);
    assert.equal(push.sent[0].data?.['type'], NotificationType.STOP_ARRIVED);
  });
});
