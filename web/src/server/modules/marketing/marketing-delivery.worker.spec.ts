import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  MarketingCampaignStatus,
  MarketingErrorCategory,
  MarketingEventType,
  MarketingRecipientStatus,
} from '@school-bus-tracking/shared-types';
import { MarketingDeliveryWorker, type MarketingAlertSink } from './marketing-delivery.worker';
import type { MarketingDeliveryPolicy } from './marketing-delivery.policy';
import { hashMarketingToken, MARKETING_RENDER_VARIABLES } from './marketing-message.builder';
import type { EmailNotificationPayload } from '../notifications/providers/notification-provider.interface';

/**
 * The delivery worker against an in-memory stand-in for PostgreSQL.
 *
 * The fake reproduces the *semantics the worker depends on* — a single-
 * statement claim that flips rows to `PROCESSING` under a lease, conditional
 * updates that only match while this worker still owns the row, and an
 * advisory lock that serializes concurrent claims — because those semantics,
 * not the SQL text, are what prevent a school from being emailed twice. The
 * integration suite (`npm --prefix web run test:integration`) proves the SQL
 * itself runs on a real database.
 */

// --------------------------------------------------------------- test data

const CAMPAIGN_ID = 'c0000000-0000-4000-8000-000000000001';
const VERSION_ID = 'v0000000-0000-4000-8000-000000000001';
const APP_URL = 'https://app.zeromilesystems.test';

const POLICY: MarketingDeliveryPolicy = {
  batchSize: 10,
  maxAttempts: 3,
  retryBaseMs: 1000,
  ratePerMinute: 100,
  concurrency: 2,
  sendDelayMs: 0,
  sendJitterMs: 0,
  expiryMs: 72 * 60 * 60 * 1000,
  leaseMs: 120_000,
};

interface RecipientRow {
  id: string;
  campaign_id: string;
  school_id: string | null;
  school_name: string | null;
  normalized_email: string;
  recipient_name: string | null;
  status: string;
  attempts: number;
  next_attempt_at: Date | null;
  locked_by: string | null;
  lease_expires_at: Date | null;
  last_attempt_at: Date | null;
  last_error_category: string | null;
  sent_at: Date | null;
  provider_message_id: string | null;
  click_token_hash: string | null;
  unsubscribe_token_hash: string | null;
  click_count: number;
  first_clicked_at: Date | null;
  unsubscribed_at: Date | null;
  created_at: Date;
}

interface CampaignRow {
  id: string;
  status: MarketingCampaignStatus;
  template_version_id: string;
  scheduled_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  deleted_at: Date | null;
  [counter: string]: unknown;
}

let sequence = 0;
function recipient(overrides: Partial<RecipientRow> = {}): RecipientRow {
  sequence += 1;
  return {
    id: `r000000${sequence}-0000-4000-8000-000000000001`,
    campaign_id: CAMPAIGN_ID,
    school_id: 's0000000-0000-4000-8000-000000000001',
    school_name: 'Sunrise Public School',
    normalized_email: `principal${sequence}@school.test`,
    recipient_name: 'Asha Rao',
    status: MarketingRecipientStatus.PENDING,
    attempts: 0,
    next_attempt_at: null,
    locked_by: null,
    lease_expires_at: null,
    last_attempt_at: null,
    last_error_category: null,
    sent_at: null,
    provider_message_id: null,
    click_token_hash: null,
    unsubscribe_token_hash: null,
    click_count: 0,
    first_clicked_at: null,
    unsubscribed_at: null,
    created_at: new Date(Date.now() + sequence),
    ...overrides,
  };
}

function campaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: CAMPAIGN_ID,
    status: MarketingCampaignStatus.SCHEDULED,
    template_version_id: VERSION_ID,
    scheduled_at: new Date(Date.now() - 1000),
    started_at: null,
    completed_at: null,
    deleted_at: null,
    ...overrides,
  };
}

const VERSION = {
  id: VERSION_ID,
  subject: 'News for {{school_name}}',
  html_body: '<p>Hello {{recipient_name}}</p><a href="{{campaign_url}}">Read</a>',
  text_body: 'Hello {{recipient_name}} — {{campaign_url}}',
  allowed_variables: MARKETING_RENDER_VARIABLES.map((name) => ({ name, required: false })),
};

// ------------------------------------------------------------------ harness

interface SendRecord {
  payload: EmailNotificationPayload;
  at: number;
}

interface HarnessOptions {
  recipients: RecipientRow[];
  campaigns?: CampaignRow[];
  suppressed?: string[];
  policy?: Partial<MarketingDeliveryPolicy>;
  version?: unknown;
  send?: (
    payload: EmailNotificationPayload,
    attempt: number,
  ) => { success: boolean; retryable: boolean; messageId?: string; provider?: string };
  alerts?: MarketingAlertSink;
  failQueries?: boolean;
}

function harness(options: HarnessOptions) {
  const recipients = options.recipients;
  const campaigns = options.campaigns ?? [campaign()];
  const suppressed = new Set(options.suppressed ?? []);
  const events: Array<Record<string, unknown>> = [];
  const sends: SendRecord[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let advisoryHeld = false;
  let advisoryDenied = 0;

  const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (Array.isArray(value)) {
        return value.includes(row[key]);
      }
      if (value === null) {
        return row[key] === null || row[key] === undefined;
      }
      return row[key] === value;
    });

  const recipientsModel = {
    update: async (values: Record<string, unknown>, opts: { where: Record<string, unknown> }) => {
      let affected = 0;
      for (const row of recipients) {
        if (matches(row as unknown as Record<string, unknown>, opts.where)) {
          Object.assign(row, values);
          affected += 1;
        }
      }
      return [affected];
    },
    increment: async (column: string, opts: { where: Record<string, unknown> }) => {
      for (const row of recipients) {
        if (matches(row as unknown as Record<string, unknown>, opts.where)) {
          (row as unknown as Record<string, number>)[column] =
            ((row as unknown as Record<string, number>)[column] ?? 0) + 1;
        }
      }
    },
    findOne: async (opts: { where: Record<string, unknown> }) =>
      recipients.find((row) => matches(row as unknown as Record<string, unknown>, opts.where)) ??
      null,
  };

  const campaignsModel = {
    findOne: async (opts: { where: Record<string, unknown> }) =>
      campaigns.find((row) => matches(row as unknown as Record<string, unknown>, opts.where)) ??
      null,
    update: async (values: Record<string, unknown>, opts: { where: Record<string, unknown> }) => {
      let affected = 0;
      for (const row of campaigns) {
        if (matches(row as unknown as Record<string, unknown>, opts.where)) {
          Object.assign(row, values);
          affected += 1;
        }
      }
      return [affected];
    },
  };

  const query = async (sql: string, opts: { replacements?: Record<string, unknown> } = {}) => {
    if (options.failQueries) {
      throw new Error('connection terminated');
    }
    const replacements = opts.replacements ?? {};

    if (sql.includes('pg_try_advisory_xact_lock')) {
      if (advisoryHeld) {
        advisoryDenied += 1;
        return [{ locked: false }];
      }
      advisoryHeld = true;
      return [{ locked: true }];
    }

    if (sql.includes('UPDATE email_campaign_recipients')) {
      const now = Date.now();
      const deliverable = replacements.deliverableStatuses as string[];
      const claimable = replacements.claimableStatuses as string[];
      const processing = replacements.processing as string;
      const limit = replacements.limit as number;
      const eligible = recipients
        .filter((row) => {
          const parent = campaigns.find((item) => item.id === row.campaign_id);
          if (!parent || parent.deleted_at) {
            return false;
          }
          if (!deliverable.includes(parent.status)) {
            return false;
          }
          if (parent.scheduled_at && parent.scheduled_at.getTime() > now) {
            return false;
          }
          const statusEligible =
            claimable.includes(row.status) ||
            (row.status === processing &&
              row.lease_expires_at !== null &&
              row.lease_expires_at.getTime() < now);
          if (!statusEligible) {
            return false;
          }
          return row.next_attempt_at === null || row.next_attempt_at.getTime() <= now;
        })
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .slice(0, limit);

      for (const row of eligible) {
        row.status = processing;
        row.locked_by = replacements.workerId as string;
        row.lease_expires_at = new Date(now + (replacements.leaseMs as number));
      }
      return eligible.map((row) => ({
        id: row.id,
        campaign_id: row.campaign_id,
        school_id: row.school_id,
        school_name: row.school_name,
        normalized_email: row.normalized_email,
        recipient_name: row.recipient_name,
        attempts: row.attempts,
      }));
    }

    if (sql.includes('GROUP BY status')) {
      const campaignId = replacements.campaignId as string;
      const groups = new Map<
        string,
        { status: string; count: number; clicks: number; unique_clicks: number; unsubscribes: number }
      >();
      for (const row of recipients.filter((item) => item.campaign_id === campaignId)) {
        const group = groups.get(row.status) ?? {
          status: row.status,
          count: 0,
          clicks: 0,
          unique_clicks: 0,
          unsubscribes: 0,
        };
        group.count += 1;
        group.clicks += row.click_count;
        group.unique_clicks += row.first_clicked_at ? 1 : 0;
        group.unsubscribes += row.unsubscribed_at ? 1 : 0;
        groups.set(row.status, group);
      }
      return [...groups.values()];
    }

    if (sql.includes('FROM email_campaigns')) {
      const active = replacements.active as string[];
      const outstanding = replacements.outstanding as string[];
      return campaigns
        .filter(
          (item) =>
            !item.deleted_at &&
            active.includes(item.status) &&
            !recipients.some(
              (row) => row.campaign_id === item.id && outstanding.includes(row.status),
            ),
        )
        .map((item) => ({ id: item.id }));
    }

    return [];
  };

  const sequelize = {
    query,
    transaction: async <T>(callback: (transaction: unknown) => Promise<T>): Promise<T> => {
      try {
        return await callback({ id: 'tx' });
      } finally {
        advisoryHeld = false;
      }
    },
  };

  let attemptCounter = 0;
  const emailProvider = {
    async send(payload: EmailNotificationPayload) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield so overlapping sends are actually observable.
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      attemptCounter += 1;
      sends.push({ payload, at: Date.now() });
      const outcome = options.send?.(payload, attemptCounter) ?? {
        success: true,
        retryable: false,
        messageId: `msg-${attemptCounter}`,
      };
      return {
        success: outcome.success,
        provider: outcome.provider ?? 'smtp',
        messageId: outcome.messageId,
        retryable: outcome.retryable,
      };
    },
  };

  const worker = new MarketingDeliveryWorker({
    campaigns: campaignsModel as never,
    recipients: recipientsModel as never,
    versions: {
      findOne: async () => (options.version === undefined ? VERSION : options.version),
    } as never,
    events: {
      create: async (row: Record<string, unknown>) => {
        events.push(row);
        return row;
      },
    } as never,
    suppressions: {
      findOne: async (opts: { where: { normalized_email: string } }) =>
        suppressed.has(opts.where.normalized_email) ? { id: 'sup' } : null,
    } as never,
    emailProvider: emailProvider as never,
    sequelize: sequelize as never,
    policy: { ...POLICY, ...options.policy },
    appUrl: APP_URL,
    replyTo: 'ops@zeromilesystems.test',
    alerts: options.alerts ?? null,
    random: () => 0.5,
    sleep: async () => undefined,
  });

  return {
    worker,
    recipients,
    campaigns,
    events,
    sends,
    get maxInFlight() {
      return maxInFlight;
    },
    get advisoryDenied() {
      return advisoryDenied;
    },
    holdAdvisoryLock() {
      advisoryHeld = true;
    },
  };
}

// -------------------------------------------------------------------- tests

describe('MarketingDeliveryWorker — claiming', () => {
  it('claims due rows, leases them and sends exactly one message each', async () => {
    const context = harness({ recipients: [recipient(), recipient()] });

    const summary = await context.worker.runOnce();

    assert.equal(summary.claimed, 2);
    assert.equal(summary.sent, 2);
    assert.equal(context.sends.length, 2, 'one message per recipient, never a bulk send');
    for (const row of context.recipients) {
      assert.equal(row.status, MarketingRecipientStatus.SENT);
      assert.equal(row.attempts, 1);
      assert.equal(row.locked_by, null, 'the lease is released with the outcome');
      assert.equal(row.lease_expires_at, null);
      assert.ok(row.sent_at instanceof Date);
      assert.match(String(row.provider_message_id), /^msg-/);
    }
  });

  it('never processes the same recipient twice across sweeps', async () => {
    const context = harness({ recipients: [recipient()] });

    await context.worker.runOnce();
    const second = await context.worker.runOnce();

    assert.equal(second.claimed, 0, 'a SENT row is not PROCESSING, so it can never be re-claimed');
    assert.equal(context.sends.length, 1);
  });

  it('skips the sweep when another instance holds the advisory lock', async () => {
    const context = harness({ recipients: [recipient()] });
    context.holdAdvisoryLock();

    const summary = await context.worker.runOnce();

    assert.equal(summary.claimed, 0);
    assert.equal(context.sends.length, 0, 'two instances must not claim the same head of queue');
    assert.equal(context.advisoryDenied, 1);
  });

  it('honours the batch size', async () => {
    const context = harness({
      recipients: [recipient(), recipient(), recipient(), recipient()],
      policy: { batchSize: 2 },
    });

    const summary = await context.worker.runOnce();

    assert.equal(summary.claimed, 2);
    assert.equal(context.sends.length, 2);
  });

  it('bounds concurrency to the configured number of in-flight sends', async () => {
    const context = harness({
      recipients: Array.from({ length: 6 }, () => recipient()),
      policy: { concurrency: 2 },
    });

    await context.worker.runOnce();

    assert.ok(
      context.maxInFlight <= 2,
      `at most 2 SMTP conversations at once, saw ${context.maxInFlight}`,
    );
  });

  it('stops at the per-minute ceiling and returns the untouched rows to the queue', async () => {
    const context = harness({
      recipients: Array.from({ length: 6 }, () => recipient()),
      policy: { ratePerMinute: 2, concurrency: 1 },
    });

    const summary = await context.worker.runOnce();

    assert.equal(context.sends.length, 2, 'the rate ceiling caps the sweep');
    assert.equal(summary.rateLimited, true);
    const queued = context.recipients.filter(
      (row) => row.status === MarketingRecipientStatus.PENDING,
    );
    assert.equal(queued.length, 4, 'unsent claims go back to the queue, never lost');
    for (const row of queued) {
      assert.equal(row.locked_by, null, 'a released row holds no lease');
    }
  });

  it('does not claim rows whose backoff has not elapsed', async () => {
    const context = harness({
      recipients: [
        recipient({
          status: MarketingRecipientStatus.RETRYING,
          next_attempt_at: new Date(Date.now() + 60_000),
          attempts: 1,
        }),
      ],
    });

    const summary = await context.worker.runOnce();

    assert.equal(summary.claimed, 0);
    assert.equal(context.sends.length, 0);
  });

  it('does not claim rows of a campaign scheduled for the future', async () => {
    const context = harness({
      recipients: [recipient()],
      campaigns: [campaign({ scheduled_at: new Date(Date.now() + 3_600_000) })],
    });

    assert.equal((await context.worker.runOnce()).claimed, 0);
  });
});

describe('MarketingDeliveryWorker — crash and lease recovery', () => {
  it('re-claims a PROCESSING row whose lease expired (the crashed-worker case)', async () => {
    const context = harness({
      recipients: [
        recipient({
          status: MarketingRecipientStatus.PROCESSING,
          locked_by: 'dead-worker',
          lease_expires_at: new Date(Date.now() - 1000),
        }),
      ],
    });

    const summary = await context.worker.runOnce();

    assert.equal(summary.claimed, 1, 'a killed container must not strand a recipient forever');
    assert.equal(context.recipients[0].status, MarketingRecipientStatus.SENT);
  });

  it('leaves a PROCESSING row alone while its lease is live', async () => {
    const context = harness({
      recipients: [
        recipient({
          status: MarketingRecipientStatus.PROCESSING,
          locked_by: 'other-worker',
          lease_expires_at: new Date(Date.now() + 60_000),
        }),
      ],
    });

    assert.equal((await context.worker.runOnce()).claimed, 0);
    assert.equal(context.recipients[0].locked_by, 'other-worker');
  });

  it('does not overwrite an outcome written by the worker that stole the lease', async () => {
    const row = recipient();
    const context = harness({
      recipients: [row],
      send: (payload) => {
        // Simulate the lease expiring mid-send and another instance finishing
        // the row while our SMTP conversation was open.
        assert.ok(payload.to);
        row.status = MarketingRecipientStatus.SENT;
        row.locked_by = 'other-worker';
        row.provider_message_id = 'msg-from-other-worker';
        return { success: true, retryable: false, messageId: 'msg-ours' };
      },
    });

    await context.worker.runOnce();

    assert.equal(
      row.provider_message_id,
      'msg-from-other-worker',
      'the conditional update must match nothing once the lease is lost',
    );
  });
});

describe('MarketingDeliveryWorker — retries and failures', () => {
  it('retries a transient SMTP 4xx with backoff instead of failing', async () => {
    const context = harness({
      recipients: [recipient()],
      send: () => ({ success: false, retryable: true }),
    });

    const summary = await context.worker.runOnce();

    const row = context.recipients[0];
    assert.equal(summary.retrying, 1);
    assert.equal(row.status, MarketingRecipientStatus.RETRYING);
    assert.equal(row.attempts, 1);
    assert.equal(row.last_error_category, MarketingErrorCategory.TRANSIENT);
    assert.ok((row.next_attempt_at as Date).getTime() > Date.now(), 'a retry is scheduled');
    assert.equal(row.locked_by, null);
  });

  it('fails a permanent SMTP 5xx immediately, with no retry scheduled', async () => {
    const context = harness({
      recipients: [recipient()],
      send: () => ({ success: false, retryable: false }),
    });

    await context.worker.runOnce();

    const row = context.recipients[0];
    assert.equal(row.status, MarketingRecipientStatus.FAILED);
    assert.equal(row.attempts, 1);
    assert.equal(row.next_attempt_at, null);
    assert.equal(row.last_error_category, MarketingErrorCategory.PERMANENT);
  });

  it('persists only a safe failure category, never the provider transcript', async () => {
    const context = harness({
      recipients: [recipient()],
      send: () => ({
        success: false,
        retryable: true,
        provider: 'smtp',
        messageId: undefined,
      }),
    });

    await context.worker.runOnce();

    const stored = JSON.stringify(context.recipients[0]);
    assert.ok(stored.includes(MarketingErrorCategory.TRANSIENT));
    assert.equal(stored.includes('535'), false);
    assert.equal(stored.includes('password'), false);
  });

  it('gives up once the attempt budget is spent and alerts the admin mailbox', async () => {
    const exhausted: Array<Record<string, unknown>> = [];
    const context = harness({
      recipients: [recipient({ attempts: 2 })],
      policy: { maxAttempts: 3 },
      send: () => ({ success: false, retryable: true }),
      alerts: {
        campaignDeliveryExhausted: (info) => exhausted.push(info as never),
        workerFailure: () => undefined,
      },
    });

    await context.worker.runOnce();

    assert.equal(context.recipients[0].status, MarketingRecipientStatus.FAILED);
    assert.equal(context.recipients[0].attempts, 3);
    assert.equal(exhausted.length, 1);
    assert.equal(exhausted[0].campaignId, CAMPAIGN_ID);
    assert.equal(exhausted[0].failureCategory, MarketingErrorCategory.TRANSIENT);
    assert.equal(
      JSON.stringify(exhausted[0]).includes('@school.test'),
      false,
      'an admin alert must never carry a recipient address',
    );
  });

  it('never throws out of a sweep, even when the database is unreachable', async () => {
    const failures: Array<Record<string, unknown>> = [];
    const context = harness({
      recipients: [recipient()],
      failQueries: true,
      alerts: {
        campaignDeliveryExhausted: () => undefined,
        workerFailure: (info) => failures.push(info as never),
      },
    });

    const summary = await context.worker.runOnce();

    assert.equal(summary.sent, 0);
    assert.equal(failures.length, 1, 'the operator hears about it');
    assert.equal(failures[0].stage, 'sweep');
  });

  it('marks a recipient failed when the pinned template version has vanished', async () => {
    const context = harness({ recipients: [recipient()], version: null });

    await context.worker.runOnce();

    assert.equal(context.recipients[0].status, MarketingRecipientStatus.FAILED);
    assert.equal(context.recipients[0].last_error_category, MarketingErrorCategory.NOT_CONFIGURED);
    assert.equal(context.sends.length, 0);
  });
});

describe('MarketingDeliveryWorker — lifecycle respect', () => {
  it('suppresses a recipient who unsubscribed after the snapshot was frozen', async () => {
    const row = recipient({ normalized_email: 'optout@school.test' });
    const context = harness({ recipients: [row], suppressed: ['optout@school.test'] });

    const summary = await context.worker.runOnce();

    assert.equal(summary.suppressed, 1);
    assert.equal(row.status, MarketingRecipientStatus.SUPPRESSED);
    assert.equal(row.last_error_category, MarketingErrorCategory.SUPPRESSED);
    assert.equal(context.sends.length, 0, 'a suppressed address is never contacted');
  });

  it('cancels in-flight rows when the campaign was cancelled after the claim', async () => {
    const campaignRow = campaign({ status: MarketingCampaignStatus.SENDING });
    const rows = [recipient(), recipient()];
    const context = harness({ recipients: rows, campaigns: [campaignRow] });
    // Cancel lands between the claim and the send.
    const original = context.worker['loadCampaign'].bind(context.worker) as (
      id: string,
    ) => Promise<unknown>;
    (context.worker as unknown as { loadCampaign: (id: string) => Promise<unknown> }).loadCampaign =
      async (id: string) => {
        campaignRow.status = MarketingCampaignStatus.CANCELLED;
        return original(id);
      };

    const summary = await context.worker.runOnce();

    assert.equal(context.sends.length, 0, 'not one more message leaves after a cancel');
    assert.equal(summary.cancelled, 2);
    for (const row of rows) {
      assert.equal(row.status, MarketingRecipientStatus.CANCELLED);
    }
  });

  it('returns claimed rows to the queue when the campaign was paused', async () => {
    const campaignRow = campaign({ status: MarketingCampaignStatus.SENDING });
    const row = recipient();
    const context = harness({ recipients: [row], campaigns: [campaignRow] });
    const original = context.worker['loadCampaign'].bind(context.worker) as (
      id: string,
    ) => Promise<unknown>;
    (context.worker as unknown as { loadCampaign: (id: string) => Promise<unknown> }).loadCampaign =
      async (id: string) => {
        campaignRow.status = MarketingCampaignStatus.PAUSED;
        return original(id);
      };

    await context.worker.runOnce();

    assert.equal(context.sends.length, 0, 'pause blocks new sends');
    assert.equal(row.status, MarketingRecipientStatus.PENDING, 'the row waits for resume');
    assert.equal(row.locked_by, null);
    assert.equal(row.attempts, 0, 'a paused row did not consume an attempt');
  });

  it('expires recipients of a campaign whose delivery window closed', async () => {
    const context = harness({
      recipients: [recipient()],
      campaigns: [
        campaign({
          status: MarketingCampaignStatus.SENDING,
          scheduled_at: new Date(Date.now() - 100 * 60 * 60 * 1000),
        }),
      ],
    });

    const summary = await context.worker.runOnce();

    assert.equal(summary.expired, 1);
    assert.equal(context.recipients[0].status, MarketingRecipientStatus.EXPIRED);
    assert.equal(context.sends.length, 0, 'a stale campaign must not surprise people days later');
  });

  it('stops claiming on shutdown and releases the rows it had claimed', async () => {
    const rows = Array.from({ length: 4 }, () => recipient());
    const context = harness({ recipients: rows, policy: { concurrency: 1 } });
    let sent = 0;
    const worker = context.worker;
    const summaryPromise = (async () => {
      const original = worker['processRecipient'].bind(worker) as (
        row: unknown,
        summary: unknown,
      ) => Promise<void>;
      (
        worker as unknown as {
          processRecipient: (row: unknown, summary: unknown) => Promise<void>;
        }
      ).processRecipient = async (row: unknown, summary: unknown) => {
        await original(row, summary);
        sent += 1;
        if (sent === 1) {
          worker.shutdown();
        }
      };
      return worker.runOnce();
    })();

    await summaryPromise;

    assert.equal(sent, 1, 'the in-flight send finishes, nothing new starts');
    const released = rows.filter((row) => row.status === MarketingRecipientStatus.PENDING);
    assert.equal(released.length, 3, 'claimed-but-unsent rows go back to the queue');
    assert.equal((await worker.runOnce()).skipped, true, 'a stopped worker claims nothing');
  });
});

describe('MarketingDeliveryWorker — message content and tokens', () => {
  it('sends rendered HTML, text, Reply-To and the List-Unsubscribe headers', async () => {
    const context = harness({ recipients: [recipient()] });

    await context.worker.runOnce();

    const payload = context.sends[0].payload;
    assert.equal(payload.to, context.recipients[0].normalized_email);
    assert.equal(payload.subject, 'News for Sunrise Public School');
    assert.ok(payload.html?.includes('Hello Asha Rao'));
    assert.ok(payload.body.includes('Hello Asha Rao'));
    assert.equal(payload.replyTo, 'ops@zeromilesystems.test');
    assert.equal(payload.headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.match(String(payload.headers?.['List-Unsubscribe']), /marketing\/unsubscribe\//);
  });

  it('persists only token digests, and the digest matches the link that was sent', async () => {
    const context = harness({ recipients: [recipient()] });

    await context.worker.runOnce();

    const row = context.recipients[0];
    const html = context.sends[0].payload.html ?? '';
    const clickToken = /marketing\/click\/([a-f0-9]{64})/.exec(html)?.[1];
    const unsubscribeToken = /marketing\/unsubscribe\/([a-f0-9]{64})/.exec(html)?.[1];

    assert.ok(clickToken && unsubscribeToken);
    assert.equal(row.click_token_hash, hashMarketingToken(clickToken));
    assert.equal(row.unsubscribe_token_hash, hashMarketingToken(unsubscribeToken));
    assert.equal(row.click_token_hash === clickToken, false, 'the raw token is never stored');
    assert.equal(
      JSON.stringify(row).includes(clickToken),
      false,
      'no column holds a usable token',
    );
  });

  it('writes bounded, non-identifying analytics events', async () => {
    const context = harness({ recipients: [recipient()] });

    await context.worker.runOnce();

    const event = context.events[0];
    assert.equal(event.event_type, MarketingEventType.SENT);
    assert.equal(event.campaign_id, CAMPAIGN_ID);
    const serialized = JSON.stringify(event);
    assert.equal(serialized.includes('@school.test'), false, 'no address in an event row');
    assert.equal(serialized.includes('Hello Asha'), false, 'no body in an event row');
  });

  it('works with the NoOp provider (no relay configured)', async () => {
    const context = harness({
      recipients: [recipient()],
      send: () => ({ success: true, retryable: false, provider: 'noop', messageId: 'noop-1' }),
    });

    const summary = await context.worker.runOnce();

    assert.equal(summary.sent, 1);
    assert.equal(context.recipients[0].status, MarketingRecipientStatus.SENT);
    assert.equal(context.recipients[0].provider_message_id, 'noop-1');
  });
});

describe('MarketingDeliveryWorker — campaign progress', () => {
  it('recomputes counters from the rows and completes only when nothing is outstanding', async () => {
    const context = harness({
      recipients: [recipient(), recipient()],
      campaigns: [campaign({ status: MarketingCampaignStatus.SENDING })],
    });

    await context.worker.runOnce();

    const row = context.campaigns[0];
    assert.equal(row.sent_count, 2);
    assert.equal(row.queued_count, 0);
    assert.equal(row.processing_count, 0);
    assert.equal(row.recipient_count, 2);
    assert.equal(row.status, MarketingCampaignStatus.COMPLETED);
    assert.ok(row.completed_at instanceof Date);
  });

  it('keeps a campaign running while any recipient is still retrying', async () => {
    const context = harness({
      recipients: [recipient(), recipient()],
      campaigns: [campaign({ status: MarketingCampaignStatus.SENDING })],
      send: (_payload, attempt) => ({ success: attempt === 1, retryable: true }),
    });

    await context.worker.runOnce();

    const row = context.campaigns[0];
    assert.equal(row.sent_count, 1);
    assert.equal(row.retrying_count, 1);
    assert.equal(row.status, MarketingCampaignStatus.SENDING, 'not completed while work is owed');
    assert.equal(row.completed_at, null);
  });

  it('marks a campaign partially failed when some recipients could not be delivered', async () => {
    const context = harness({
      recipients: [recipient(), recipient()],
      campaigns: [campaign({ status: MarketingCampaignStatus.SENDING })],
      send: (_payload, attempt) => ({ success: attempt === 1, retryable: false }),
    });

    await context.worker.runOnce();

    assert.equal(context.campaigns[0].status, MarketingCampaignStatus.PARTIALLY_FAILED);
    assert.equal(context.campaigns[0].failed_count, 1);
  });

  it('closes out a campaign whose last recipient was handled elsewhere', async () => {
    // No claimable rows, but the campaign is still marked SENDING: the sweep
    // must reconcile it instead of leaving it running forever.
    const context = harness({
      recipients: [recipient({ status: MarketingRecipientStatus.SENT, sent_at: new Date() })],
      campaigns: [campaign({ status: MarketingCampaignStatus.SENDING })],
    });

    const summary = await context.worker.runOnce();

    assert.equal(summary.claimed, 0);
    assert.equal(context.campaigns[0].status, MarketingCampaignStatus.COMPLETED);
  });

  it('never rewrites a paused campaign back to running', async () => {
    const context = harness({
      recipients: [recipient({ status: MarketingRecipientStatus.SENT, sent_at: new Date() })],
      campaigns: [campaign({ status: MarketingCampaignStatus.PAUSED })],
    });

    await context.worker.refreshCampaignProgress(CAMPAIGN_ID);

    assert.equal(context.campaigns[0].status, MarketingCampaignStatus.PAUSED);
    assert.equal(context.campaigns[0].sent_count, 1, 'counters still refresh under a pause');
  });
});
