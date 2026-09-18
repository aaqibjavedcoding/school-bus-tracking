import { createHash } from 'node:crypto';
import { Op, QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import type { Transaction } from 'sequelize';
import { Logger } from '../../../framework';
import { NotificationType, TripStatus } from '@school-bus-tracking/shared-types';
import { isTripTrackingActive } from '@school-bus-tracking/validation';
import { Notification, Trip } from '../../../database/models';
import { DeviceTokensService } from '../device-tokens.service';
import type { DeviceDeliveryOutcome, PushNotificationProvider } from '../providers';
import { emptyDeviceOutcome } from '../providers';
import {
  decideDelivery,
  DELIVERY_ABANDON_REASONS,
  backoffDelayMs,
  type DeliveryPolicyConfig,
  type DeliveryOutcomeDecision,
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
 * Durable push delivery worker (Phase 2) — a database-backed outbox over the
 * existing `notifications` table.
 *
 * Sweeps rows whose `next_attempt_at` is due, claims them **per school**
 * under a transaction-scoped PostgreSQL advisory lock (same technique as the
 * retention worker, so any number of API instances stay safe), delivers
 * through the platform-aware push provider and writes the outcome back:
 *
 * - provider-accepted device(s) → `push_status = 'sent'`, tokens in
 *   `delivered_tokens` (accepted ≠ confirmed on-device delivery);
 * - transient failure → `failed` + bounded exponential backoff;
 * - permanent failure / invalid tokens → abandoned, tokens retired;
 * - expired rows (`push_expires_at`) or proximity alerts whose trip stopped
 *   tracking → abandoned with a reason, never delivered late.
 *
 * The worker never throws out of a sweep: a failed pass is logged and
 * retried on the next tick.
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
      const decision = await this.evaluate(row, now, transaction);
      await this.applyDecision(row, decision, now, transaction);
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
    const attempt = (row.delivery_retry_count ?? 0) + 1;

    // 1. Event expiry: late alerts are never delivered.
    if (row.push_expires_at && row.push_expires_at.getTime() <= now.getTime()) {
      return abandonDecision(DELIVERY_ABANDON_REASONS.expired);
    }

    // 2. Proximity alerts die with the trip's active window.
    if (row.type === NotificationType.STOP_ARRIVED && row.trip_id) {
      const trip = await this.trips.findOne({
        where: { id: row.trip_id, school_id: row.school_id },
        attributes: ['id', 'status'],
        transaction,
      });
      if (!trip || !isTripTrackingActive(trip.status as TripStatus)) {
        return abandonDecision(DELIVERY_ABANDON_REASONS.tripEnded);
      }
    }

    // 3. Resolve active devices (with platform metadata).
    const targets = await this.deviceTokens.findActiveTokenTargets(row.school_id, row.user_id);

    // 4. Send through the platform-aware router (FCM for Android, APNs for iOS).
    let outcome: DeviceDeliveryOutcome;
    if (targets.length === 0) {
      outcome = emptyDeviceOutcome();
    } else {
      const tokens = targets.map((target) => target.token);
      try {
        const result = await this.pushProvider.send({
          recipientId: row.user_id,
          title: row.title,
          body: row.message,
          data: pushDataPayload(row),
          deviceTokens: tokens,
          tokenPlatforms: targets.map((target) => target.platform),
          priority: 'high',
        });
        outcome = result.deviceOutcome ?? fallbackOutcome(result, tokens);
      } catch (error) {
        // The providers are already expected to swallow their own errors;
        // this belt-and-braces guard keeps an unexpected throw from rolling
        // back the whole school's batch — it degrades to a retryable outcome.
        this.logger.warn(
          `Push provider threw for notification ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        outcome = { delivered: [], retryable: [...tokens], invalid: [], notConfigured: [] };
      }

      // Retire invalid tokens immediately (rows stay as audit trail).
      if (outcome.invalid.length > 0) {
        await this.deviceTokens.deactivateTokens(row.school_id, row.user_id, outcome.invalid);
      }
    }

    return decideDelivery(outcome, targets.length > 0, this.policy, attempt);
  }

  private async applyDecision(
    row: Notification,
    decision: DeliveryOutcomeDecision,
    now: Date,
    transaction: Transaction,
  ): Promise<void> {
    const attempt = (row.delivery_retry_count ?? 0) + 1;
    if (decision.status === 'sent') {
      await row.update(
        {
          push_status: 'sent',
          delivery_retry_count: 0,
          last_delivery_attempt_at: now,
          delivery_failure_reason: null,
          delivery_failure_kind: null,
          delivery_abandoned_reason: null,
          next_attempt_at: null,
          // Provider-accepted devices only — never a claim of on-device display.
          delivered_tokens: decision.deliveredTokens.length > 0 ? decision.deliveredTokens : null,
        },
        { transaction },
      );
      return;
    }
    if (decision.abandon) {
      await row.update(
        {
          push_status: decision.status,
          delivery_failure_kind: 'permanent',
          delivery_failure_reason: decision.reason,
          delivery_abandoned_reason: decision.reason,
          delivery_retry_count: attempt,
          last_delivery_attempt_at: now,
          next_attempt_at: null,
        },
        { transaction },
      );
      return;
    }
    const nextAttempt = new Date(
      now.getTime() + backoffDelayMs(this.policy.baseBackoffMs, attempt),
    );
    await row.update(
      {
        push_status: 'failed',
        delivery_failure_kind: decision.kind ?? 'transient',
        delivery_failure_reason: decision.reason,
        delivery_retry_count: attempt,
        last_delivery_attempt_at: now,
        next_attempt_at: nextAttempt,
      },
      { transaction },
    );
  }
}

function abandonDecision(reason: string): DeliveryOutcomeDecision {
  return { status: 'failed', reason, kind: 'permanent', abandon: true, deliveredTokens: [] };
}

function fallbackOutcome(
  result: { success: boolean; retryable: boolean; invalidTokens?: string[] },
  tokens: string[],
): DeviceDeliveryOutcome {
  const invalid = new Set(result.invalidTokens ?? []);
  return {
    delivered: result.success ? tokens.filter((token) => !invalid.has(token)) : [],
    retryable: result.retryable ? tokens.filter((token) => !invalid.has(token)) : [],
    invalid: [...invalid],
    notConfigured: [],
  };
}

/** 31-bit hash of the school UUID for the advisory-lock key. */
function hashSchoolId(schoolId: string): number {
  const digest = createHash('sha1').update(schoolId).digest();
  return digest.readUInt32BE(0) & 0x7fffffff;
}
