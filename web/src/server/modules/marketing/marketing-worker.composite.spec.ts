import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createMarketingCompositeWorker } from './marketing-worker.composite';
import type { MarketingSweepSummary } from './marketing-delivery.worker';
import type { MarketingNotificationSweepSummary } from './marketing-notification.worker';

/**
 * Two durable queues, one scheduler tick.
 *
 * The composite exists so Hardening 5B does not add a second timer to the
 * process. What must hold: notifications run first (an operator waiting for
 * a sales lead should never queue behind a 5,000-recipient campaign sweep),
 * a failure in one queue never starves the other, and shutdown reaches both.
 */

const DELIVERY_SUMMARY: MarketingSweepSummary = {
  skipped: false,
  claimed: 3,
  sent: 3,
  retrying: 0,
  failed: 0,
  suppressed: 0,
  expired: 0,
  cancelled: 0,
  rateLimited: false,
};

const NOTIFICATION_SUMMARY: MarketingNotificationSweepSummary = {
  skipped: false,
  claimed: 1,
  sent: 1,
  retrying: 0,
  failed: 0,
  expired: 0,
};

function fakes(options: { notificationsThrow?: boolean; deliveryThrows?: boolean } = {}) {
  const order: string[] = [];
  const shutdowns: string[] = [];

  const delivery = {
    async runOnce() {
      order.push('delivery');
      if (options.deliveryThrows) {
        throw new Error('delivery exploded');
      }
      return DELIVERY_SUMMARY;
    },
    shutdown() {
      shutdowns.push('delivery');
    },
  };

  const notifications = {
    async runOnce() {
      order.push('notifications');
      if (options.notificationsThrow) {
        throw new Error('notifications exploded');
      }
      return NOTIFICATION_SUMMARY;
    },
    shutdown() {
      shutdowns.push('notifications');
    },
  };

  return { delivery, notifications, order, shutdowns };
}

describe('createMarketingCompositeWorker', () => {
  it('runs notifications before delivery and merges both summaries', async () => {
    const { delivery, notifications, order } = fakes();
    const worker = createMarketingCompositeWorker(delivery, notifications);

    const summary = await worker.runOnce();

    assert.deepEqual(order, ['notifications', 'delivery']);
    assert.equal(summary.sent, DELIVERY_SUMMARY.sent);
    assert.deepEqual(summary.notifications, NOTIFICATION_SUMMARY);
  });

  it('still ticks campaign delivery when the notification queue fails', async () => {
    const { delivery, notifications, order } = fakes({ notificationsThrow: true });
    const worker = createMarketingCompositeWorker(delivery, notifications);

    const summary = await worker.runOnce();

    assert.deepEqual(order, ['notifications', 'delivery']);
    assert.equal(summary.notifications.fatalError, true);
    assert.equal(summary.notifications.sent, 0);
    assert.equal(summary.sent, DELIVERY_SUMMARY.sent, 'delivery is unaffected');
  });

  it('propagates a delivery failure to the scheduler, which already handles it', async () => {
    const { delivery, notifications } = fakes({ deliveryThrows: true });
    const worker = createMarketingCompositeWorker(delivery, notifications);

    await assert.rejects(worker.runOnce(), { message: 'delivery exploded' });
  });

  it('fans shutdown out to both queues', () => {
    const { delivery, notifications, shutdowns } = fakes();
    const worker = createMarketingCompositeWorker(delivery, notifications);

    worker.shutdown();

    assert.deepEqual(shutdowns.sort(), ['delivery', 'notifications']);
  });

  it('tolerates halves that expose no shutdown at all', () => {
    const worker = createMarketingCompositeWorker(
      { async runOnce() { return DELIVERY_SUMMARY; } },
      { async runOnce() { return NOTIFICATION_SUMMARY; } },
    );
    assert.doesNotThrow(() => worker.shutdown());
  });
});
