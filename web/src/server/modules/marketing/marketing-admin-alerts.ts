/**
 * Operational alerts to the Super Admin mailbox (`MARKETING_ADMIN_EMAILS`).
 *
 * This is the *operational* rail, strictly separate from the campaign rail:
 *
 * - campaign messages go **only** to the addresses in the frozen audience
 *   snapshot, and the admin address is never CC'd or BCC'd onto one — doing
 *   that would put a live recipient list in a shared mailbox and pollute
 *   engagement analytics;
 * - alerts go **only** to `MARKETING_ADMIN_EMAILS`, and a campaign recipient
 *   can never receive one, because this class never reads a recipient
 *   address. The two lists only overlap if an operator deliberately puts
 *   their own address in a school record.
 *
 * ### It must never block, and never loop
 *
 * Three properties, each protecting the worker from its own alerting:
 *
 * 1. **Fire-and-forget.** `notify*` returns `void`; the send is scheduled and
 *    its failures are swallowed into a log line. A relay outage must not slow
 *    down — let alone fail — the delivery sweep that noticed it.
 * 2. **Loop-proof.** Sending an alert can itself fail. If that failure also
 *    produced an alert, one broken relay would generate mail forever — so the
 *    send path below only ever *logs* its own failures, and never calls back
 *    into {@link MarketingAdminAlerts.dispatch}. On top of that a
 *    {@link DEFAULT_MARKETING_ALERT_COOLDOWN_MS} window per alert *kind*
 *    means a campaign failing 5 000 times produces one message, not 5 000.
 * 3. **Bounded content.** Ids, counts and enum categories only. No recipient
 *    address, no rendered body, no provider transcript, no token — the same
 *    rules the audit metadata follows.
 */

import { Logger } from '../../framework';
import type { MarketingErrorCategory } from '@school-bus-tracking/shared-types';
import type { EmailNotificationProvider } from '../notifications/providers/notification-provider.interface';
import type { MarketingAlertSink } from './marketing-delivery.worker';

/** Default: at most one message of the same kind per 15 minutes. */
export const DEFAULT_MARKETING_ALERT_COOLDOWN_MS = 15 * 60 * 1000;

export interface MarketingAdminAlertsOptions {
  emailProvider: EmailNotificationProvider;
  /** Read at call time so a configuration change does not need a restart. */
  adminEmails: () => string[];
  cooldownMs?: number;
  /** Injected in tests; production uses the real clock. */
  now?: () => number;
}

export class MarketingAdminAlerts implements MarketingAlertSink {
  private readonly logger = new Logger(MarketingAdminAlerts.name);
  private readonly lastSentAt = new Map<string, number>();
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(private readonly options: MarketingAdminAlertsOptions) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_MARKETING_ALERT_COOLDOWN_MS;
    this.now = options.now ?? Date.now;
  }

  /** A campaign recipient exhausted its retry budget. */
  campaignDeliveryExhausted(info: {
    campaignId: string;
    failureCategory: MarketingErrorCategory;
    attempts: number;
  }): void {
    this.dispatch(
      `campaign-exhausted:${info.campaignId}`,
      'Marketing campaign delivery: retries exhausted',
      [
        'A marketing campaign recipient exhausted its delivery retries.',
        '',
        `Campaign: ${info.campaignId}`,
        `Failure category: ${info.failureCategory}`,
        `Attempts: ${info.attempts}`,
        '',
        'Open the campaign in the Super Admin console for the full progress breakdown.',
        'No recipient address, message body or provider transcript is included in this alert by design.',
      ].join('\n'),
    );
  }

  /** The worker could not start, or a sweep failed at the top level. */
  workerFailure(info: { stage: string; message: string }): void {
    this.dispatch(
      `worker-failure:${info.stage}`,
      'Marketing delivery worker problem',
      [
        `The marketing delivery worker reported a problem during "${info.stage}".`,
        '',
        // The message here is the application's own error text, never a
        // provider transcript — those never leave `classifyMarketingFailure`.
        `Detail: ${info.message.slice(0, 300)}`,
        '',
        'The worker keeps running and will retry on its next sweep.',
      ].join('\n'),
    );
  }

  /** Schedules one alert if its cooldown has passed. Never throws, never awaits. */
  private dispatch(key: string, subject: string, body: string): void {
    const now = this.now();
    const last = this.lastSentAt.get(key);
    if (last !== undefined && now - last < this.cooldownMs) {
      return;
    }
    const recipients = this.options.adminEmails();
    if (recipients.length === 0) {
      this.logger.warn(
        `Marketing alert "${subject}" not sent — MARKETING_ADMIN_EMAILS is empty.`,
      );
      return;
    }
    this.lastSentAt.set(key, now);

    void this.send(recipients, subject, body);
  }

  private async send(recipients: string[], subject: string, body: string): Promise<void> {
    try {
      for (const to of recipients) {
        const result = await this.options.emailProvider.send({
          recipientId: 'marketing-admin-alert',
          title: subject,
          body,
          to,
          subject,
        });
        if (!result.success) {
          // Log the class of failure only, and do not alert about it.
          this.logger.warn(
            `Marketing admin alert delivery failed (provider=${result.provider}, retryable=${result.retryable}).`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Marketing admin alert could not be sent: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
