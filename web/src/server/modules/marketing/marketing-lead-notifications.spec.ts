import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { MarketingLeadEventType } from '@school-bus-tracking/shared-types';
import {
  MarketingLeadNotifications,
  MARKETING_LEAD_NOTIFY_MAX_ATTEMPTS,
  buildLeadNotification,
} from './marketing-lead-notifications';
import type { EmailNotificationPayload } from '../notifications/providers/notification-provider.interface';
import type { MarketingLead, MarketingLeadEvent } from '../../database/models';

/**
 * The "new demo lead" notification rail.
 *
 * The invariants under test are the ones the feature hangs on: the lead is
 * already committed when this code runs, so nothing here may throw into the
 * caller, loop forever against a dead relay, leak the visitor's message
 * body, or route mail anywhere but MARKETING_ADMIN_EMAILS.
 */

const LEAD_ID = 'lead-0000-0000-4000-8000-000000000001';

function fakeLead(overrides: Partial<Record<string, unknown>> = {}): MarketingLead {
  return {
    id: LEAD_ID,
    full_name: 'Asha Verma',
    normalized_email: 'asha@greenfield.example',
    institution_name: 'Greenfield Public School',
    phone: '+91 98x xx xx',
    city: 'Pune',
    country: 'IN',
    message: 'SECRET-FREE-TEXT We have 14 buses and want live tracking.',
    status: 'NEW',
    source: 'LANDING_PAGE',
    utm: { utm_source: 'newsletter' },
    campaign_id: null,
    campaign_recipient_id: null,
    created_at: new Date('2026-09-28T08:00:00.000Z'),
    ...overrides,
  } as never;
}

function harness(options: {
  adminEmails?: string[];
  outcomes?: Array<'ok' | 'fail' | 'throw'>;
  maxAttempts?: number;
} = {}) {
  const sent: EmailNotificationPayload[] = [];
  const sleeps: number[] = [];
  const updates: Array<{ values: Record<string, unknown>; where: Record<string, unknown> }> = [];
  const events: Array<Record<string, unknown>> = [];
  const outcomes = [...(options.outcomes ?? ['ok'])];

  const provider = {
    async send(payload: EmailNotificationPayload) {
      sent.push(payload);
      const outcome = outcomes.shift() ?? 'ok';
      if (outcome === 'throw') {
        throw new Error('relay unreachable');
      }
      return { success: outcome === 'ok', provider: 'smtp', retryable: true, messageId: 'x' };
    },
  };
  const leads = {
    async update(values: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
      updates.push({ values, where: opts.where });
      return [1];
    },
  };
  const eventModel = {
    async create(values: Record<string, unknown>) {
      events.push(values);
      return values;
    },
  };

  const notifier = new MarketingLeadNotifications({
    emailProvider: provider as never,
    adminEmails: () => options.adminEmails ?? ['zeromilesystems@gmail.com'],
    appUrl: () => 'https://app.zeromilesystems.example',
    leads: leads as never as typeof MarketingLead,
    events: eventModel as never as typeof MarketingLeadEvent,
    maxAttempts: options.maxAttempts,
    retryDelayMs: 30_000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  return { notifier, sent, sleeps, updates, events };
}

describe('MarketingLeadNotifications', () => {
  it('emails only MARKETING_ADMIN_EMAILS and records success on the lead', async () => {
    const { notifier, sent, updates, events } = harness({
      adminEmails: ['zeromilesystems@gmail.com'],
    });

    const delivered = await notifier.deliver(fakeLead());

    assert.equal(delivered, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'zeromilesystems@gmail.com');
    assert.equal(updates.length, 1, 'admin_notified_at is stamped');
    assert.ok(updates[0].values.admin_notified_at instanceof Date);
    assert.deepEqual(updates[0].where, { id: LEAD_ID });
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, MarketingLeadEventType.ADMIN_NOTIFIED);
    assert.equal(events[0].actor, 'system');
  });

  it('retries once, then records ADMIN_NOTIFY_FAILED — never an infinite loop', async () => {
    const { notifier, sent, sleeps, updates, events } = harness({
      outcomes: ['fail', 'fail', 'fail', 'fail'],
    });

    const delivered = await notifier.deliver(fakeLead());

    assert.equal(delivered, false);
    assert.equal(sent.length, MARKETING_LEAD_NOTIFY_MAX_ATTEMPTS, 'bounded attempts');
    assert.equal(sleeps.length, MARKETING_LEAD_NOTIFY_MAX_ATTEMPTS - 1, 'one pause between them');
    assert.equal(updates.length, 0, 'the lead row is not stamped as notified');
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, MarketingLeadEventType.ADMIN_NOTIFY_FAILED);
    const metadata = events[0].metadata as { reason: string };
    assert.ok(metadata.reason.length <= 120, 'failure class only, no transcript');
  });

  it('a throwing provider is contained the same way', async () => {
    const { notifier, events } = harness({ outcomes: ['throw', 'throw'] });

    const delivered = await notifier.deliver(fakeLead());

    assert.equal(delivered, false);
    assert.equal(events[0].event_type, MarketingLeadEventType.ADMIN_NOTIFY_FAILED);
  });

  it('succeeds on the retry after a transient failure', async () => {
    const { notifier, sent, events } = harness({ outcomes: ['fail', 'ok'] });

    const delivered = await notifier.deliver(fakeLead());

    assert.equal(delivered, true);
    assert.equal(sent.length, 2);
    assert.equal(events[0].event_type, MarketingLeadEventType.ADMIN_NOTIFIED);
  });

  it('empty MARKETING_ADMIN_EMAILS: nothing is sent, the failure is recorded, the lead survives', async () => {
    const { notifier, sent, events } = harness({ adminEmails: [] });

    const delivered = await notifier.deliver(fakeLead());

    assert.equal(delivered, false);
    assert.equal(sent.length, 0);
    assert.equal(events[0].event_type, MarketingLeadEventType.ADMIN_NOTIFY_FAILED);
    assert.deepEqual(events[0].metadata, { reason: 'no-admin-recipients' });
  });

  it('notifyNewLead is fire-and-forget and never throws into the caller', async () => {
    const { notifier } = harness({ outcomes: ['throw', 'throw'] });
    assert.doesNotThrow(() => notifier.notifyNewLead(fakeLead()));
    await new Promise((resolve) => setTimeout(resolve, 5));
  });

  it('the notification carries contact facts and the console deep link, never the message body', () => {
    const { subject, body } = buildLeadNotification(
      fakeLead(),
      'https://app.zeromilesystems.example/',
    );

    assert.ok(subject.includes('Asha Verma'));
    assert.ok(body.includes('asha@greenfield.example'));
    assert.ok(body.includes('Greenfield Public School'));
    assert.ok(body.includes('Pune, IN'));
    assert.ok(
      body.includes(`https://app.zeromilesystems.example/admin/marketing/leads/${LEAD_ID}`),
      'deep link uses APP_URL (trailing slash normalized), never localhost',
    );
    assert.equal(body.includes('localhost'), false);
    assert.equal(body.includes('SECRET-FREE-TEXT'), false, 'free-text message stays in the console');
  });

  it('attributed leads name the campaign id, not a recipient address', () => {
    const { body } = buildLeadNotification(
      fakeLead({ campaign_id: 'c-77', campaign_recipient_id: 'r-9' }),
      'https://app.zeromilesystems.example',
    );
    assert.ok(body.includes('Campaign c-77'));
    assert.ok(body.includes('recipient-level attribution'));
  });
});
