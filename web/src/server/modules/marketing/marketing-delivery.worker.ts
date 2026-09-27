/**
 * The durable marketing email delivery worker.
 *
 * `email_campaign_recipients` is the queue; PostgreSQL is the broker. There
 * is no Redis, no SQS and no in-memory job list, because the rows already
 * exist, already have to be durable (they *are* the audit record of who was
 * mailed), and a second store would only add a way for the two to disagree.
 *
 * ### One sweep
 *
 * ```text
 * advisory lock ─▶ claim N due rows (FOR UPDATE SKIP LOCKED, RETURNING)
 *                  └─ rows become PROCESSING with a lease, in the same
 *                     statement, so a crash can never lose them
 *   for each chunk of `concurrency` rows:
 *     suppression re-check ─▶ render + mint tokens ─▶ provider.send
 *     └─ outcome written back conditionally (`WHERE status='PROCESSING'
 *        AND locked_by=<this worker>`), then the campaign counters are
 *        recomputed from the rows
 * ```
 *
 * ### Why each mechanism is there
 *
 * - **`FOR UPDATE SKIP LOCKED`** — two instances sweeping at the same instant
 *   take disjoint rows instead of blocking on each other or (worse) both
 *   sending to the same address. This is the single most important line in
 *   the file; everything else is bookkeeping around it.
 * - **A transaction-scoped advisory lock** around the claim keeps a
 *   multi-instance deployment from thrashing the same head-of-queue rows.
 *   It is held only for the claim — never across an SMTP conversation, which
 *   would pin a database connection for the length of a network round trip.
 * - **A lease (`locked_by` + `lease_expires_at`)** makes a crash recoverable
 *   without a human: a `PROCESSING` row whose lease has passed is claimable
 *   again. The lease is what turns "the container was killed mid-batch" from
 *   an incident into a delay.
 * - **The conditional outcome write** is the idempotency guard. If this
 *   worker's lease expired and another instance re-claimed the row, our
 *   `UPDATE … WHERE locked_by = me` matches nothing and we do not overwrite
 *   the other worker's result.
 * - **Counters are recomputed, never incremented** (see
 *   `buildCampaignCounters`), so a restart mid-sweep cannot double-count.
 *
 * ### Delivery semantics
 *
 * At-least-once, honestly labelled. If the relay accepted a message and this
 * process died before committing the outcome, the lease expires and the row
 * is retried — the recipient may receive it twice. The alternative (marking
 * sent *before* sending) loses mail silently, which is strictly worse for a
 * campaign. `SENT` means "the provider accepted it", never "it was read".
 *
 * ### Bulk mail never happens in an HTTP request
 *
 * Nothing in `api/marketing.ts` sends a campaign message. Scheduling writes
 * rows; this worker — and only this worker — talks to the relay.
 */

import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import {
  MarketingCampaignStatus,
  MarketingErrorCategory,
  MarketingEventType,
  MarketingRecipientStatus,
} from '@school-bus-tracking/shared-types';
import { Logger } from '../../framework';
import type {
  EmailCampaign,
  EmailCampaignRecipient,
  EmailEvent,
  EmailTemplateVersion,
  MarketingSuppression,
} from '../../database/models';
import type { EmailNotificationProvider } from '../notifications/providers/notification-provider.interface';
import {
  buildCampaignCounters,
  chunk,
  decideCampaignStatus,
  decideMarketingAttempt,
  isMarketingCampaignExpired,
  marketingSendPauseMs,
  MarketingRateWindow,
  type MarketingCampaignCounters,
  type MarketingDeliveryPolicy,
  type MarketingRecipientStatusGroup,
} from './marketing-delivery.policy';
import { buildMarketingMessage, describeMarketingMessage } from './marketing-message.builder';
import {
  MARKETING_DELIVERY_LOCK_CLASS,
  MARKETING_DELIVERY_LOCK_KEY,
} from './marketing.constants';

/** What one sweep did. Returned for logging/metrics; never thrown out of. */
export interface MarketingSweepSummary {
  skipped: boolean;
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  suppressed: number;
  expired: number;
  cancelled: number;
  /** True when the per-minute ceiling stopped the sweep early. */
  rateLimited: boolean;
}

/** A row as returned by the claim statement (plain object, not a model). */
export interface ClaimedMarketingRecipient {
  id: string;
  campaign_id: string;
  school_id: string | null;
  school_name: string | null;
  normalized_email: string;
  recipient_name: string | null;
  attempts: number;
}

/** The minimum a campaign row must expose for delivery decisions. */
interface DeliveryCampaign {
  id: string;
  status: MarketingCampaignStatus;
  template_version_id: string;
  scheduled_at: Date | null;
  started_at: Date | null;
}

/** Notifier for exhausted retries / configuration failures (never blocking). */
export interface MarketingAlertSink {
  campaignDeliveryExhausted(info: {
    campaignId: string;
    failureCategory: MarketingErrorCategory;
    attempts: number;
  }): void;
  workerFailure(info: { stage: string; message: string }): void;
}

export interface MarketingDeliveryWorkerDeps {
  campaigns: typeof EmailCampaign;
  recipients: typeof EmailCampaignRecipient;
  versions: typeof EmailTemplateVersion;
  events: typeof EmailEvent;
  suppressions: typeof MarketingSuppression;
  emailProvider: EmailNotificationProvider;
  sequelize: Sequelize | null;
  policy: MarketingDeliveryPolicy;
  /** Public origin used to build click/unsubscribe links (`APP_URL`). */
  appUrl: string;
  /** `Reply-To` of campaign mail — an operator mailbox, not a recipient. */
  replyTo?: string | null;
  /** Optional alert rail; absent in tests and DB-less bootstraps. */
  alerts?: MarketingAlertSink | null;
  /** Injected in tests to make jitter and pauses deterministic. */
  random?: () => number;
  /** Injected in tests so a sweep does not really sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

export class MarketingDeliveryWorker {
  private readonly logger = new Logger(MarketingDeliveryWorker.name);

  /** Stable per-process identity written into `locked_by`. */
  readonly workerId: string;

  private readonly rateWindow: MarketingRateWindow;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  /** Set by {@link shutdown}; checked between chunks for a clean stop. */
  private stopping = false;

  constructor(private readonly deps: MarketingDeliveryWorkerDeps) {
    this.workerId = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    this.rateWindow = new MarketingRateWindow(deps.policy.ratePerMinute);
    this.random = deps.random ?? Math.random;
    this.sleep = deps.sleep ?? defaultSleep;
  }

  /**
   * Asks the worker to stop claiming new work.
   *
   * In-flight sends are allowed to finish and write their outcome — killing
   * them would leave rows leased with no result, which the lease timeout
   * would eventually recover but only after a needless delay.
   */
  shutdown(): void {
    this.stopping = true;
  }

  /** Runs one sweep. Never throws: a background failure must not crash the API. */
  async runOnce(): Promise<MarketingSweepSummary> {
    const summary: MarketingSweepSummary = {
      skipped: false,
      claimed: 0,
      sent: 0,
      retrying: 0,
      failed: 0,
      suppressed: 0,
      expired: 0,
      cancelled: 0,
      rateLimited: false,
    };

    if (!this.deps.sequelize) {
      this.logger.warn('Marketing delivery sweep skipped — no database connection.');
      summary.skipped = true;
      return summary;
    }
    if (this.stopping) {
      summary.skipped = true;
      return summary;
    }

    try {
      const budget = this.rateWindow.remaining();
      if (budget <= 0) {
        summary.rateLimited = true;
        summary.skipped = true;
        return summary;
      }

      const limit = Math.min(this.deps.policy.batchSize, budget);
      if (limit < this.deps.policy.batchSize) {
        // The window, not the batch size, is what bounded this sweep.
        summary.rateLimited = true;
      }
      const claimed = await this.claimBatch(limit);
      summary.claimed = claimed.length;
      if (claimed.length === 0) {
        // Nothing due — still reconcile campaigns that just finished, so a
        // campaign whose last recipient was handled by another instance does
        // not linger in SENDING forever.
        await this.reconcileFinishedCampaigns();
        return summary;
      }

      const campaignIds = [...new Set(claimed.map((row) => row.campaign_id))];

      // Bounded concurrency: `concurrency` SMTP conversations at a time, never
      // one per claimed row.
      const groups = chunk(claimed, this.deps.policy.concurrency);
      for (let index = 0; index < groups.length; index += 1) {
        const stopping = this.stopping;
        const outOfBudget = this.rateWindow.remaining() <= 0;
        if (stopping || outOfBudget) {
          // Hand *every* remaining claim back, not just this group: a row left
          // PROCESSING would wait for its lease to expire before anyone could
          // pick it up, which turns a clean redeploy into a delivery stall.
          summary.rateLimited = summary.rateLimited || outOfBudget;
          await this.releaseClaims(groups.slice(index).flat().map((row) => row.id));
          break;
        }
        await Promise.all(groups[index].map((row) => this.processRecipient(row, summary)));
        const pause = marketingSendPauseMs(this.deps.policy, this.random);
        if (pause > 0) {
          await this.sleep(pause);
        }
      }

      for (const campaignId of campaignIds) {
        await this.refreshCampaignProgress(campaignId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Marketing delivery sweep failed: ${message}`);
      this.deps.alerts?.workerFailure({ stage: 'sweep', message });
    }
    return summary;
  }

  // ------------------------------------------------------------- claiming

  /**
   * Atomically claims up to `limit` due rows.
   *
   * The whole claim is one statement: the inner `SELECT … FOR UPDATE SKIP
   * LOCKED` picks rows nobody else has locked, and the outer `UPDATE …
   * RETURNING` marks them `PROCESSING` with this worker's lease. Because it
   * is a single statement, there is no window in which a row is "selected
   * but not yet claimed" — the failure mode that makes naive queue
   * implementations deliver twice.
   *
   * Eligibility encodes the lifecycle rules directly in SQL, so a paused or
   * cancelled campaign can never have work claimed for it even if an
   * in-memory check were forgotten:
   *
   * - the campaign must be `SCHEDULED`/`SENDING` and due;
   * - the recipient must be queued, retrying, or `PROCESSING` **with an
   *   expired lease** (crash recovery);
   * - `next_attempt_at` must have passed (backoff).
   */
  private async claimBatch(limit: number): Promise<ClaimedMarketingRecipient[]> {
    const connection = this.deps.sequelize;
    if (!connection || limit <= 0) {
      return [];
    }
    const leaseMs = this.deps.policy.leaseMs;

    return connection.transaction(async (transaction) => {
      const lock = await connection.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_xact_lock(${MARKETING_DELIVERY_LOCK_CLASS}, ${MARKETING_DELIVERY_LOCK_KEY}) AS locked`,
        { type: QueryTypes.SELECT, transaction },
      );
      if (!lock[0]?.locked) {
        // Another instance is claiming right now. Skipping is correct: its
        // claim will take the same rows, and we try again next tick.
        return [];
      }

      const rows = await connection.query<ClaimedMarketingRecipient>(
        `UPDATE email_campaign_recipients AS r
            SET status = :processing,
                locked_by = :workerId,
                lease_expires_at = NOW() + (:leaseMs * INTERVAL '1 millisecond'),
                updated_at = NOW()
          WHERE r.id IN (
            SELECT candidate.id
              FROM email_campaign_recipients AS candidate
              JOIN email_campaigns AS c ON c.id = candidate.campaign_id
             WHERE c.deleted_at IS NULL
               AND c.status IN (:deliverableStatuses)
               AND (c.scheduled_at IS NULL OR c.scheduled_at <= NOW())
               AND (
                     candidate.status IN (:claimableStatuses)
                  OR (candidate.status = :processing AND candidate.lease_expires_at < NOW())
                   )
               AND (candidate.next_attempt_at IS NULL OR candidate.next_attempt_at <= NOW())
             ORDER BY candidate.next_attempt_at NULLS FIRST, candidate.created_at
             LIMIT :limit
             FOR UPDATE OF candidate SKIP LOCKED
          )
      RETURNING r.id, r.campaign_id, r.school_id, r.school_name,
                r.normalized_email, r.recipient_name, r.attempts`,
        {
          type: QueryTypes.SELECT,
          transaction,
          replacements: {
            processing: MarketingRecipientStatus.PROCESSING,
            workerId: this.workerId,
            leaseMs,
            limit,
            deliverableStatuses: [
              MarketingCampaignStatus.SCHEDULED,
              MarketingCampaignStatus.SENDING,
            ],
            claimableStatuses: [
              MarketingRecipientStatus.PENDING,
              MarketingRecipientStatus.RETRYING,
            ],
          },
        },
      );
      return rows ?? [];
    });
  }

  /** Returns rows to the queue unchanged (pause/shutdown/rate ceiling). */
  private async releaseClaims(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.deps.recipients.update(
      {
        status: MarketingRecipientStatus.PENDING,
        locked_by: null,
        lease_expires_at: null,
      } as never,
      {
        where: {
          id: ids,
          status: MarketingRecipientStatus.PROCESSING,
          locked_by: this.workerId,
        } as never,
      },
    );
  }

  // ----------------------------------------------------------- processing

  /** Delivers one claimed recipient and records the outcome. */
  private async processRecipient(
    row: ClaimedMarketingRecipient,
    summary: MarketingSweepSummary,
  ): Promise<void> {
    const now = new Date();
    try {
      const campaign = await this.loadCampaign(row.campaign_id);
      if (!campaign) {
        await this.finalize(row, MarketingRecipientStatus.SKIPPED, null, null, now);
        return;
      }

      // Lifecycle re-checks. The claim query already excluded paused and
      // cancelled campaigns, but a Super Admin can act *between* claim and
      // send — and a campaign that was cancelled one millisecond ago must
      // not have one more message leave.
      if (campaign.status === MarketingCampaignStatus.CANCELLED) {
        await this.finalize(row, MarketingRecipientStatus.CANCELLED, null, null, now);
        summary.cancelled += 1;
        return;
      }
      if (campaign.status === MarketingCampaignStatus.PAUSED) {
        await this.releaseClaims([row.id]);
        return;
      }
      if (isMarketingCampaignExpired(campaign, this.deps.policy, now)) {
        await this.finalize(row, MarketingRecipientStatus.EXPIRED, null, null, now);
        summary.expired += 1;
        return;
      }

      // Suppression is re-checked **at send time**, not only at snapshot
      // time: an unsubscribe that arrives while a campaign is mid-flight has
      // to be honoured for every address that has not gone out yet.
      if (await this.isSuppressed(row.normalized_email)) {
        await this.finalize(
          row,
          MarketingRecipientStatus.SUPPRESSED,
          MarketingErrorCategory.SUPPRESSED,
          null,
          now,
        );
        summary.suppressed += 1;
        return;
      }

      const version = await this.deps.versions.findOne({
        where: { id: campaign.template_version_id },
      });
      if (!version) {
        await this.finalize(
          row,
          MarketingRecipientStatus.FAILED,
          MarketingErrorCategory.NOT_CONFIGURED,
          null,
          now,
        );
        summary.failed += 1;
        return;
      }

      const message = buildMarketingMessage({
        recipient: {
          id: row.id,
          normalized_email: row.normalized_email,
          recipient_name: row.recipient_name,
          school_name: row.school_name,
        },
        version,
        appUrl: this.deps.appUrl,
        replyTo: this.deps.replyTo ?? null,
        now,
      });

      // The digests are persisted *before* the send, so a message that goes
      // out is always resolvable: a click on a link whose token we forgot to
      // store would be an attribution hole (and would look, to the
      // recipient, like a broken unsubscribe).
      await this.deps.recipients.update(
        {
          click_token_hash: message.clickTokenHash,
          unsubscribe_token_hash: message.unsubscribeTokenHash,
        } as never,
        { where: { id: row.id, locked_by: this.workerId } as never },
      );

      this.rateWindow.record();
      const attemptNumber = row.attempts + 1;
      const result = await this.deps.emailProvider.send({
        recipientId: row.id,
        title: message.subject,
        body: message.text,
        to: message.to,
        subject: message.subject,
        html: message.html,
        replyTo: message.replyTo,
        headers: message.headers,
      });

      const decision = decideMarketingAttempt({
        outcome: {
          success: result.success,
          retryable: result.retryable,
          messageId: result.messageId ?? null,
          provider: result.provider,
        },
        attemptNumber,
        policy: this.deps.policy,
        now,
        random: this.random,
      });

      const updated = await this.finalize(
        row,
        decision.status,
        decision.errorCategory,
        result.success ? (result.messageId ?? null) : null,
        now,
        { attemptNumber, nextAttemptAt: decision.nextAttemptAt },
      );

      if (!updated) {
        // Our lease was lost (expired and re-claimed elsewhere). Whatever
        // that worker decided is authoritative; adding an event here would
        // double-count the attempt.
        return;
      }

      if (decision.status === MarketingRecipientStatus.SENT) {
        summary.sent += 1;
        await this.recordEvent(row, MarketingEventType.SENT, { attempt: attemptNumber });
        this.logger.debug(
          `[Marketing] Campaign ${row.campaign_id} recipient accepted by ${result.provider} (${describeMarketingMessage(message)})`,
        );
      } else if (decision.status === MarketingRecipientStatus.RETRYING) {
        summary.retrying += 1;
      } else {
        summary.failed += 1;
        await this.recordEvent(row, MarketingEventType.FAILED, {
          attempt: attemptNumber,
          category: decision.errorCategory,
        });
        if (decision.attemptsExhausted) {
          // Non-blocking by construction: the alert sink queues/sends on its
          // own and never returns a rejected promise into this path.
          this.deps.alerts?.campaignDeliveryExhausted({
            campaignId: row.campaign_id,
            failureCategory: decision.errorCategory ?? MarketingErrorCategory.UNKNOWN,
            attempts: attemptNumber,
          });
        }
      }
    } catch (error) {
      // A defect in rendering or a database blip must not leave the row
      // leased: mark it retryable and let the backoff handle it. The error
      // *message* is logged (it is ours, not the provider's transcript) but
      // never persisted.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Marketing delivery attempt failed for a recipient: ${message}`);
      await this.finalize(
        row,
        row.attempts + 1 >= this.deps.policy.maxAttempts
          ? MarketingRecipientStatus.FAILED
          : MarketingRecipientStatus.RETRYING,
        MarketingErrorCategory.UNKNOWN,
        null,
        new Date(),
        {
          attemptNumber: row.attempts + 1,
          nextAttemptAt: new Date(Date.now() + this.deps.policy.retryBaseMs),
        },
      );
      summary.failed += 1;
    }
  }

  /**
   * Writes the outcome back, but only while this worker still owns the row.
   *
   * The `status = PROCESSING AND locked_by = me` predicate is the
   * idempotency guard: a worker whose lease expired mid-send finds zero rows
   * updated and leaves the re-claiming worker's result alone. It is also why
   * an already-`SENT` row can never be re-sent — `SENT` is not `PROCESSING`.
   */
  private async finalize(
    row: ClaimedMarketingRecipient,
    status: MarketingRecipientStatus,
    errorCategory: MarketingErrorCategory | null,
    providerMessageId: string | null,
    now: Date,
    attempt?: { attemptNumber: number; nextAttemptAt: Date | null },
  ): Promise<boolean> {
    const values: Record<string, unknown> = {
      status,
      locked_by: null,
      lease_expires_at: null,
      last_error_category: errorCategory,
      next_attempt_at: attempt?.nextAttemptAt ?? null,
    };
    if (attempt) {
      values.attempts = attempt.attemptNumber;
      values.last_attempt_at = now;
    }
    if (status === MarketingRecipientStatus.SENT) {
      values.sent_at = now;
      values.provider_message_id = providerMessageId;
    }

    const [affected] = await this.deps.recipients.update(values as never, {
      where: {
        id: row.id,
        status: MarketingRecipientStatus.PROCESSING,
        locked_by: this.workerId,
      } as never,
    });
    return (affected ?? 0) > 0;
  }

  private async isSuppressed(email: string): Promise<boolean> {
    const existing = await this.deps.suppressions.findOne({
      where: { normalized_email: email.trim().toLowerCase() },
    });
    return existing !== null && existing !== undefined;
  }

  private async loadCampaign(campaignId: string): Promise<DeliveryCampaign | null> {
    const campaign = await this.deps.campaigns.findOne({ where: { id: campaignId } });
    if (!campaign) {
      return null;
    }
    return {
      id: campaign.id,
      status: campaign.status,
      template_version_id: campaign.template_version_id,
      scheduled_at: campaign.scheduled_at ?? null,
      started_at: campaign.started_at ?? null,
    };
  }

  /** Appends one analytics event. Failures are logged, never propagated. */
  private async recordEvent(
    row: ClaimedMarketingRecipient,
    eventType: MarketingEventType,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.deps.events.create({
        campaign_id: row.campaign_id,
        campaign_recipient_id: row.id,
        event_type: eventType,
        occurred_at: new Date(),
        // Bounded and safe: an attempt number and a category enum. Never the
        // address, never the provider transcript, never token material.
        metadata,
      } as never);
    } catch (error) {
      this.logger.warn(
        `Marketing event write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ------------------------------------------------------------- progress

  /**
   * Recomputes one campaign's counters and, when warranted, its status.
   *
   * Exported behaviour (used by the campaigns service too): counters always
   * reflect the rows, and a campaign only becomes terminal when no recipient
   * can change again.
   */
  async refreshCampaignProgress(campaignId: string): Promise<MarketingCampaignCounters | null> {
    try {
      const groups = await this.aggregateRecipients(campaignId);
      const counters = buildCampaignCounters(groups);
      const campaign = await this.deps.campaigns.findOne({ where: { id: campaignId } });
      if (!campaign) {
        return counters;
      }

      const values: Record<string, unknown> = { ...counters };
      const nextStatus = decideCampaignStatus(campaign.status, counters);
      if (nextStatus && nextStatus !== campaign.status) {
        values.status = nextStatus;
        if (
          nextStatus === MarketingCampaignStatus.COMPLETED ||
          nextStatus === MarketingCampaignStatus.PARTIALLY_FAILED ||
          nextStatus === MarketingCampaignStatus.FAILED
        ) {
          values.completed_at = campaign.completed_at ?? new Date();
        }
      }
      if (!campaign.started_at && counters.sent_count + counters.failed_count > 0) {
        values.started_at = new Date();
      }

      await this.deps.campaigns.update(values as never, { where: { id: campaignId } as never });
      return counters;
    } catch (error) {
      this.logger.warn(
        `Marketing campaign progress refresh failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** One grouped aggregate per campaign — never a per-row scan in memory. */
  private async aggregateRecipients(
    campaignId: string,
  ): Promise<MarketingRecipientStatusGroup[]> {
    const connection = this.deps.sequelize;
    if (!connection) {
      return [];
    }
    const rows = await connection.query<{
      status: string;
      count: string | number;
      clicks: string | number | null;
      unique_clicks: string | number | null;
      unsubscribes: string | number | null;
    }>(
      `SELECT status,
              COUNT(*)                          AS count,
              COALESCE(SUM(click_count), 0)     AS clicks,
              COUNT(first_clicked_at)           AS unique_clicks,
              COUNT(unsubscribed_at)            AS unsubscribes
         FROM email_campaign_recipients
        WHERE campaign_id = :campaignId
        GROUP BY status`,
      { type: QueryTypes.SELECT, replacements: { campaignId } },
    );
    return (rows ?? []).map((row) => ({
      status: row.status,
      count: Number(row.count ?? 0),
      clicks: Number(row.clicks ?? 0),
      uniqueClicks: Number(row.unique_clicks ?? 0),
      unsubscribes: Number(row.unsubscribes ?? 0),
    }));
  }

  /**
   * Closes out campaigns that have no claimable work left.
   *
   * Without this, a campaign whose final recipient was delivered by another
   * instance (or in a sweep that then crashed) would sit in `SENDING`
   * forever, because nothing would ever claim a row for it again.
   */
  private async reconcileFinishedCampaigns(): Promise<void> {
    const connection = this.deps.sequelize;
    if (!connection) {
      return;
    }
    const rows = await connection.query<{ id: string }>(
      `SELECT c.id
         FROM email_campaigns c
        WHERE c.deleted_at IS NULL
          AND c.status IN (:active)
          AND NOT EXISTS (
                SELECT 1 FROM email_campaign_recipients r
                 WHERE r.campaign_id = c.id
                   AND r.status IN (:outstanding)
              )
        LIMIT 20`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          active: [MarketingCampaignStatus.SCHEDULED, MarketingCampaignStatus.SENDING],
          outstanding: [
            MarketingRecipientStatus.PENDING,
            MarketingRecipientStatus.PROCESSING,
            MarketingRecipientStatus.RETRYING,
          ],
        },
      },
    );
    for (const { id } of rows ?? []) {
      await this.refreshCampaignProgress(id);
    }
  }
}
