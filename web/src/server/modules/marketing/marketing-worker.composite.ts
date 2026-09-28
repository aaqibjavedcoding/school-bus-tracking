/**
 * One runnable, two queues.
 *
 * The marketing scheduler (`marketing-delivery.scheduler.ts`) owns a single
 * timer per process — deliberately, because a second timer is a second thing
 * to start, stop, guard against double-start and reason about during a
 * redeploy. Hardening 5B adds a *second* durable queue (admin notifications)
 * that needs the same cadence, so it is driven by the same tick through this
 * composite rather than by a new scheduler.
 *
 * The two workers stay completely separate objects with separate tables,
 * separate advisory locks, separate policies and separate caps: this file
 * only decides the order they run in.
 *
 * Order matters, and it is notifications first: a demo lead is an operator
 * waiting for an email, while campaign delivery is bulk work that is paced
 * on purpose. Running notifications first means a 5,000-recipient campaign
 * sweep can never delay a sales notification by a full interval. A failure
 * in either queue is recorded in its own summary and never prevents the
 * other from running.
 */

import type { MarketingSweepSummary } from './marketing-delivery.worker';
import type { MarketingNotificationSweepSummary } from './marketing-notification.worker';

/** The delivery half of the composite (the real worker, or a fake). */
export interface MarketingDeliveryRunnableLike {
  runOnce(): Promise<MarketingSweepSummary>;
  shutdown?(): void;
}

/** The notification half of the composite. */
export interface MarketingNotificationRunnableLike {
  runOnce(): Promise<MarketingNotificationSweepSummary>;
  shutdown?(): void;
}

/** Combined result of one tick — numbers only, safe to log verbatim. */
export interface MarketingCompositeSweepSummary extends MarketingSweepSummary {
  notifications: MarketingNotificationSweepSummary;
}

const EMPTY_NOTIFICATION_SUMMARY: MarketingNotificationSweepSummary = {
  skipped: true,
  claimed: 0,
  sent: 0,
  retrying: 0,
  failed: 0,
  expired: 0,
};

/**
 * Wraps both marketing workers behind the scheduler's `runOnce`/`shutdown`
 * contract.
 */
export function createMarketingCompositeWorker(
  delivery: MarketingDeliveryRunnableLike,
  notifications: MarketingNotificationRunnableLike,
): {
  runOnce(): Promise<MarketingCompositeSweepSummary>;
  shutdown(): void;
} {
  return {
    async runOnce(): Promise<MarketingCompositeSweepSummary> {
      let notificationSummary = EMPTY_NOTIFICATION_SUMMARY;
      try {
        notificationSummary = await notifications.runOnce();
      } catch {
        // The notification worker already logs its own failures without
        // payload detail; swallowing here guarantees campaign delivery still
        // gets its tick.
        notificationSummary = { ...EMPTY_NOTIFICATION_SUMMARY, fatalError: true };
      }
      const deliverySummary = await delivery.runOnce();
      return { ...deliverySummary, notifications: notificationSummary };
    },
    shutdown(): void {
      notifications.shutdown?.();
      delivery.shutdown?.();
    },
  };
}
