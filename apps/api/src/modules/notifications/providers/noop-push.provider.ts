import { Logger } from '@nestjs/common';
import type {
  PushNotificationProvider,
  PushNotificationPayload,
  NotificationDeliveryResult,
} from './notification-provider.interface';

/**
 * No-op push notification provider for development and local environments.
 *
 * Logs the notification details but does not actually deliver to any
 * external service. This is the default provider when no paid push
 * service is configured.
 *
 * External push provider integration is intentionally deferred because
 * paid services are prohibited in the current phase.
 */
export class NoOpPushProvider implements PushNotificationProvider {
  readonly name = 'noop-push';
  readonly isConfigured = true; // Always "configured" — it's a no-op.

  private readonly logger = new Logger(NoOpPushProvider.name);

  async send(payload: PushNotificationPayload): Promise<NotificationDeliveryResult> {
    this.logger.debug(
      `[NoOpPush] Would send push to ${payload.deviceTokens.length} device(s): "${payload.title}" — "${payload.body}"`,
    );

    return {
      success: true,
      provider: this.name,
      messageId: `noop-${Date.now()}`,
      retryable: false,
    };
  }

  async sendBatch(payloads: PushNotificationPayload[]): Promise<NotificationDeliveryResult[]> {
    const results: NotificationDeliveryResult[] = [];
    for (const payload of payloads) {
      results.push(await this.send(payload));
    }
    return results;
  }
}
