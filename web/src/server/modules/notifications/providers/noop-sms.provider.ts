import { Logger } from '../../../framework';
import type {
  SmsNotificationProvider,
  SmsNotificationPayload,
  NotificationDeliveryResult,
} from './notification-provider.interface';

/**
 * No-op SMS notification provider for development and local environments.
 *
 * Logs the SMS details but does not actually send. This is the default
 * provider when no paid SMS service is configured.
 *
 * External SMS provider integration is intentionally deferred because
 * paid services are prohibited in the current phase.
 */
export class NoOpSmsProvider implements SmsNotificationProvider {
  readonly name = 'noop-sms';
  readonly isConfigured = true;
  private readonly logger = new Logger(NoOpSmsProvider.name);

  async send(payload: SmsNotificationPayload): Promise<NotificationDeliveryResult> {
    this.logger.debug(
      `[NoOpSms] Would send SMS to ${payload.phoneNumber}: "${payload.body}"`,
    );

    return {
      success: true,
      provider: this.name,
      messageId: `noop-sms-${Date.now()}`,
      retryable: false,
    };
  }
}
