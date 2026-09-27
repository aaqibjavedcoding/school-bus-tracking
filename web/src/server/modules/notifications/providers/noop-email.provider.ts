import { Logger } from '../../../framework';
import type {
  EmailNotificationProvider,
  EmailNotificationPayload,
  NotificationDeliveryResult,
} from './notification-provider.interface';

/**
 * No-op email notification provider for development and local environments.
 *
 * Logs the email details but does not actually send. This is the default
 * provider when no paid email service is configured.
 *
 * External email provider integration is intentionally deferred because
 * paid services are prohibited in the current phase.
 */
export class NoOpEmailProvider implements EmailNotificationProvider {
  readonly name = 'noop-email';
  readonly isConfigured = true;
  private readonly logger = new Logger(NoOpEmailProvider.name);

  async send(payload: EmailNotificationPayload): Promise<NotificationDeliveryResult> {
    // Marketing messages carry personalized tracking/unsubscribe links in
    // their body and headers, so the body is summarized by length instead of
    // echoed: a debug log must never become the place a raw token leaks.
    const headerNames = payload.headers ? Object.keys(payload.headers).sort().join(', ') : '';
    this.logger.debug(
      `[NoOpEmail] Would send email to ${payload.to}: "${payload.subject}" ` +
        `(${payload.body.length} chars text${payload.html ? ' + html' : ''}` +
        `${headerNames ? `, headers: ${headerNames}` : ''})`,
    );

    return {
      success: true,
      provider: this.name,
      // Stable prefix + a random suffix: the marketing worker persists this
      // as `provider_message_id`, and two sends in the same millisecond must
      // not look like the same message.
      messageId: `noop-email-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      retryable: false,
    };
  }
}
