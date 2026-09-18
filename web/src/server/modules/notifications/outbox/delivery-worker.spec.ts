import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Sequelize } from 'sequelize-typescript';
import type { Transaction } from 'sequelize';
import { Op } from 'sequelize';
import { NotificationType, TripStatus } from '@school-bus-tracking/shared-types';
import { DeliveryWorker } from './delivery-worker';
import type {
  DeviceDeliveryOutcome,
  PushDeliveryResult,
  PushNotificationProvider,
} from '../providers';

const POLICY = {
  maxAttempts: 8,
  baseBackoffMs: 2000,
  expiryMs: 600_000,
  batchSize: 50,
};

interface WorkerRow {
  id: string;
  school_id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  trip_id: string | null;
  student_id: string | null;
  stop_id: string | null;
  push_status: string;
  delivery_retry_count: number;
  delivery_failure_reason: string | null;
  delivery_failure_kind: string | null;
  delivery_abandoned_reason: string | null;
  last_delivery_attempt_at: Date | null;
  next_attempt_at: Date | null;
  push_expires_at: Date | null;
  delivered_tokens: string[] | null;
  update: (
    values: Record<string, unknown>,
    options?: { transaction?: Transaction },
  ) => Promise<WorkerRow>;
}

function makeRow(overrides: Partial<WorkerRow> = {}): WorkerRow {
  const base: WorkerRow = {
    id: 'n1',
    school_id: 's1',
    user_id: 'u1',
    type: NotificationType.STUDENT_BOARDED,
    title: 'Aarav boarded',
    message: 'Aarav boarded the bus.',
    trip_id: 't1',
    student_id: 'st1',
    stop_id: null,
    push_status: 'pending',
    delivery_retry_count: 0,
    delivery_failure_reason: null,
    delivery_failure_kind: null,
    delivery_abandoned_reason: null,
    last_delivery_attempt_at: null,
    // Due now (the worker compares against the real clock), future expiry.
    next_attempt_at: new Date(Date.now() - 1_000),
    push_expires_at: new Date(Date.now() + 600_000),
    delivered_tokens: null,
    update: async () => base,
  };
  const row = { ...base, ...overrides };
  row.update = async (values, _options) => {
    Object.assign(row, values);
    return row;
  };
  return row;
}

class FakeDeviceTokens {
  targets: Array<{ token: string; platform: 'android' | 'ios' | null }> = [];
  deactivated: string[] = [];
  async findActiveTokenTargets(): Promise<
    Array<{ token: string; platform: 'android' | 'ios' | null }>
  > {
    return [...this.targets];
  }
  async deactivateTokens(_s: string, _u: string, tokens: string[]): Promise<void> {
    this.deactivated.push(...tokens);
  }
}

class FakePush implements PushNotificationProvider {
  readonly isConfigured = true;
  readonly name = 'fake';
  readonly sentPayloads: unknown[] = [];
  result: PushDeliveryResult | Error = {
    success: true,
    provider: 'fcm',
    retryable: false,
    deviceOutcome: { delivered: [], retryable: [], invalid: [], notConfigured: [] },
  };
  async send(payload: unknown): Promise<PushDeliveryResult> {
    this.sentPayloads.push(payload);
    if (this.result instanceof Error) {
      throw this.result;
    }
    // Deliver the provided tokens as accepted unless the test set an
    // explicit per-device outcome (delivered/retryable/invalid set).
    const tokens = (payload as { deviceTokens: string[] }).deviceTokens;
    const outcome = this.result.deviceOutcome;
    if (
      outcome &&
      outcome.delivered.length === 0 &&
      outcome.retryable.length === 0 &&
      outcome.invalid.length === 0 &&
      outcome.notConfigured.length === 0
    ) {
      return {
        success: true,
        provider: this.name,
        retryable: false,
        deviceOutcome: { delivered: [...tokens], retryable: [], invalid: [], notConfigured: [] },
      };
    }
    return this.result;
  }
  async sendBatch(payloads: unknown[]): Promise<PushDeliveryResult[]> {
    const out: PushDeliveryResult[] = [];
    for (const p of payloads) {
      out.push(await this.send(p));
    }
    return out;
  }
}

interface SequelizeMockOptions {
  lockAcquired?: boolean;
  rows?: WorkerRow[];
  tripStatus?: TripStatus | null;
}

function makeSequelize(options: SequelizeMockOptions = {}) {
  const queries: Array<{ sql: string; options?: { transaction?: Transaction } }> = [];
  const rows = options.rows ?? [];
  let committed = false;

  const transaction = {
    commit: async () => {
      committed = true;
    },
    rollback: async () => undefined,
  } as unknown as Transaction;

  const sequelize = {
    queries,
    committed: () => committed,
    async query(sql: string, opts: { transaction?: Transaction } = {}) {
      queries.push({ sql, options: opts });
      if (sql.includes('pg_try_advisory_xact_lock')) {
        return [{ locked: options.lockAcquired ?? true }];
      }
      if (sql.includes('SELECT DISTINCT school_id')) {
        return rows.length > 0 ? [{ school_id: rows[0].school_id }] : [];
      }
      return [];
    },
    async transaction<T>(callback: (t: Transaction) => Promise<T>): Promise<T> {
      try {
        const value = await callback(transaction);
        await transaction.commit();
        return value;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    },
  } as unknown as Sequelize & { queries: unknown[]; committed: () => boolean };

  const notifications = {
    async findAll(opts: {
      where?: Record<string, unknown>;
      limit?: number;
      transaction?: Transaction;
    }): Promise<WorkerRow[]> {
      // Emulate the worker's due-row predicate so a processed row is not
      // re-claimed by the next batch loop: status pending|failed AND
      // next_attempt_at <= now.
      const where = opts.where ?? {};
      return rows.filter((row) => {
        const statusIn = (where.push_status as { [Op.in]: string[] } | undefined)?.[Op.in];
        if (statusIn && !statusIn.includes(row.push_status)) {
          return false;
        }
        const due = where.next_attempt_at as { [Op.lte]: Date } | undefined;
        if (row.next_attempt_at === null) {
          return false;
        }
        if (due && row.next_attempt_at.getTime() > due[Op.lte].getTime()) {
          return false;
        }
        return true;
      });
    },
  };

  const trips = {
    async findOne(opts: {
      where?: Record<string, unknown>;
    }): Promise<{ status: TripStatus } | null> {
      void opts;
      return options.tripStatus === undefined
        ? null
        : options.tripStatus === null
          ? null
          : { status: options.tripStatus };
    },
  };

  return { sequelize, notifications, trips, queries };
}

function makeWorker(
  options: SequelizeMockOptions = {},
  push = new FakePush(),
  devices = new FakeDeviceTokens(),
) {
  const db = makeSequelize(options);
  const worker = new DeliveryWorker(
    db.notifications as never,
    db.trips as never,
    devices as never,
    push,
    db.sequelize,
    POLICY,
  );
  return { worker, db, push, devices };
}

describe('DeliveryWorker.runOnce', () => {
  it('skips cleanly without a database connection', async () => {
    const devices = new FakeDeviceTokens();
    const worker = new DeliveryWorker(
      {} as never,
      {} as never,
      devices as never,
      new FakePush(),
      null,
      POLICY,
    );
    const summary = await worker.runOnce();
    assert.deepEqual(summary, { skipped: true, claimed: 0, sent: 0, failed: 0, abandoned: 0 });
  });

  it('claims a due row, sends through the provider and records sent', async () => {
    const row = makeRow();
    const pushed = new FakePush();
    const devices = new FakeDeviceTokens();
    devices.targets = [{ token: 'tok-a', platform: 'android' }];
    const { worker } = makeWorker({ rows: [row] }, pushed, devices);

    const summary = await worker.runOnce();

    assert.equal(summary.skipped, false);
    assert.equal(summary.claimed, 1);
    assert.equal(summary.sent, 1);
    assert.equal(summary.failed, 0);
    assert.equal(summary.abandoned, 0);
    assert.equal(pushed.sentPayloads.length, 1);
    assert.equal(row.push_status, 'sent');
    assert.equal(row.delivery_failure_reason, null);
    assert.equal(row.next_attempt_at, null);
  });

  it('does not claim rows when another instance holds the advisory lock', async () => {
    const row = makeRow();
    const pushed = new FakePush();
    const devices = new FakeDeviceTokens();
    devices.targets = [{ token: 'tok-a', platform: 'android' }];
    const { worker } = makeWorker({ rows: [row], lockAcquired: false }, pushed, devices);

    const summary = await worker.runOnce();

    assert.equal(summary.claimed, 0);
    assert.equal(pushed.sentPayloads.length, 0, 'a locked school must not deliver');
    assert.equal(row.push_status, 'pending');
  });

  it('abandons an expired row without ever sending', async () => {
    const row = makeRow({ push_expires_at: new Date(Date.now() - 1) });
    const pushed = new FakePush();
    const devices = new FakeDeviceTokens();
    devices.targets = [{ token: 'tok-a', platform: 'android' }];
    const { worker } = makeWorker({ rows: [row] }, pushed, devices);

    const summary = await worker.runOnce();

    assert.equal(summary.abandoned, 1);
    assert.equal(pushed.sentPayloads.length, 0, 'expired rows must never be sent');
    assert.equal(row.push_status, 'failed');
    assert.match(String(row.delivery_abandoned_reason), /Expired/);
  });

  it('abandons a stop-arrival proximity alert once the trip is no longer tracking', async () => {
    const row = makeRow({
      type: NotificationType.STOP_ARRIVED,
      trip_id: 't1',
      push_expires_at: null,
    });
    const pushed = new FakePush();
    const devices = new FakeDeviceTokens();
    devices.targets = [{ token: 'tok-a', platform: 'android' }];
    const { worker } = makeWorker(
      { rows: [row], tripStatus: TripStatus.COMPLETED },
      pushed,
      devices,
    );

    const summary = await worker.runOnce();

    assert.equal(summary.abandoned, 1);
    assert.equal(pushed.sentPayloads.length, 0);
    assert.match(String(row.delivery_abandoned_reason), /Trip/);
  });

  it('backs off a transient failure with the retry count and next attempt', async () => {
    const row = makeRow();
    const pushed = new FakePush();
    pushed.result = {
      success: false,
      provider: 'fcm',
      retryable: true,
      deviceOutcome: { delivered: [], retryable: ['tok-a'], invalid: [], notConfigured: [] },
    };
    const devices = new FakeDeviceTokens();
    devices.targets = [{ token: 'tok-a', platform: 'android' }];
    const { worker } = makeWorker({ rows: [row] }, pushed, devices);

    const summary = await worker.runOnce();

    assert.equal(summary.failed, 1);
    assert.equal(row.push_status, 'failed');
    assert.equal(row.delivery_retry_count, 1);
    assert.equal(row.delivery_failure_kind, 'transient');
    assert.ok(row.next_attempt_at && row.next_attempt_at.getTime() > Date.now());
  });

  it('retires invalid tokens and abandons the row permanently', async () => {
    const row = makeRow();
    const pushed = new FakePush();
    pushed.result = {
      success: false,
      provider: 'fcm',
      retryable: false,
      invalidTokens: ['tok-stale'],
      deviceOutcome: { delivered: [], retryable: [], invalid: ['tok-stale'], notConfigured: [] },
    };
    const devices = new FakeDeviceTokens();
    devices.targets = [{ token: 'tok-stale', platform: 'android' }];
    const { worker } = makeWorker({ rows: [row] }, pushed, devices);

    const summary = await worker.runOnce();

    assert.equal(summary.abandoned, 1);
    assert.deepEqual(devices.deactivated, ['tok-stale']);
    assert.equal(row.push_status, 'failed');
    assert.match(String(row.delivery_abandoned_reason), /rejected/);
    assert.equal(row.next_attempt_at, null);
  });

  it('records partial success: one accepted device leaves the row sent with delivered tokens', async () => {
    const row = makeRow();
    const pushed = new FakePush();
    pushed.result = {
      success: true,
      provider: 'fcm',
      retryable: false,
      invalidTokens: ['tok-stale'],
      deviceOutcome: {
        delivered: ['tok-good'],
        retryable: [],
        invalid: ['tok-stale'],
        notConfigured: [],
      } as DeviceDeliveryOutcome,
    };
    const devices = new FakeDeviceTokens();
    devices.targets = [
      { token: 'tok-good', platform: 'android' },
      { token: 'tok-stale', platform: 'android' },
    ];
    const { worker } = makeWorker({ rows: [row] }, pushed, devices);

    const summary = await worker.runOnce();

    assert.equal(summary.sent, 1);
    assert.deepEqual(devices.deactivated, ['tok-stale']);
    assert.equal(row.push_status, 'sent');
    assert.deepEqual(row.delivered_tokens, ['tok-good'], 'accepted devices only');
  });

  it('never throws out of a sweep when the provider throws', async () => {
    const row = makeRow();
    const pushed = new FakePush();
    pushed.result = new Error('boom');
    const devices = new FakeDeviceTokens();
    devices.targets = [{ token: 'tok-a', platform: 'android' }];
    const { worker } = makeWorker({ rows: [row] }, pushed, devices);

    const summary = await worker.runOnce();

    assert.equal(summary.failed, 1);
    assert.equal(row.push_status, 'failed');
    assert.equal(row.delivery_failure_kind, 'transient');
  });
});
