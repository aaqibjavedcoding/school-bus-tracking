/**
 * The durable lead-notification worker.
 *
 * `marketing_notification_jobs` is the queue and PostgreSQL is the broker —
 * the same construction the campaign delivery worker uses, deliberately, so
 * there is one set of queue semantics in this codebase instead of two:
 *
 * ```text
 * advisory lock ─▶ claim N due jobs (FOR UPDATE SKIP LOCKED, RETURNING)
 *                  └─ rows become PROCESSING with a lease in the same
 *                     statement, so a crash can never lose them
 *   for each job: load lead ─▶ send once ─▶ conditional outcome write
 *                 (`WHERE status='PROCESSING' AND locked_by=<me>`)
 *                 └─ ADMIN_NOTIFIED / ADMIN_NOTIFY_FAILED lead event
 * ```
 *
 * Why each mechanism is here:
 *
 * - **`FOR UPDATE SKIP LOCKED`** — two workers sweeping at the same instant
 *   take disjoint jobs, so duplicate workers cannot produce duplicate
 *   notifications.
 * - **A transaction-scoped advisory lock** (its own key, never the delivery
 *   worker's) keeps multiple instances from thrashing the head of the queue.
 *   It is held for the claim only, never across the SMTP conversation.
 * - **A lease** makes a killed container recoverable: a `PROCESSING` job past
 *   its lease is claimable again. That is what turns "the process restarted
 *   mid-send" from a lost notification into a delayed one.
 * - **The conditional outcome write** is the idempotency guard: a worker
 *   whose lease expired mid-send updates zero rows and leaves the
 *   re-claiming worker's result alone.
 * - **Bounded attempts + a job expiry** stop infinite retries: after
 *   `maxAttempts` the job is `FAILED`, and a job older than `expiryMs` is
 *   `EXPIRED` even if attempts remain. Recording either outcome never sends
 *   another email.
 *
 * The lead is never touched destructively: a failing notification only ever
 * appends an `ADMIN_NOTIFY_FAILED` event. SMTP cannot delete or roll back a
 * lead, by construction — the lead was committed long before this runs.
 */

import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import {
  MarketingErrorCategory,
  MarketingLeadEventType,
  MarketingNotificationJobStatus,
  MarketingNotificationJobType,
} from '@school-bus-tracking/shared-types';
import { Logger } from '../../framework';
import type {
  MarketingLead,
  MarketingLeadEvent,
  MarketingNotificationJob,
} from '../../database/models';
import type { MarketingLeadNotifications } from './marketing-lead-notifications';
import {
  MARKETING_NOTIFICATION_LOCK_CLASS,
  MARKETING_NOTIFICATION_LOCK_KEY,
} from './marketing.constants';

/** Bounded retry/lease policy of the notification queue. */
export interface MarketingNotificationPolicy {
  batchSize: number;
  maxAttempts: number;
  retryBaseMs: number;
  /** Maximum age of a job; older jobs are EXPIRED rather than retried. */
  expiryMs: number;
  leaseMs: number;
}

export const DEFAULT_MARKETING_NOTIFICATION_POLICY: MarketingNotificationPolicy = {
  batchSize: 10,
  maxAttempts: 5,
  retryBaseMs: 60_000,
  expiryMs: 24 * 60 * 60 * 1000,
  leaseMs: 120_000,
};

/** Cap on the backoff so a long-dead relay still retries hourly. */
export const MARKETING_NOTIFICATION_MAX_BACKOFF_MS = 15 * 60 * 1000;

/** What one notification sweep did. Numbers only — safe to log. */
export interface MarketingNotificationSweepSummary {
  skipped: boolean;
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  expired: number;
  fatalError?: boolean;
}

/** A claimed job row (plain object from the claim statement). */
export interface ClaimedMarketingNotificationJob {
  id: string;
  job_type: MarketingNotificationJobType;
  lead_id: string | null;
  attempts: number;
  created_at: Date | string;
}

export interface MarketingNotificationWorkerDeps {
  jobs: typeof MarketingNotificationJob;
  leads: typeof MarketingLead;
  leadEvents: typeof MarketingLeadEvent;
  notifications: Pick<MarketingLeadNotifications, 'sendOnce'>;
  sequelize: Sequelize | null;
  policy?: Partial<MarketingNotificationPolicy>;
  /** Injected in tests to make jitter deterministic. */
  random?: () => number;
  now?: () => Date;
}

/**
 * Exponential backoff with jitter, capped.
 *
 * Jitter matters with multiple instances: without it, N workers that failed
 * on the same relay outage retry in lock-step and hit it again together.
 */
export function marketingNotificationBackoffMs(
  attemptNumber: number,
  policy: MarketingNotificationPolicy,
  random: () => number = Math.random,
): number {
  const exponential = policy.retryBaseMs * Math.pow(2, Math.max(0, attemptNumber - 1));
  const capped = Math.min(exponential, MARKETING_NOTIFICATION_MAX_BACKOFF_MS);
  const jitter = Math.floor(random() * Math.min(capped, policy.retryBaseMs));
  return capped + jitter;
}

export class MarketingNotificationWorker {
  private readonly logger = new Logger(MarketingNotificationWorker.name);

  /** Stable per-process identity written into `locked_by`. */
  readonly workerId: string;

  private readonly policy: MarketingNotificationPolicy;
  private readonly random: () => number;
  private readonly now: () => Date;
  private stopping = false;

  constructor(private readonly deps: MarketingNotificationWorkerDeps) {
    this.workerId = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    this.policy = { ...DEFAULT_MARKETING_NOTIFICATION_POLICY, ...(deps.policy ?? {}) };
    this.random = deps.random ?? Math.random;
    this.now = deps.now ?? (() => new Date());
  }

  /** Stops claiming new jobs; in-flight sends finish and record. */
  shutdown(): void {
    this.stopping = true;
  }

  /** Runs one sweep. Never throws — a background failure must not crash. */
  async runOnce(): Promise<MarketingNotificationSweepSummary> {
    const summary: MarketingNotificationSweepSummary = {
      skipped: false,
      claimed: 0,
      sent: 0,
      retrying: 0,
      failed: 0,
      expired: 0,
    };

    if (!this.deps.sequelize) {
      summary.skipped = true;
      return summary;
    }
    if (this.stopping) {
      summary.skipped = true;
      return summary;
    }

    try {
      const claimed = await this.claimBatch(this.policy.batchSize);
      summary.claimed = claimed.length;
      for (const job of claimed) {
        if (this.stopping) {
          await this.release(job.id);
          continue;
        }
        await this.processJob(job, summary);
      }
    } catch (error) {
      summary.fatalError = true;
      this.logger.error(
        `Marketing notification sweep failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
    return summary;
  }

  // -------------------------------------------------------------- claiming

  /**
   * Atomically claims up to `limit` due jobs.
   *
   * One statement: the inner `SELECT … FOR UPDATE SKIP LOCKED` picks jobs
   * nobody holds, the outer `UPDATE … RETURNING` leases them to this worker.
   * There is no window in which a job is "selected but not claimed" — the
   * window that makes naive queues notify twice.
   */
  private async claimBatch(limit: number): Promise<ClaimedMarketingNotificationJob[]> {
    const connection = this.deps.sequelize;
    if (!connection || limit <= 0) {
      return [];
    }

    return connection.transaction(async (transaction) => {
      const lock = await connection.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_xact_lock(${MARKETING_NOTIFICATION_LOCK_CLASS}, ${MARKETING_NOTIFICATION_LOCK_KEY}) AS locked`,
        { type: QueryTypes.SELECT, transaction },
      );
      if (!lock[0]?.locked) {
        // Another instance is claiming right now; try again next tick.
        return [];
      }

      const rows = await connection.query<ClaimedMarketingNotificationJob>(
        `UPDATE marketing_notification_jobs AS j
            SET status = :processing,
                locked_by = :workerId,
                lease_expires_at = NOW() + (:leaseMs * INTERVAL '1 millisecond'),
                updated_at = NOW()
          WHERE j.id IN (
            SELECT candidate.id
              FROM marketing_notification_jobs AS candidate
             WHERE (
                     candidate.status IN (:claimable)
                  OR (candidate.status = :processing AND candidate.lease_expires_at < NOW())
                   )
               AND candidate.next_attempt_at <= NOW()
             ORDER BY candidate.next_attempt_at, candidate.created_at
             LIMIT :limit
             FOR UPDATE OF candidate SKIP LOCKED
          )
      RETURNING j.id, j.job_type, j.lead_id, j.attempts, j.created_at`,
        {
          type: QueryTypes.SELECT,
          transaction,
          replacements: {
            processing: MarketingNotificationJobStatus.PROCESSING,
            claimable: [
              MarketingNotificationJobStatus.PENDING,
              MarketingNotificationJobStatus.RETRYING,
            ],
            workerId: this.workerId,
            leaseMs: this.policy.leaseMs,
            limit,
          },
        },
      );
      return rows ?? [];
    });
  }

  /** Hands a claim back untouched (graceful shutdown). */
  private async release(jobId: string): Promise<void> {
    await this.deps.jobs.update(
      {
        status: MarketingNotificationJobStatus.PENDING,
        locked_by: null,
        lease_expires_at: null,
      } as never,
      {
        where: {
          id: jobId,
          status: MarketingNotificationJobStatus.PROCESSING,
          locked_by: this.workerId,
        } as never,
      },
    );
  }

  // ------------------------------------------------------------ processing

  private async processJob(
    job: ClaimedMarketingNotificationJob,
    summary: MarketingNotificationSweepSummary,
  ): Promise<void> {
    const now = this.now();
    try {
      // Bounded lifetime: a job nobody could deliver inside the window is
      // closed rather than retried forever.
      const createdAt = job.created_at instanceof Date ? job.created_at : new Date(job.created_at);
      if (now.getTime() - createdAt.getTime() > this.policy.expiryMs) {
        const closed = await this.finalize(job, MarketingNotificationJobStatus.EXPIRED, {
          attempts: job.attempts,
          errorCategory: MarketingErrorCategory.UNKNOWN,
        });
        if (closed) {
          summary.expired += 1;
          await this.recordLeadEvent(job.lead_id, MarketingLeadEventType.ADMIN_NOTIFY_FAILED, {
            outcome: 'expired',
            attempts: job.attempts,
          });
        }
        return;
      }

      const lead = job.lead_id
        ? await this.deps.leads.findOne({ where: { id: job.lead_id } })
        : null;
      if (!lead) {
        // The lead is gone (erased or hard-deleted). Nothing to notify about
        // and nothing to retry.
        await this.finalize(job, MarketingNotificationJobStatus.FAILED, {
          attempts: job.attempts,
          errorCategory: MarketingErrorCategory.UNKNOWN,
        });
        summary.failed += 1;
        return;
      }

      const attemptNumber = job.attempts + 1;
      const outcome = await this.deps.notifications.sendOnce(lead);

      if (outcome.sent) {
        const updated = await this.finalize(job, MarketingNotificationJobStatus.SENT, {
          attempts: attemptNumber,
          errorCategory: null,
          providerMessageId: outcome.providerMessageId,
          sentAt: now,
        });
        if (!updated) {
          // Lost lease: another worker owns this job's outcome. Do not
          // double-record (its send, if any, is authoritative).
          return;
        }
        summary.sent += 1;
        await this.markLeadNotified(lead.id, now);
        await this.recordLeadEvent(lead.id, MarketingLeadEventType.ADMIN_NOTIFIED, {
          attempts: attemptNumber,
        });
        return;
      }

      const exhausted = attemptNumber >= this.policy.maxAttempts || !outcome.retryable;
      if (exhausted) {
        const updated = await this.finalize(job, MarketingNotificationJobStatus.FAILED, {
          attempts: attemptNumber,
          errorCategory: outcome.category ?? MarketingErrorCategory.UNKNOWN,
        });
        if (!updated) {
          return;
        }
        summary.failed += 1;
        await this.recordLeadEvent(lead.id, MarketingLeadEventType.ADMIN_NOTIFY_FAILED, {
          attempts: attemptNumber,
          category: outcome.category ?? MarketingErrorCategory.UNKNOWN,
        });
        this.logger.warn(
          `New-lead admin notification failed permanently (lead ${lead.id}); the lead is stored and visible in the console.`,
        );
        return;
      }

      const delay = marketingNotificationBackoffMs(attemptNumber, this.policy, this.random);
      const updated = await this.finalize(job, MarketingNotificationJobStatus.RETRYING, {
        attempts: attemptNumber,
        errorCategory: outcome.category ?? MarketingErrorCategory.TRANSIENT,
        nextAttemptAt: new Date(now.getTime() + delay),
      });
      if (updated) {
        summary.retrying += 1;
      }
    } catch (error) {
      // A defect here must not leave the job leased: schedule a retry and
      // let the bounded attempt count close it eventually.
      this.logger.warn(
        `Marketing notification attempt failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      const attemptNumber = job.attempts + 1;
      await this.finalize(
        job,
        attemptNumber >= this.policy.maxAttempts
          ? MarketingNotificationJobStatus.FAILED
          : MarketingNotificationJobStatus.RETRYING,
        {
          attempts: attemptNumber,
          errorCategory: MarketingErrorCategory.UNKNOWN,
          nextAttemptAt: new Date(
            this.now().getTime() +
              marketingNotificationBackoffMs(attemptNumber, this.policy, this.random),
          ),
        },
      );
      summary.failed += 1;
    }
  }

  /**
   * Writes the outcome back, but only while this worker still owns the job.
   *
   * `status = PROCESSING AND locked_by = me` is the whole duplicate-worker
   * defence: an expired-lease worker finds zero rows and stays quiet.
   */
  private async finalize(
    job: ClaimedMarketingNotificationJob,
    status: MarketingNotificationJobStatus,
    values: {
      attempts: number;
      errorCategory: MarketingErrorCategory | null;
      nextAttemptAt?: Date | null;
      providerMessageId?: string | null;
      sentAt?: Date | null;
    },
  ): Promise<boolean> {
    const payload: Record<string, unknown> = {
      status,
      attempts: values.attempts,
      locked_by: null,
      lease_expires_at: null,
      last_error_category: values.errorCategory,
      next_attempt_at: values.nextAttemptAt ?? this.now(),
    };
    if (status === MarketingNotificationJobStatus.SENT) {
      payload.sent_at = values.sentAt ?? this.now();
      payload.provider_message_id = values.providerMessageId ?? null;
    }
    const [affected] = await this.deps.jobs.update(payload as never, {
      where: {
        id: job.id,
        status: MarketingNotificationJobStatus.PROCESSING,
        locked_by: this.workerId,
      } as never,
    });
    return (affected ?? 0) > 0;
  }

  private async markLeadNotified(leadId: string, at: Date): Promise<void> {
    try {
      await this.deps.leads.update({ admin_notified_at: at } as never, {
        where: { id: leadId, admin_notified_at: null } as never,
      });
    } catch (error) {
      this.logger.warn(
        `Could not stamp admin_notified_at: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /** Appends one timeline event. Bounded metadata; never a transcript. */
  private async recordLeadEvent(
    leadId: string | null,
    eventType: MarketingLeadEventType,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!leadId) {
      return;
    }
    try {
      await this.deps.leadEvents.create({
        lead_id: leadId,
        event_type: eventType,
        actor: 'system',
        metadata,
      } as never);
    } catch (error) {
      this.logger.warn(
        `Lead event write failed (${eventType}): ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
