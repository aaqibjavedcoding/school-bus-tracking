/**
 * Asynchronous "new demo lead" notification to `MARKETING_ADMIN_EMAILS`.
 *
 * This is the operational rail (the same one `MarketingAdminAlerts` uses) —
 * strictly separate from the campaign rail: recipients come **only** from
 * `MARKETING_ADMIN_EMAILS` read at call time, never from anything a visitor
 * submitted, and a campaign send never CCs this mailbox.
 *
 * Invariants, in order of importance:
 *
 * 1. **The lead always wins.** `notifyNewLead` is called *after* the lead
 *    row is committed and returns `void`; every failure ends in a log line
 *    plus an `ADMIN_NOTIFY_FAILED` timeline event. Nothing here can delete,
 *    roll back or block a lead — or slow the public response down.
 * 2. **Bounded retries, no loops.** One initial attempt plus at most
 *    {@link MARKETING_LEAD_NOTIFY_MAX_ATTEMPTS} − 1 delayed retries, then the
 *    failure is recorded and the notifier stops. Recording the failure never
 *    triggers another email, so a dead relay produces a finite number of
 *    attempts per lead, not an infinite notification loop.
 * 3. **Safe content only.** The message carries the fields an operator needs
 *    to follow up (name, work email, institution, location, phone, source,
 *    campaign id, created time) and a console deep link built from the
 *    configured APP_URL. Never the free-text message body dump, never SMTP
 *    credentials, never tokens — and nothing of the payload is logged.
 */

import { Logger } from '../../framework';
import { MarketingLeadEventType } from '@school-bus-tracking/shared-types';
import type { EmailNotificationProvider } from '../notifications/providers/notification-provider.interface';
import type { MarketingLead, MarketingLeadEvent } from '../../database/models';

/** Total attempts (first try + retries) before the failure is recorded. */
export const MARKETING_LEAD_NOTIFY_MAX_ATTEMPTS = 2;

/** Pause before the (single) retry. */
export const MARKETING_LEAD_NOTIFY_RETRY_DELAY_MS = 30_000;

export interface MarketingLeadNotificationsOptions {
  emailProvider: EmailNotificationProvider;
  /** Read at call time so a configuration change needs no restart. */
  adminEmails: () => string[];
  /** Public origin for the console deep link (`APP_URL`). */
  appUrl: () => string;
  leads: typeof MarketingLead;
  events: typeof MarketingLeadEvent;
  retryDelayMs?: number;
  maxAttempts?: number;
  /** Injected in tests to make the retry pause instantaneous. */
  sleep?: (ms: number) => Promise<void>;
}

export class MarketingLeadNotifications {
  private readonly logger = new Logger(MarketingLeadNotifications.name);
  private readonly retryDelayMs: number;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: MarketingLeadNotificationsOptions) {
    this.retryDelayMs = options.retryDelayMs ?? MARKETING_LEAD_NOTIFY_RETRY_DELAY_MS;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? MARKETING_LEAD_NOTIFY_MAX_ATTEMPTS);
    this.sleep =
      options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Fire-and-forget entry point — schedules the send, never throws. */
  notifyNewLead(lead: MarketingLead): void {
    void this.deliver(lead).catch((error) => {
      this.logger.warn(
        `New-lead notification pipeline failed unexpectedly: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  /** Awaitable variant used by tests (same code path the void entry runs). */
  async deliver(lead: MarketingLead): Promise<boolean> {
    const recipients = this.options.adminEmails();
    if (recipients.length === 0) {
      this.logger.warn(
        'New-lead notification skipped — MARKETING_ADMIN_EMAILS is empty. The lead is stored and visible in the console.',
      );
      await this.recordFailure(lead, 'no-admin-recipients');
      return false;
    }

    const { subject, body } = buildLeadNotification(lead, this.options.appUrl());

    let lastFailure = 'unknown';
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const outcome = await this.sendToAll(recipients, subject, body);
      if (outcome.ok) {
        await this.recordSuccess(lead);
        return true;
      }
      lastFailure = outcome.reason;
      if (attempt < this.maxAttempts) {
        await this.sleep(this.retryDelayMs);
      }
    }

    await this.recordFailure(lead, lastFailure);
    return false;
  }

  private async sendToAll(
    recipients: string[],
    subject: string,
    body: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
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
          // Class of failure only — never the provider transcript, never
          // the recipient address, never the message content.
          return { ok: false, reason: `provider:${result.provider}:retryable=${result.retryable}` };
        }
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.name : 'send-error' };
    }
  }

  private async recordSuccess(lead: MarketingLead): Promise<void> {
    try {
      await this.options.leads.update(
        { admin_notified_at: new Date() } as never,
        { where: { id: lead.id } as never },
      );
      await this.options.events.create({
        lead_id: lead.id,
        event_type: MarketingLeadEventType.ADMIN_NOTIFIED,
        actor: 'system',
        metadata: null,
      } as never);
    } catch (error) {
      this.logger.warn(
        `Could not record notification success: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async recordFailure(lead: MarketingLead, reason: string): Promise<void> {
    try {
      await this.options.events.create({
        lead_id: lead.id,
        event_type: MarketingLeadEventType.ADMIN_NOTIFY_FAILED,
        actor: 'system',
        // Bounded, non-sensitive: a failure class, never a transcript.
        metadata: { reason: reason.slice(0, 120) },
      } as never);
    } catch (error) {
      this.logger.warn(
        `Could not record notification failure: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.logger.warn(
      `New-lead admin notification failed (lead ${lead.id}); the lead is stored and visible in the console.`,
    );
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
