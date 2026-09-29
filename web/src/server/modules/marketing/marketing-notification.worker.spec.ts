import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  MarketingErrorCategory,
  MarketingLeadEventType,
  MarketingNotificationJobStatus,
  MarketingNotificationJobType,
} from '@school-bus-tracking/shared-types';
import {
  MarketingNotificationWorker,
  marketingNotificationBackoffMs,
  DEFAULT_MARKETING_NOTIFICATION_POLICY,
  MARKETING_NOTIFICATION_MAX_BACKOFF_MS,
  type MarketingNotificationPolicy,
} from './marketing-notification.worker';
import type { MarketingLeadNotificationOutcome } from './marketing-lead-notifications';

/**
 * The durable admin-notification queue, driven against an in-memory
 * stand-in for PostgreSQL.
 *
 * The fake reproduces the *semantics the worker relies on* rather than the
 * SQL text: a single-statement claim that leases rows to one worker, an
 * advisory lock that serializes concurrent claims, conditional outcome
 * writes that only match while this worker still holds the lease, and leases
 * that expire. Those semantics are what make the queue restart-safe and
 * duplicate-proof; the integration suite proves the SQL itself runs.
 *
 * What is pinned here is the promise made to the business: a demo request is
 * never silently lost, and an admin is never emailed twice for one lead.
 */

const LEAD_ID = 'lead-0000-0000-4000-8000-000000000001';

const POLICY: MarketingNotificationPolicy = {
  batchSize: 10,
  maxAttempts: 3,
  retryBaseMs: 1_000,
  expiryMs: 24 * 60 * 60 * 1000,
  leaseMs: 60_000,
};

interface JobRow {
  id: string;
  job_type: string;
  lead_id: string | null;
  status: string;
  attempts: number;
  next_attempt_at: Date | null;
  locked_by: string | null;
  lease_expires_at: Date | null;
  last_error_category: string | null;
  provider_message_id: string | null;
  sent_at: Date | null;
  created_at: Date;
}

let sequence = 0;
function job(overrides: Partial<JobRow> = {}): JobRow {
  sequence += 1;
  // The fixture's reference moment: an overridden `created_at` (the tests that
  // inject a fixed `now` pin it) or the real clock. `next_attempt_at` derives
  // from it — a real-clock default would land *after* an injected `now` once
  // the wall clock passes the fixture's date, making the job unclaimable and
  // the suite permanently red (the time bomb this fixes; the fixed dates in
  // this file are 2026-09-28/29, and CI went red once the clock passed them).
  const created = overrides.created_at ?? new Date(Date.now() - 1000);
  return {
    id: `job-${sequence}`,
    job_type: MarketingNotificationJobType.LEAD_ADMIN_NOTIFICATION,
    lead_id: LEAD_ID,
    status: MarketingNotificationJobStatus.PENDING,
    attempts: 0,
    next_attempt_at: new Date(created.getTime() - 1000),
    locked_by: null,
    lease_expires_at: null,
    last_error_category: null,
    provider_message_id: null,
    sent_at: null,
    created_at: created,
    ...overrides,
  };
}

interface Database {
  jobs: JobRow[];
  leads: Array<Record<string, unknown>>;
  leadEvents: Array<Record<string, unknown>>;
  /** Shared advisory-lock state, so two workers can contend over it. */
  lock: { held: boolean; denied: number };
}

function database(jobs: JobRow[], leads?: Array<Record<string, unknown>>): Database {
  return {
    jobs,
    leads: leads ?? [{ id: LEAD_ID, full_name: 'Asha Verma', admin_notified_at: null }],
    leadEvents: [],
    lock: { held: false, denied: 0 },
  };
}

interface WorkerOptions {
  outcomes?: MarketingLeadNotificationOutcome[];
  policy?: Partial<MarketingNotificationPolicy>;
  now?: () => Date;
  /** Simulates a lease stolen mid-send by another worker. */
  onSend?: (db: Database) => void;
  failQueries?: boolean;
}

const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([key, value]) => {
    if (Array.isArray(value)) return value.includes(row[key]);
    if (value === null) return row[key] === null || row[key] === undefined;
    return row[key] === value;
  });

function makeWorker(db: Database, options: WorkerOptions = {}) {
  const sends: Array<{ leadId: string }> = [];
  const outcomes = [...(options.outcomes ?? [])];
  const now = options.now ?? (() => new Date());

  const jobsModel = {
    async update(values: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
      let affected = 0;
      for (const row of db.jobs) {
        if (matches(row as unknown as Record<string, unknown>, opts.where)) {
          Object.assign(row, values);
          affected += 1;
        }
      }
      return [affected];
    },
  };

  const leadsModel = {
    async findOne(opts: { where: Record<string, unknown> }) {
      return db.leads.find((row) => matches(row, opts.where)) ?? null;
    },
    async update(values: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
      let affected = 0;
      for (const row of db.leads) {
        if (matches(row, opts.where)) {
          Object.assign(row, values);
          affected += 1;
        }
      }
      return [affected];
    },
  };

  const leadEventsModel = {
    async create(values: Record<string, unknown>) {
      db.leadEvents.push(values);
      return values;
    },
  };

  const query = async (sql: string, opts: { replacements?: Record<string, unknown> } = {}) => {
    if (options.failQueries) {
      throw new Error('connection terminated');
    }
    const replacements = opts.replacements ?? {};

    if (sql.includes('pg_try_advisory_xact_lock')) {
      if (db.lock.held) {
        db.lock.denied += 1;
        return [{ locked: false }];
      }
      db.lock.held = true;
      return [{ locked: true }];
    }

    if (sql.includes('UPDATE marketing_notification_jobs')) {
      const at = now().getTime();
      const claimable = replacements.claimable as string[];
      const processing = replacements.processing as string;
      const limit = replacements.limit as number;
      const eligible = db.jobs
        .filter((row) => {
          const statusEligible =
            claimable.includes(row.status) ||
            (row.status === processing &&
              row.lease_expires_at !== null &&
              row.lease_expires_at.getTime() < at);
          if (!statusEligible) return false;
          return row.next_attempt_at === null || row.next_attempt_at.getTime() <= at;
        })
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .slice(0, limit);

      for (const row of eligible) {
        row.status = processing;
        row.locked_by = replacements.workerId as string;
        row.lease_expires_at = new Date(at + (replacements.leaseMs as number));
      }
      return eligible.map((row) => ({
        id: row.id,
        job_type: row.job_type,
        lead_id: row.lead_id,
        attempts: row.attempts,
        created_at: row.created_at,
      }));
    }

    return [];
  };

  const sequelize = {
    query,
    async transaction<T>(callback: (transaction: unknown) => Promise<T>): Promise<T> {
      try {
        return await callback({ id: 'tx' });
      } finally {
        // An advisory *xact* lock is released when the transaction ends.
        db.lock.held = false;
      }
    },
  };

  const worker = new MarketingNotificationWorker({
    jobs: jobsModel as never,
    leads: leadsModel as never,
    leadEvents: leadEventsModel as never,
    notifications: {
      async sendOnce(lead: { id: string }) {
        sends.push({ leadId: lead.id });
        options.onSend?.(db);
        return (
          outcomes.shift() ?? {
            sent: true,
            retryable: false,
            category: null,
            providerMessageId: 'mid-1',
          }
        );
      },
    } as never,
    sequelize: sequelize as never,
    policy: { ...POLICY, ...(options.policy ?? {}) },
    random: () => 0.5,
    now,
  });

  return { worker, sends, db };
}

const ok = (): MarketingLeadNotificationOutcome => ({
  sent: true,
  retryable: false,
  category: null,
  providerMessageId: 'mid-ok',
});
const transient = (): MarketingLeadNotificationOutcome => ({
  sent: false,
  retryable: true,
  category: MarketingErrorCategory.TRANSIENT,
  providerMessageId: null,
});
const permanent = (): MarketingLeadNotificationOutcome => ({
  sent: false,
  retryable: false,
  category: MarketingErrorCategory.PERMANENT,
  providerMessageId: null,
});

describe('MarketingNotificationWorker — happy path', () => {
  it('claims, sends once, marks the job SENT and records ADMIN_NOTIFIED', async () => {
    const db = database([job()]);
    const { worker, sends } = makeWorker(db, { outcomes: [ok()] });

    const summary = await worker.runOnce();

    assert.equal(summary.claimed, 1);
    assert.equal(summary.sent, 1);
    assert.equal(sends.length, 1);
    const row = db.jobs[0];
    assert.equal(row.status, MarketingNotificationJobStatus.SENT);
    assert.equal(row.attempts, 1);
    assert.equal(row.locked_by, null, 'the lease is released');
    assert.equal(row.provider_message_id, 'mid-ok');
    assert.ok(row.sent_at instanceof Date);
    assert.equal(db.leads[0].admin_notified_at instanceof Date, true);
    assert.equal(db.leadEvents[0].event_type, MarketingLeadEventType.ADMIN_NOTIFIED);
    assert.equal(db.leadEvents[0].actor, 'system');
  });

  it('a second sweep finds nothing — a SENT job is never re-sent', async () => {
    const db = database([job()]);
    const { worker, sends } = makeWorker(db, { outcomes: [ok()] });

    await worker.runOnce();
    const second = await worker.runOnce();

    assert.equal(second.claimed, 0);
    assert.equal(sends.length, 1, 'exactly one email for one lead');
  });
});

describe('MarketingNotificationWorker — retries and permanent failure', () => {
  it('schedules a backed-off retry after a transient failure, without touching the lead', async () => {
    const at = new Date('2026-09-28T10:00:00.000Z');
    const db = database([job({ created_at: at })]);
    const { worker } = makeWorker(db, { outcomes: [transient()], now: () => at });

    const summary = await worker.runOnce();

    assert.equal(summary.retrying, 1);
    const row = db.jobs[0];
    assert.equal(row.status, MarketingNotificationJobStatus.RETRYING);
    assert.equal(row.attempts, 1);
    assert.equal(row.last_error_category, MarketingErrorCategory.TRANSIENT);
    assert.ok(
      row.next_attempt_at !== null && row.next_attempt_at.getTime() > at.getTime(),
      'the retry is scheduled in the future',
    );
    assert.equal(row.locked_by, null, 'a retrying job holds no lease');
    assert.equal(db.leads[0].admin_notified_at, null, 'the lead is untouched by a failed send');
    assert.equal(db.leadEvents.length, 0, 'no premature failure event while retries remain');
  });

  it('retries across sweeps and stops at maxAttempts with ADMIN_NOTIFY_FAILED', async () => {
    let clock = new Date('2026-09-28T10:00:00.000Z').getTime();
    const db = database([job({ created_at: new Date(clock) })]);
    const { worker, sends } = makeWorker(db, {
      outcomes: [transient(), transient(), transient(), transient()],
      now: () => new Date(clock),
    });

    for (let i = 0; i < 4; i += 1) {
      await worker.runOnce();
      clock += 60 * 60 * 1000 > POLICY.expiryMs ? 0 : 20 * 60 * 1000;
    }

    assert.equal(sends.length, POLICY.maxAttempts, 'attempts are bounded');
    const row = db.jobs[0];
    assert.equal(row.status, MarketingNotificationJobStatus.FAILED);
    assert.equal(row.attempts, POLICY.maxAttempts);
    const failure = db.leadEvents.at(-1) as Record<string, unknown>;
    assert.equal(failure.event_type, MarketingLeadEventType.ADMIN_NOTIFY_FAILED);
    const metadata = failure.metadata as Record<string, unknown>;
    assert.equal(metadata.category, MarketingErrorCategory.TRANSIENT);
    assert.ok(!JSON.stringify(failure).includes('@'), 'no address in the timeline metadata');
  });

  it('does not retry a permanent rejection', async () => {
    const db = database([job()]);
    const { worker, sends } = makeWorker(db, { outcomes: [permanent()] });

    const summary = await worker.runOnce();

    assert.equal(summary.failed, 1);
    assert.equal(sends.length, 1, 'a permanent rejection is not retried');
    assert.equal(db.jobs[0].status, MarketingNotificationJobStatus.FAILED);
    assert.equal(db.jobs[0].last_error_category, MarketingErrorCategory.PERMANENT);
  });

  it('expires a job older than the window instead of retrying forever', async () => {
    const at = new Date('2026-09-29T10:00:00.000Z');
    const db = database([
      job({ created_at: new Date(at.getTime() - POLICY.expiryMs - 1000), attempts: 1 }),
    ]);
    const { worker, sends } = makeWorker(db, { now: () => at });

    const summary = await worker.runOnce();

    assert.equal(summary.expired, 1);
    assert.equal(sends.length, 0, 'an expired job sends nothing');
    assert.equal(db.jobs[0].status, MarketingNotificationJobStatus.EXPIRED);
    assert.equal(
      (db.leadEvents[0] as Record<string, unknown>).event_type,
      MarketingLeadEventType.ADMIN_NOTIFY_FAILED,
    );
  });

  it('closes a job whose lead no longer exists (erased) without sending', async () => {
    const db = database([job()], []);
    const { worker, sends } = makeWorker(db);

    const summary = await worker.runOnce();

    assert.equal(sends.length, 0);
    assert.equal(summary.failed, 1);
    assert.equal(db.jobs[0].status, MarketingNotificationJobStatus.FAILED);
  });
});

describe('MarketingNotificationWorker — durability', () => {
  it('recovers a job abandoned by a crashed worker once its lease expires', async () => {
    const at = new Date('2026-09-28T10:00:00.000Z');
    const abandoned = job({
      status: MarketingNotificationJobStatus.PROCESSING,
      locked_by: 'dead-worker',
      lease_expires_at: new Date(at.getTime() - 1),
      attempts: 1,
      created_at: at,
    });
    const db = database([abandoned]);
    const { worker, sends } = makeWorker(db, { outcomes: [ok()], now: () => at });

    const summary = await worker.runOnce();

    assert.equal(summary.claimed, 1, 'an expired lease is reclaimable');
    assert.equal(sends.length, 1);
    assert.equal(db.jobs[0].status, MarketingNotificationJobStatus.SENT);
    assert.notEqual(db.jobs[0].locked_by, 'dead-worker');
  });

  it('leaves a freshly leased job alone (no double send while a worker is mid-flight)', async () => {
    const at = new Date('2026-09-28T10:00:00.000Z');
    const db = database([
      job({
        status: MarketingNotificationJobStatus.PROCESSING,
        locked_by: 'busy-worker',
        lease_expires_at: new Date(at.getTime() + 30_000),
        created_at: at,
      }),
    ]);
    const { worker, sends } = makeWorker(db, { now: () => at });

    const summary = await worker.runOnce();

    assert.equal(summary.claimed, 0);
    assert.equal(sends.length, 0);
  });

  it('two workers sweeping the same queue send each notification exactly once', async () => {
    const jobs = Array.from({ length: 6 }, () => job());
    const db = database(jobs, jobs.map((row) => ({ id: row.lead_id, admin_notified_at: null })));
    // Each worker gets its own identity but shares the database and the
    // advisory-lock state — the real deployment shape.
    const a = makeWorker(db);
    const b = makeWorker(db);

    const [first, second] = await Promise.all([a.worker.runOnce(), b.worker.runOnce()]);

    const totalSends = a.sends.length + b.sends.length;
    assert.equal(first.claimed + second.claimed, totalSends);
    assert.equal(totalSends, 6, 'every job is sent');
    const ids = [...a.sends, ...b.sends].map((send) => send.leadId);
    assert.equal(new Set(db.jobs.map((row) => row.id)).size, 6);
    assert.equal(ids.length, 6, 'and none of them twice');
    for (const row of db.jobs) {
      assert.equal(row.status, MarketingNotificationJobStatus.SENT);
    }
  });

  it('a worker that lost its lease mid-send does not overwrite the winner s outcome', async () => {
    const db = database([job()]);
    const { worker, sends } = makeWorker(db, {
      outcomes: [ok()],
      onSend: (state) => {
        // While this worker is talking to SMTP, another instance reclaims
        // the expired lease and finishes the job.
        state.jobs[0].status = MarketingNotificationJobStatus.SENT;
        state.jobs[0].locked_by = null;
        state.jobs[0].attempts = 1;
        state.jobs[0].provider_message_id = 'other-worker';
      },
    });

    const summary = await worker.runOnce();

    assert.equal(sends.length, 1);
    assert.equal(summary.sent, 0, 'the losing worker records nothing');
    assert.equal(db.jobs[0].provider_message_id, 'other-worker');
    assert.equal(db.leadEvents.length, 0, 'and writes no duplicate timeline event');
  });

  it('survives a restart: the queue, not memory, holds the work', async () => {
    const db = database([job()]);
    // First process claims the job and dies before recording an outcome.
    const first = makeWorker(db, { outcomes: [transient()] });
    const at = Date.now();
    db.jobs[0].status = MarketingNotificationJobStatus.PROCESSING;
    db.jobs[0].locked_by = 'crashed';
    db.jobs[0].lease_expires_at = new Date(at - 1);

    // A brand-new process starts with empty memory and still delivers.
    const second = makeWorker(db, { outcomes: [ok()] });
    const summary = await second.worker.runOnce();

    assert.equal(first.sends.length, 0);
    assert.equal(summary.sent, 1);
    assert.equal(db.jobs[0].status, MarketingNotificationJobStatus.SENT);
  });

  it('stops claiming after shutdown and never throws on a dead connection', async () => {
    const db = database([job()]);
    const { worker, sends } = makeWorker(db);
    worker.shutdown();

    const summary = await worker.runOnce();
    assert.equal(summary.skipped, true);
    assert.equal(sends.length, 0);

    const broken = makeWorker(database([job()]), { failQueries: true });
    const failed = await broken.worker.runOnce();
    assert.equal(failed.fatalError, true, 'a dead database is reported, not thrown');
    assert.equal(failed.sent, 0);
  });

  it('does nothing at all without a database connection', async () => {
    const worker = new MarketingNotificationWorker({
      jobs: {} as never,
      leads: {} as never,
      leadEvents: {} as never,
      notifications: { sendOnce: async () => ok() } as never,
      sequelize: null,
    });
    const summary = await worker.runOnce();
    assert.equal(summary.skipped, true);
    assert.equal(summary.claimed, 0);
  });
});

describe('marketingNotificationBackoffMs', () => {
  it('grows exponentially, stays capped and always carries jitter', () => {
    const policy = DEFAULT_MARKETING_NOTIFICATION_POLICY;
    const first = marketingNotificationBackoffMs(1, policy, () => 0);
    const second = marketingNotificationBackoffMs(2, policy, () => 0);
    const third = marketingNotificationBackoffMs(3, policy, () => 0);

    assert.equal(first, policy.retryBaseMs);
    assert.equal(second, policy.retryBaseMs * 2);
    assert.equal(third, policy.retryBaseMs * 4);

    const far = marketingNotificationBackoffMs(20, policy, () => 0);
    assert.equal(far, MARKETING_NOTIFICATION_MAX_BACKOFF_MS, 'a dead relay still retries hourly');

    const jittered = marketingNotificationBackoffMs(1, policy, () => 0.99);
    assert.ok(jittered > first, 'workers do not retry in lock-step');
  });
});
