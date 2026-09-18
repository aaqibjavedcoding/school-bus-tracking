import { createHash } from 'node:crypto';
import { Op, QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import type { Transaction } from 'sequelize';
import { Logger } from '../../../framework';
import { NotificationType, TripStatus } from '@school-bus-tracking/shared-types';
import { isTripTrackingActive } from '@school-bus-tracking/validation';
import { Notification, Trip } from '../../../database/models';
import { DeviceTokensService } from '../device-tokens.service';
import { NOOP_PUSH_PROVIDER_NAME } from '../notifications.constants';
import {
  emptyDeviceOutcome,
  type DeviceDeliveryOutcome,
  type PushNotificationProvider,
} from '../providers';
import {
  decideDelivery,
  DELIVERY_ABANDON_REASONS,
  backoffDelayMs,
  type DeliveryOutcomeDecision,
  type DeliveryPolicyConfig,
} from './delivery-policy';

/** Advisory-lock class id for the outbox (distinct from retention's key). */
const OUTBOX_LOCK_CLASS = 714_290_001;

/** How many separate claims a single school may perform in one sweep. */
const MAX_BATCHES_PER_SCHOOL = 5;

/** The push payload the delivery pipeline sends (shared with the creation path). */
export function pushDataPayload(row: {
  school_id: string;
  user_id: string;
  type: string;
  id: string;
  trip_id: string | null;
  student_id: string | null;
  stop_id: string | null;
}): Record<string, string> {
  const data: Record<string, string> = {
    school_id: row.school_id,
    user_id: row.user_id,
    type: row.type,
    id: row.id,
  };
  for (const [key, value] of [
    ['trip_id', row.trip_id],
    ['student_id', row.student_id],
    ['stop_id', row.stop_id],
  ] as const) {
    if (value) {
      data[key] = value;
    }
  }
  return data;
}

export interface DeliverySweepSummary {
  skipped: boolean;
  claimed: number;
  sent: number;
  failed: number;
  abandoned: number;
}

/**
 * Durable push delivery worker (Phase 2, hardened by the corrective patch) —
 * a database-backed outbox over the existing `notifications` table.
 *
 * Sweeps rows whose `next_attempt_at` is due, claims them **per school**
 * under a transaction-scoped PostgreSQL advisory lock (same technique as the
 * retention worker, so any number of API instances stay safe), delivers
 * through the platform-aware push provider and writes the outcome back in the
 * same transaction.
 *
 * ### Per-device delivery (corrective patch)
 *
 * A notification row belongs to one recipient who may have several devices.
 * Each attempt therefore targets only the device tokens that are still owed a
 * provider-accepted delivery:
 *
 * - `delivered_tokens` — accepted devices, **accumulated** across attempts
 *   (never overwritten, so a crash/restart cannot lose an accepted device);
 * - `delivery_pending_tokens` — devices still owed a delivery, written in the
 *   same transaction as the attempt.
 *
 * A device that succeeds is never re-sent; a device that fails transiently is
 * retried with bounded exponential backoff; an invalid token is retired
 * immediately without affecting the others; and the row only becomes `sent`
 * when every targeted device was accepted. If some devices never made it
 * (retired tokens, exhausted attempts, config failure or a closed event
 * window) the row ends as `partial` — the failed devices are never presented
 * as delivered.
 *
 * ### Token rotation / new devices
 *
 * The target set is fixed by the first attempt. Tokens that disappear during
 * the window (logout, unregister, invalidated) are dropped from the pending
 * set, and **newly registered devices are not added** to an in-flight
 * delivery: the alert is already in the recipient's in-app inbox, and adding
 * recipients mid-retry would let a parent who keeps reinstalling expand the
 * delivery forever.
 *
 * ### Delivery semantics
 *
 * Acceptance by FCM/APNs (`delivered_tokens`) is proof that the *provider*
 * took the message, never that the phone displayed it. Exactly-once delivery
 * is not promised either: if a provider accepted a push but this process died
 * before its transaction committed, the row is re-claimed and the device may
 * receive the push twice (at-least-once). Notification and event ids are
 * stable, so a duplicate is idempotent on the client.
 */
export class DeliveryWorker {
  private readonly logger = new Logger(DeliveryWorker.name);

  constructor(
    private readonly notifications: typeof Notification,
    private readonly trips: typeof Trip,
    private readonly deviceTokens: DeviceTokensService,
    private readonly pushProvider: PushNotificationProvider,
    private readonly sequelize: Sequelize | null,
    private readonly policy: DeliveryPolicyConfig,
  ) {}

  /** Runs one sweep. Returns a summary; never throws. */
  async runOnce(): Promise<DeliverySweepSummary> {
    if (!this.sequelize) {
      this.logger.warn('Notification delivery sweep skipped — no database connection.');
      return { skipped: true, claimed: 0, sent: 0, failed: 0, abandoned: 0 };
    }
    const summary: DeliverySweepSummary = {
      skipped: false,
      claimed: 0,
      sent: 0,
      failed: 0,
      abandoned: 0,
    };
    try {
      const connection = this.sequelize;

      // Distinct schools with due work — one row per school decides which
      // advisory locks to take.
      const dueSchools = await connection.query<{ school_id: string }>(
        `SELECT DISTINCT school_id
           FROM notifications
          WHERE deleted_at IS NULL
            AND push_status IN ('pending', 'failed')
            AND next_attempt_at IS NOT NULL
            AND next_attempt_at <= NOW()
          ORDER BY school_id
          LIMIT 50`,
        { type: QueryTypes.SELECT },
      );

      for (const { school_id } of dueSchools) {
        const lockKey = hashSchoolId(school_id);
        for (let batch = 0; batch < MAX_BATCHES_PER_SCHOOL; batch += 1) {
          const processed = await connection.transaction(async (transaction) => {
            const locked = await connection.query<{ locked: boolean }>(
              `SELECT pg_try_advisory_xact_lock(${OUTBOX_LOCK_CLASS}, ${lockKey}) AS locked`,
              { type: QueryTypes.SELECT, transaction },
            );
            if (!locked[0]?.locked) {
              return 0;
            }
            return this.processSchoolBatch(school_id, transaction, summary);
          });
          if (processed === 0) {
            break; // lock busy elsewhere, or no due rows remain
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Notification delivery sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return summary;
  }

  /** Processes up to `batchSize` due rows of one school inside a transaction. */
  private async processSchoolBatch(
    schoolId: string,
    transaction: Transaction,
    summary: DeliverySweepSummary,
  ): Promise<number> {
    const now = new Date();
    const rows = await this.notifications.findAll({
      where: {
        school_id: schoolId,
        push_status: { [Op.in]: ['pending', 'failed'] },
        next_attempt_at: { [Op.lte]: now },
      },
      order: [['next_attempt_at', 'ASC']],
      limit: this.policy.batchSize,
      transaction,
    });
    if (rows.length === 0) {
      return 0;
    }

    for (const row of rows) {
      summary.claimed += 1;
      // A fresh clock per notification: a long batch must not reuse one stale
      // "now", or a deadline that passes mid-batch would be ignored.
      const rowNow = new Date();
      const decision = await this.evaluate(row, rowNow, transaction);
      await this.applyDecision(row, decision, rowNow, transaction);
      if (decision.status === 'sent') {
        summary.sent += 1;
      } else if (decision.abandon) {
        summary.abandoned += 1;
      } else {
        summary.failed += 1;
      }
    }
    return rows.length;
  }

  /** Decides the outcome of one row: expiry, trip window, then provider send. */
  private async evaluate(
    row: Notification,
    now: Date,
    transaction: Transaction,
  ): Promise<DeliveryOutcomeDecision> {
    const attemptNumber = (row.delivery_retry_count ?? 0) + 1;
    const alreadyAccepted = row.delivered_tokens ?? [];

    // 0. A no-op provider (local dev / CI) must never look like a delivery.
    //    Rows created through the normal path are marked `not_configured` at
    //    creation; this covers rows recovered by the worker (crash window).
    if (this.pushProvider.name === NOOP_PUSH_PROVIDER_NAME) {
      return abandonWithAccepted(
        DELIVERY_ABANDON_REASONS.providerDisabled,
        alreadyAccepted,
        row.delivery_pending_tokens ?? [],
        'not_configured',
      );
    }

    // 1. Event expiry: late alerts are never delivered.
    if (row.push_expires_at && row.push_expires_at.getTime() <= now.getTime()) {
      return abandonWithAccepted(
        DELIVERY_ABANDON_REASONS.expired,
        alreadyAccepted,
        row.delivery_pending_tokens ?? [],
      );
    }

    // 2. Proximity alerts die with the trip's active window.
    if (row.type === NotificationType.STOP_ARRIVED && row.trip_id) {
      const trip = await this.trips.findOne({
        where: { id: row.trip_id, school_id: row.school_id },
        attributes: ['id', 'status'],
        transaction,
      });
      if (!trip || !isTripTrackingActive(trip.status as TripStatus)) {
        return abandonWithAccepted(
          DELIVERY_ABANDON_REASONS.tripEnded,
          alreadyAccepted,
          row.delivery_pending_tokens ?? [],
        );
      }
    }

    // 3. Resolve active devices (with platform metadata).
    const targets = await this.deviceTokens.findActiveTokenTargets(row.school_id, row.user_id);
    const activeTokens = new Set(targets.map((target) => target.token));

    // 4. Target only the devices still owed a delivery. A `null` pending set
    //    means "first attempt" (or a legacy row) → every active device. New
    //    devices registered later are deliberately NOT added, and tokens that
    //    vanished are dropped rather than retried forever.
    const pendingBaseline = row.delivery_pending_tokens ?? targets.map((target) => target.token);
    const attempted: string[] = [];
    const dropped: string[] = [];
    for (const token of pendingBaseline) {
      if (alreadyAccepted.includes(token)) {
        continue; // already accepted by a provider on an earlier attempt
      }
      if (activeTokens.has(token)) {
        attempted.push(token);
      } else {
        dropped.push(token);
      }
    }

    // 5. Send through the platform-aware router (FCM for Android, APNs for
    //    iOS), carrying the row's absolute deadline so the provider applies
    //    the remaining lifetime as FCM TTL / apns-expiration.
    let outcome: DeviceDeliveryOutcome = emptyDeviceOutcome();
    if (attempted.length > 0) {
      try {
        const result = await this.pushProvider.send({
          recipientId: row.user_id,
          title: row.title,
          body: row.message,
          data: pushDataPayload(row),
          deviceTokens: attempted,
          tokenPlatforms: targets
            .filter((target) => attempted.includes(target.token))
            .map((target) => target.platform),
          priority: 'high',
          expiresAt: row.push_expires_at ?? null,
        });
        outcome = result.deviceOutcome ?? fallbackOutcome(result, attempted);
      } catch (error) {
        // The providers are already expected to swallow their own errors;
        // this belt-and-braces guard keeps an unexpected throw from rolling
        // back the whole school's batch — it degrades to a retryable outcome.
        this.logger.warn(
          `Push provider threw for notification ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        outcome = { ...emptyDeviceOutcome(), retryable: [...attempted] };
      }

      // Retire invalid tokens immediately (rows stay as audit trail). The
      // update joins the attempt's transaction so a rollback cannot silently
      // deactivate a token without recording the outcome.
      if (outcome.invalid.length > 0) {
        await this.deviceTokens.deactivateTokens(row.school_id, row.user_id, outcome.invalid, {
          transaction,
        });
      }
    }

    return decideDelivery(
      {
        attemptNumber,
        attempted,
        outcome,
        alreadyAccepted,
        dropped,
        hasActiveDevices: targets.length > 0,
        deadlinePassed: false,
      },
      this.policy,
    );
  }

  private async applyDecision(
    row: Notification,
    decision: DeliveryOutcomeDecision,
    now: Date,
    transaction: Transaction,
  ): Promise<void> {
    const attemptNumber = (row.delivery_retry_count ?? 0) + 1;
    const deliveredTokens = decision.acceptedTokens.length > 0 ? decision.acceptedTokens : null;
    const pendingTokens = decision.pendingTokens.length > 0 ? decision.pendingTokens : null;

    if (decision.status !== 'failed' || decision.abandon) {
      // Terminal: complete success, partial terminal success, not-configured,
      // or a permanent failure. `delivered_tokens` always carries the
      // accumulated accepted devices so a partial row keeps its evidence.
      await row.update(
        {
          push_status: decision.status,
          delivery_retry_count: attemptNumber,
          last_delivery_attempt_at: now,
          delivery_failure_kind: decision.status === 'sent' ? null : 'permanent',
          delivery_failure_reason: decision.status === 'sent' ? null : decision.reason,
          delivery_abandoned_reason: decision.abandon ? decision.reason : null,
          next_attempt_at: null,
          delivered_tokens: deliveredTokens,
          delivery_pending_tokens: decision.status === 'sent' ? null : pendingTokens,
        },
        { transaction },
      );
      return;
    }

    const nextAttempt = new Date(
      now.getTime() + backoffDelayMs(this.policy.baseBackoffMs, attemptNumber),
    );
    await row.update(
      {
        push_status: 'failed',
        delivery_failure_kind: decision.kind ?? 'transient',
        delivery_failure_reason: decision.reason,
        delivery_retry_count: attemptNumber,
        last_delivery_attempt_at: now,
        next_attempt_at: nextAttempt,
        // Accumulated across attempts — an accepted device is never lost or
        // re-sent because a sibling device failed.
        delivered_tokens: deliveredTokens,
        delivery_pending_tokens: pendingTokens,
      },
      { transaction },
    );
  }
}

/**
 * Terminal decision when the attempt was abandoned *before* any send (event
 * window closed, trip ended, provider disabled). Keeps the devices that were
 * already accepted, and marks the row `partial` when some of them made it.
 */
function abandonWithAccepted(
  reason: string,
  acceptedTokens: string[],
  pendingTokens: string[],
  noAcceptedStatus: 'failed' | 'not_configured' = 'failed',
): DeliveryOutcomeDecision {
  const accepted = [...new Set(acceptedTokens)];
  const pending = [...new Set(pendingTokens)].filter((token) => !accepted.includes(token));
  if (accepted.length > 0) {
    return {
      status: 'partial',
      reason: `Delivered to ${accepted.length} device(s); ${pending.length} abandoned (${reason})`,
      kind: 'permanent',
      abandon: true,
      acceptedTokens: accepted,
      pendingTokens: pending,
      complete: false,
    };
  }
  return {
    status: noAcceptedStatus,
    reason,
    kind: 'permanent',
    abandon: true,
    acceptedTokens: [],
    pendingTokens: pending,
    complete: false,
  };
}

function fallbackOutcome(
  result: { success: boolean; retryable: boolean; invalidTokens?: string[] },
  tokens: string[],
): DeviceDeliveryOutcome {
  const invalid = new Set(result.invalidTokens ?? []);
  const outcome = emptyDeviceOutcome();
  outcome.invalid.push(...invalid);
  const rest = tokens.filter((token) => !invalid.has(token));
  if (result.success) {
    outcome.delivered.push(...rest);
  } else if (result.retryable) {
    outcome.retryable.push(...rest);
  } else {
    // Permanent without per-device detail: never retire a token on a bare
    // row-level failure.
    outcome.misconfigured.push(...rest);
  }
  return outcome;
}

/** 31-bit hash of the school UUID for the advisory-lock key. */
function hashSchoolId(schoolId: string): number {
  const digest = createHash('sha1').update(schoolId).digest();
  return digest.readUInt32BE(0) & 0x7fffffff;
}
