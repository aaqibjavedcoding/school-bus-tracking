import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { MarketingErrorCategory } from '@school-bus-tracking/shared-types';
import { MarketingAdminAlerts } from './marketing-admin-alerts';
import type { EmailNotificationPayload } from '../notifications/providers/notification-provider.interface';

/**
 * The operational alert rail.
 *
 * Two properties matter more than the wording of the mail: an alert must
 * never reach a campaign recipient, and a failing relay must never turn the
 * alerting itself into a mail loop that the worker then waits on.
 */

function harness(options: {
  adminEmails?: string[];
  fail?: boolean;
  throws?: boolean;
  now?: () => number;
  cooldownMs?: number;
} = {}) {
  const sent: EmailNotificationPayload[] = [];
  const provider = {
    async send(payload: EmailNotificationPayload) {
      sent.push(payload);
      if (options.throws) {
        throw new Error('relay unreachable');
      }
      return {
        success: !options.fail,
        provider: 'smtp',
        retryable: true,
        messageId: 'x',
      };
    },
  };
  const alerts = new MarketingAdminAlerts({
    emailProvider: provider as never,
    adminEmails: () => options.adminEmails ?? ['zeromilesystems@gmail.com'],
    now: options.now,
    cooldownMs: options.cooldownMs,
  });
  return { alerts, sent };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('MarketingAdminAlerts', () => {
  it('emails only the configured admin address, never a campaign recipient', async () => {
    const { alerts, sent } = harness({ adminEmails: ['ops@zeromilesystems.test'] });

    alerts.campaignDeliveryExhausted({
      campaignId: 'c-1',
      failureCategory: MarketingErrorCategory.TRANSIENT,
      attempts: 5,
    });
    await settle();

    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'ops@zeromilesystems.test');
  });

  it('returns immediately — a slow relay must never hold up a sweep', () => {
    const { alerts } = harness();
    const before = Date.now();
    alerts.workerFailure({ stage: 'startup', message: 'no connection' });
    assert.ok(Date.now() - before < 50, 'alerting is fire-and-forget');
  });

  it('carries ids, counts and categories only', async () => {
    const { alerts, sent } = harness();

    alerts.campaignDeliveryExhausted({
      campaignId: 'c-42',
      failureCategory: MarketingErrorCategory.PERMANENT,
      attempts: 5,
    });
    await settle();

    const body = `${sent[0].subject} ${sent[0].body}`;
    assert.ok(body.includes('c-42'));
    assert.ok(body.includes(MarketingErrorCategory.PERMANENT));
    assert.equal(/@school\.test|@gmail\.com/.test(sent[0].body), false, 'no recipient address');
    assert.equal(body.toLowerCase().includes('smtp_pass'), false);
  });

  it('collapses a storm of identical alerts into one message', async () => {
    let clock = 0;
    const { alerts, sent } = harness({ now: () => clock, cooldownMs: 1000 });

    for (let index = 0; index < 500; index += 1) {
      alerts.campaignDeliveryExhausted({
        campaignId: 'c-1',
        failureCategory: MarketingErrorCategory.TRANSIENT,
        attempts: 5,
      });
    }
    await settle();
    assert.equal(sent.length, 1, '500 failed recipients must not produce 500 emails');

    clock += 2000;
    alerts.campaignDeliveryExhausted({
      campaignId: 'c-1',
      failureCategory: MarketingErrorCategory.TRANSIENT,
      attempts: 5,
    });
    await settle();
    assert.equal(sent.length, 2, 'the cooldown expires and alerting resumes');
  });

  it('keeps separate cooldowns per campaign and per stage', async () => {
    const { alerts, sent } = harness({ now: () => 0, cooldownMs: 10_000 });

    alerts.campaignDeliveryExhausted({
      campaignId: 'c-1',
      failureCategory: MarketingErrorCategory.TRANSIENT,
      attempts: 5,
    });
    alerts.campaignDeliveryExhausted({
      campaignId: 'c-2',
      failureCategory: MarketingErrorCategory.TRANSIENT,
      attempts: 5,
    });
    alerts.workerFailure({ stage: 'sweep', message: 'boom' });
    await settle();

    assert.equal(sent.length, 3);
  });

  it('never alerts about a failed alert (no mail loop)', async () => {
    const { alerts, sent } = harness({ throws: true });

    alerts.workerFailure({ stage: 'sweep', message: 'first failure' });
    await settle();

    assert.equal(sent.length, 1, 'the failing send does not schedule another alert');
  });

  it('swallows a provider rejection instead of propagating it', async () => {
    const { alerts } = harness({ fail: true });
    assert.doesNotThrow(() =>
      alerts.workerFailure({ stage: 'startup', message: 'configuration invalid' }),
    );
    await settle();
  });

  it('sends nothing when MARKETING_ADMIN_EMAILS is empty', async () => {
    const { alerts, sent } = harness({ adminEmails: [] });

    alerts.workerFailure({ stage: 'sweep', message: 'boom' });
    await settle();

    assert.equal(sent.length, 0, 'routing is configuration; with none configured, nobody is mailed');
  });

  it('truncates the detail it echoes back', async () => {
    const { alerts, sent } = harness();

    alerts.workerFailure({ stage: 'sweep', message: 'x'.repeat(5000) });
    await settle();

    assert.ok(sent[0].body.length < 1000, 'alert bodies are bounded');
  });
});
