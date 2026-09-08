import '../support/env';
import { after, before, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import {
  EmergencyStatus,
  EmergencyType,
  NotificationType,
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { prepareDatabase, truncateAll } from '../support/database';
import { createBus, createRoute, createSchool, createTrip, createUser } from '../support/fixtures';
import { ConfigService } from '../../src/server/framework';
import {
  AuditLog,
  EmergencyEvent,
  IdempotencyKey,
  Notification,
  RefreshToken,
  TripLocation,
} from '../../src/server/database/models';
import { RetentionWorker } from '../../src/server/workers/retention.worker';

/**
 * The retention worker against the real PostgreSQL engine.
 *
 * The unit specs pin the SQL orchestration (transaction-scoped advisory lock,
 * cutoffs, rollback); this suite proves the part a stub cannot: the DELETEs
 * actually remove the right rows on a real database — old data goes, recent
 * data and non-terminal emergencies stay — and a second worker is *skipped*
 * while the advisory lock is held elsewhere (the multi-instance guard).
 */
describe('data retention worker (real PostgreSQL)', () => {
  let sequelize: Sequelize;
  let worker: RetentionWorker;
  let schoolId: string;
  let userId: string;
  let tripId: string;

  const daysAgo = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  before(async () => {
    sequelize = await prepareDatabase();
    await truncateAll(sequelize);

    const school = await createSchool();
    schoolId = school.id;
    const admin = await createUser(school.id, UserRole.SCHOOL_ADMIN);
    userId = admin.id;
    const driver = await createUser(school.id, UserRole.DRIVER);
    const route = await createRoute(school.id);
    const bus = await createBus(school.id);
    const trip = await createTrip(
      school.id,
      route.id,
      bus.id,
      driver.id,
      null,
      TripStatus.COMPLETED,
    );
    tripId = trip.id;

    // --- trip locations: two ancient fixes, one fresh ---------------------
    for (const recordedAt of [daysAgo(400), daysAgo(120), new Date()]) {
      await TripLocation.create({
        school_id: schoolId,
        trip_id: tripId,
        latitude: 24.7,
        longitude: 46.6,
        recorded_at: recordedAt,
        received_at: recordedAt,
      } as never);
    }

    // --- notifications: two ancient, one fresh ----------------------------
    for (const createdAt of [daysAgo(300), daysAgo(200), new Date()]) {
      await Notification.create({
        school_id: schoolId,
        user_id: userId,
        type: NotificationType.TRIP_BOARDING,
        trip_id: null,
        student_id: null,
        stop_id: null,
        title: 'Trip update',
        message: 'The bus arrived',
        payload: null,
        is_read: false,
        read_at: null,
        created_at: createdAt,
      } as never);
    }

    // --- refresh tokens: expired-and-ancient, recent ----------------------
    await RefreshToken.create({
      school_id: schoolId,
      user_id: userId,
      token_hash: randomUUID().replace(/-/g, ''),
      expires_at: daysAgo(1),
      created_at: daysAgo(60), // beyond the 30-day refresh-token policy
    } as never);
    await RefreshToken.create({
      school_id: schoolId,
      user_id: userId,
      token_hash: randomUUID().replace(/-/g, ''),
      expires_at: daysAgo(-1),
    } as never);

    // --- audit logs: one ancient, one fresh -------------------------------
    for (const createdAt of [daysAgo(500), new Date()]) {
      await AuditLog.create({
        school_id: schoolId,
        actor_user_id: userId,
        action: 'TRIP_STATUS_CHANGE',
        entity_type: 'TRIP',
        entity_id: tripId,
        request_id: null,
        metadata: { from: 'SCHEDULED', to: 'COMPLETED' },
        ip_address: '127.0.0.1',
        created_at: createdAt,
      } as never);
    }

    // --- emergencies: terminal-and-ancient goes, OPEN stays ---------------
    await EmergencyEvent.create({
      school_id: schoolId,
      trip_id: tripId,
      bus_id: null,
      route_id: null,
      raised_by_user_id: userId,
      raised_by_role: UserRole.DRIVER,
      type: EmergencyType.BREAKDOWN,
      status: EmergencyStatus.RESOLVED,
      message: null,
      triggered_at: daysAgo(800),
      resolved_at: daysAgo(795),
      resolved_by_user_id: userId,
    } as never);
    await EmergencyEvent.create({
      school_id: schoolId,
      trip_id: tripId,
      bus_id: null,
      route_id: null,
      raised_by_user_id: userId,
      raised_by_role: UserRole.DRIVER,
      type: EmergencyType.ACCIDENT,
      status: EmergencyStatus.OPEN,
      message: 'still open',
      triggered_at: daysAgo(800),
      resolved_at: null,
    } as never);

    // --- idempotency keys: one expired long ago, one live -----------------
    await IdempotencyKey.create({
      school_id: schoolId,
      user_id: userId,
      endpoint: 'trip_status',
      idempotency_key: 'stale-key',
      response_status: 200,
      response_body: {},
      expires_at: daysAgo(10),
      created_at: daysAgo(17),
    } as never);
    await IdempotencyKey.create({
      school_id: schoolId,
      user_id: userId,
      endpoint: 'trip_status',
      idempotency_key: 'live-key',
      response_status: 200,
      response_body: {},
      expires_at: daysAgo(-1),
    } as never);

    worker = new RetentionWorker(new ConfigService({ retention: {} }), sequelize);
  });

  after(async () => {
    await sequelize?.close();
  });

  async function count(table: string, where = ''): Promise<number> {
    const rows = await sequelize.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ${table} ${where}`,
      { type: QueryTypes.SELECT },
    );
    return Number.parseInt(rows[0].n, 10);
  }

  it('deletes exactly the rows past their policy age and keeps the rest', async () => {
    const results = await worker.runAll();

    assert.equal(results.skipped, false);
    assert.equal(results.locations, 2, 'both fixes past 90 days go, the fresh one stays');
    assert.equal(await count('trip_locations'), 1);

    assert.equal(results.notifications, 2);
    assert.equal(await count('notifications'), 1);

    assert.equal(results.refreshTokens, 1, 'the token created 60 days ago goes');
    assert.equal(await count('refresh_tokens'), 1);

    assert.equal(results.auditLogs, 1);
    assert.equal(await count('audit_logs'), 1);

    assert.equal(results.emergencies, 1, 'only the RESOLVED-and-ancient event goes');
    assert.equal(await count('emergency_events'), 1, 'the OPEN event survives regardless of age');

    assert.equal(results.idempotencyKeys, 1);
    assert.equal(await count('idempotency_keys'), 1);
  });

  it('is idempotent — a second pass finds nothing to delete', async () => {
    const results = await worker.runAll();
    assert.equal(results.skipped, false);
    assert.equal(results.locations, 0);
    assert.equal(results.notifications, 0);
    assert.equal(results.refreshTokens, 0);
    assert.equal(results.auditLogs, 0);
    assert.equal(results.emergencies, 0);
    assert.equal(results.idempotencyKeys, 0);
  });

  it('skips the whole pass while another worker holds the advisory lock', async () => {
    // Simulate a second deployment instance: hold the worker's lock on a
    // dedicated client (its own session, exactly like another process), then
    // run — the pass must be a no-op. The lock must NOT be taken through the
    // pool itself: the pool would hand the lock-holding connection back to
    // the worker's transaction, which is re-entrant on the same session.
    const lockKey = 9876543210;
    const holder = new Client({
      host: process.env.DB_HOST,
      port: Number.parseInt(process.env.DB_PORT ?? '5432', 10),
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
    await holder.connect();
    try {
      await holder.query(`SELECT pg_advisory_lock(${lockKey})`);
      const results = await worker.runAll();
      assert.deepEqual(results, { skipped: true });
      // Nothing was deleted while the lock was held elsewhere.
      assert.equal(await count('trip_locations'), 1);
    } finally {
      await holder.query(`SELECT pg_advisory_unlock(${lockKey})`);
      await holder.end();
    }

    // And after the lock is released the worker can run again.
    const results = await worker.runAll();
    assert.equal(results.skipped, false);
  });
});
