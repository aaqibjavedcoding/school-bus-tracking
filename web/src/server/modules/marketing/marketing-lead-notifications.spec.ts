import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { MarketingErrorCategory } from '@school-bus-tracking/shared-types';
import {
  MarketingLeadNotifications,
  buildLeadNotification,
} from './marketing-lead-notifications';
import type { EmailNotificationPayload } from '../notifications/providers/notification-provider.interface';
import type { MarketingLead } from '../../database/models';

/**
 * The "new demo lead" notification **message and single attempt**.
 *
 * Retries, leases and durability moved to the notification worker in
 * Hardening 5B, so what is pinned here is the rest: the message never
 * carries the visitor's free text, mail goes only to
 * `MARKETING_ADMIN_EMAILS`, and every failure comes back as a safe category
 * rather than a provider transcript.
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

function harness(
  options: {
    adminEmails?: string[];
    outcome?: 'ok' | 'retryable' | 'permanent' | 'throw';
  } = {},
) {
  const sent: EmailNotificationPayload[] = [];
  const provider = {
    async send(payload: EmailNotificationPayload) {
      sent.push(payload);
      switch (options.outcome ?? 'ok') {
        case 'throw':
          throw new Error('relay unreachable: user=smtp-user pass=hunter2');
        case 'retryable':
          return { success: false, provider: 'smtp', retryable: true };
        case 'permanent':
          return { success: false, provider: 'smtp', retryable: false };
        default:
          return { success: true, provider: 'smtp', retryable: false, messageId: 'mid-1' };
      }
    },
  };

  const notifier = new MarketingLeadNotifications({
    emailProvider: provider as never,
    adminEmails: () => options.adminEmails ?? ['zeromilesystems@gmail.com'],
    appUrl: () => 'https://app.zeromilesystems.example',
  });

  return { notifier, sent };
}

describe('MarketingLeadNotifications', () => {
  it('emails only MARKETING_ADMIN_EMAILS and reports the provider message id', async () => {
    const { notifier, sent } = harness({ adminEmails: ['zeromilesystems@gmail.com'] });

    const outcome = await notifier.sendOnce(fakeLead());

    assert.equal(outcome.sent, true);
    assert.equal(outcome.category, null);
    assert.equal(outcome.providerMessageId, 'mid-1');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'zeromilesystems@gmail.com');
  });

  it('classifies a retryable provider rejection without a transcript', async () => {
    const { notifier } = harness({ outcome: 'retryable' });

    const outcome = await notifier.sendOnce(fakeLead());

    assert.equal(outcome.sent, false);
    assert.equal(outcome.retryable, true);
    assert.equal(outcome.category, MarketingErrorCategory.TRANSIENT);
  });

  it('classifies a permanent rejection as non-retryable', async () => {
    const { notifier } = harness({ outcome: 'permanent' });

    const outcome = await notifier.sendOnce(fakeLead());

    assert.equal(outcome.sent, false);
    assert.equal(outcome.retryable, false);
    assert.equal(outcome.category, MarketingErrorCategory.PERMANENT);
  });

  it('never lets a thrown SMTP error (which can quote credentials) escape', async () => {
    const { notifier } = harness({ outcome: 'throw' });

    const outcome = await notifier.sendOnce(fakeLead());

    assert.equal(outcome.sent, false);
    assert.equal(outcome.retryable, true);
    assert.equal(outcome.category, MarketingErrorCategory.UNKNOWN);
    // The category is an enum member — there is nowhere for a transcript to
    // hide in the outcome the worker persists.
    assert.ok(!JSON.stringify(outcome).includes('hunter2'));
  });

  it('reports a missing MARKETING_ADMIN_EMAILS as a non-retryable configuration failure', async () => {
    const { notifier, sent } = harness({ adminEmails: [] });

    const outcome = await notifier.sendOnce(fakeLead());

    assert.equal(sent.length, 0, 'nothing is sent without a configured recipient');
    assert.equal(outcome.sent, false);
    assert.equal(outcome.retryable, false, 'waiting cannot add an address to the environment');
    assert.equal(outcome.category, MarketingErrorCategory.NOT_CONFIGURED);
  });
});

describe('buildLeadNotification', () => {
  it('carries follow-up details and a console link but never the message body', () => {
    const { subject, body } = buildLeadNotification(
      fakeLead(),
      'https://app.zeromilesystems.example/',
    );

    assert.match(subject, /New demo request: Asha Verma/);
    assert.match(body, /asha@greenfield\.example/);
    assert.match(body, /Greenfield Public School/);
    assert.match(
      body,
      /https:\/\/app\.zeromilesystems\.example\/admin\/marketing\/leads\/lead-0000/,
    );
    assert.ok(!body.includes('SECRET-FREE-TEXT'), 'the visitor message body stays in the console');
  });

  it('names the campaign when the lead was attributed', () => {
    const { body } = buildLeadNotification(
      fakeLead({ campaign_id: 'camp-1', campaign_recipient_id: 'rec-1' }),
      'https://app.zeromilesystems.example',
    );
    assert.match(body, /Campaign camp-1 \(recipient-level attribution\)/);
  });
});
