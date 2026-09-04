/**
 * Notification provider abstractions.
 *
 * These interfaces define the contract for external notification delivery.
 * Push delivery is implemented by `NoOpPushProvider` (default, local/dev/CI)
 * and `FcmPushProvider` (Firebase Cloud Messaging — free). Email and SMS stay
 * no-op placeholders; no paid service is connected.
 */

/** Result of a notification delivery attempt. */
export interface NotificationDeliveryResult {
  success: boolean;
  provider: string;
  messageId?: string;
  error?: string;
  retryable: boolean;
}

/** Push delivery result, extended with the per-device invalidation detail. */
export interface PushDeliveryResult extends NotificationDeliveryResult {
  /**
   * Device tokens the push provider rejected as unregistered / invalid.
   * The caller deactivates those `device_tokens` rows so they are never
   * targeted again.
   */
  invalidTokens?: string[];
}

/** A notification to be delivered externally. */
export interface NotificationPayload {
  recipientId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: 'normal' | 'high';
}

/** A push notification with device targeting. */
export interface PushNotificationPayload extends NotificationPayload {
  deviceTokens: string[];
}

/** An email notification. */
export interface EmailNotificationPayload extends NotificationPayload {
  to: string;
  subject: string;
  html?: string;
}

/** An SMS notification. */
export interface SmsNotificationPayload extends NotificationPayload {
  phoneNumber: string;
}

/**
 * Push notification provider interface.
 *
 * Implementations:
 * - `NoOpPushProvider` — default when Firebase env is absent (local/dev/CI)
 * - `FcmPushProvider` — Firebase Cloud Messaging (free), selected when
 *   `FIREBASE_SERVICE_ACCOUNT_JSON` is set
 */
export interface PushNotificationProvider {
  readonly name: string;
  readonly isConfigured: boolean;

  send(payload: PushNotificationPayload): Promise<PushDeliveryResult>;
  sendBatch(payloads: PushNotificationPayload[]): Promise<PushDeliveryResult[]>;
}

/**
 * Email notification provider interface.
 *
 * Implementations:
 * - `NoOpEmailProvider` — development/local (logs but does not deliver)
 *
 * Future: SendGrid, AWS SES, Mailgun, etc.
 */
export interface EmailNotificationProvider {
  readonly name: string;
  readonly isConfigured: boolean;

  send(payload: EmailNotificationPayload): Promise<NotificationDeliveryResult>;
}

/**
 * SMS notification provider interface.
 *
 * Implementations:
 * - `NoOpSmsProvider` — development/local (logs but does not deliver)
 *
 * Future: Twilio, Vonage, etc.
 */
export interface SmsNotificationProvider {
  readonly name: string;
  readonly isConfigured: boolean;

  send(payload: SmsNotificationPayload): Promise<NotificationDeliveryResult>;
}
