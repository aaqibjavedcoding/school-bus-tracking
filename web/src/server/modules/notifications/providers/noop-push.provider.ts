import { Logger } from '../../../framework';
import type {
  PushNotificationProvider,
  PushNotificationPayload,
  PushDeliveryResult,
} from './notification-provider.interface';

/**
 * No-op push notification provider for development and local environments.
 *
 * Logs the notification details but does not actually deliver to any
 * external service. This is the default provider whenever
 * `FIREBASE_SERVICE_ACCOUNT_JSON` is not set, so local dev and CI keep
 * working without credentials.
 */
export class NoOpPushProvider implements PushNotificationProvider {
  readonly name = 'noop-push';
  readonly isConfigured = true; // Always "configured" — it's a no-op.
  private readonly logger = new Logger(NoOpPushProvider.name);

  async send(payload: PushNotificationPayload): Promise<PushDeliveryResult> {
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

  async sendBatch(payloads: PushNotificationPayload[]): Promise<PushDeliveryResult[]> {
    const results: PushDeliveryResult[] = [];
    for (const payload of payloads) {
      results.push(await this.send(payload));
    }
    return results;
  }
}
