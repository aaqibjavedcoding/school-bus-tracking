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
    this.logger.debug(
      `[NoOpEmail] Would send email to ${payload.to}: "${payload.subject}" — "${payload.body}"`,
    );

    return {
      success: true,
      provider: this.name,
      messageId: `noop-email-${Date.now()}`,
      retryable: false,
    };
  }
}
