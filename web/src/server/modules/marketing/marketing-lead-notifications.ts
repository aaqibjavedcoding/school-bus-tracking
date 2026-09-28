/**
 * The "new demo lead" notification **message** — content and one send
 * attempt. Scheduling, retries, leases and durability belong to
 * {@link MarketingNotificationWorker}; this module only knows how to build a
 * safe message and hand it to the email provider once.
 *
 * Why the split (Hardening 5B): the Session 4 version owned an in-memory
 * retry loop, which meant a container restart between the attempts silently
 * dropped the notification. The job row in `marketing_notification_jobs` now
 * owns the retry state, and this class is the pure "send it once" step the
 * worker calls under a lease.
 *
 * Invariants:
 *
 * 1. **Recipients come only from `MARKETING_ADMIN_EMAILS`**, read at call
 *    time. Nothing a visitor submitted, and nothing the browser sent, can
 *    influence where an operational notification goes.
 * 2. **Safe content only.** The message carries the fields an operator needs
 *    to follow up (name, work email, institution, location, phone, source,
 *    campaign id, created time) plus a console deep link built from
 *    `APP_URL`. Never the free-text message body, never credentials, never
 *    token material — and nothing of it is ever logged.
 * 3. **Failures are classified, never transcribed.** The outcome carries a
 *    {@link MarketingErrorCategory}, not the provider's reply: SMTP
 *    transcripts can echo credentials, hostnames and message content.
 */

import { MarketingErrorCategory } from '@school-bus-tracking/shared-types';
import { Logger } from '../../framework';
import type { EmailNotificationProvider } from '../notifications/providers/notification-provider.interface';
import type { MarketingLead } from '../../database/models';

/** Outcome of one notification attempt. */
export interface MarketingLeadNotificationOutcome {
  sent: boolean;
  /** Safe failure class; `null` on success. */
  category: MarketingErrorCategory | null;
  /** True when another attempt could plausibly succeed. */
  retryable: boolean;
  providerMessageId: string | null;
}

export interface MarketingLeadNotificationsOptions {
  emailProvider: EmailNotificationProvider;
  /** Read at call time so a configuration change needs no restart. */
  adminEmails: () => string[];
  /** Public origin for the console deep link (`APP_URL`). */
  appUrl: () => string;
}

export class MarketingLeadNotifications {
  private readonly logger = new Logger(MarketingLeadNotifications.name);

  constructor(private readonly options: MarketingLeadNotificationsOptions) {}

  /**
   * Sends the notification for one lead, exactly once.
   *
   * Never throws: a provider that rejects, times out or is misconfigured
   * produces a classified outcome the worker turns into a retry or a
   * terminal failure.
   */
  async sendOnce(lead: MarketingLead): Promise<MarketingLeadNotificationOutcome> {
    const recipients = this.options.adminEmails();
    if (recipients.length === 0) {
      // Not retryable: no amount of waiting adds an address to the
      // environment. The lead is stored and visible in the console.
      this.logger.warn(
        'New-lead notification skipped — MARKETING_ADMIN_EMAILS is empty. The lead is stored and visible in the console.',
      );
      return {
        sent: false,
        category: MarketingErrorCategory.NOT_CONFIGURED,
        retryable: false,
        providerMessageId: null,
      };
    }

    const { subject, body } = buildLeadNotification(lead, this.options.appUrl());
    let providerMessageId: string | null = null;

    try {
      for (const to of recipients) {
        const result = await this.options.emailProvider.send({
          recipientId: 'marketing-lead-notification',
          title: subject,
          body,
          to,
          subject,
        });
        if (!result.success) {
          return {
            sent: false,
            category: result.retryable
              ? MarketingErrorCategory.TRANSIENT
              : MarketingErrorCategory.PERMANENT,
            retryable: Boolean(result.retryable),
            providerMessageId: null,
          };
        }
        providerMessageId = result.messageId ?? providerMessageId;
      }
      return { sent: true, category: null, retryable: false, providerMessageId };
    } catch {
      // The thrown error itself is deliberately not logged or persisted: a
      // nodemailer failure can include the SMTP conversation.
      return {
        sent: false,
        category: MarketingErrorCategory.UNKNOWN,
        retryable: true,
        providerMessageId: null,
      };
    }
  }
}

/** The (safe) notification content. Exported for the unit test. */
export function buildLeadNotification(
  lead: MarketingLead,
  appUrl: string,
): { subject: string; body: string } {
  const consoleLink = `${appUrl.replace(/\/+$/, '')}/admin/marketing/leads/${lead.id}`;
  const location = [lead.city, lead.country].filter(Boolean).join(', ');
  const attribution = lead.campaign_id
    ? `Campaign ${lead.campaign_id}${lead.campaign_recipient_id ? ' (recipient-level attribution)' : ''}`
    : (lead.utm?.utm_source ?? lead.source);

  const lines = [
    'A new demo request just arrived on the Zero Mile Systems landing page.',
    '',
    `Name: ${lead.full_name}`,
    `Work email: ${lead.normalized_email}`,
    `Institution: ${lead.institution_name ?? '—'}`,
    `Location: ${location || '—'}`,
    `Phone: ${lead.phone ?? '—'}`,
    `Source: ${attribution}`,
    `Received: ${(lead.created_at instanceof Date ? lead.created_at : new Date()).toISOString()}`,
    '',
    `Open the lead: ${consoleLink}`,
    '',
    'This notification contains contact details the person volunteered for a sales conversation. The full request (message, consent record, timeline) is in the console.',
  ];

  return {
    subject: `New demo request: ${lead.full_name}${lead.institution_name ? ` — ${lead.institution_name}` : ''}`,
    body: lines.join('\n'),
  };
}
