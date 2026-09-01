/**
 * Notification provider abstractions.
 *
 * These interfaces define the contract for external notification delivery.
 * In the current phase, only development/local/no-op implementations are
 * provided — no paid services are connected.
 *
 * External push provider integration is intentionally deferred because paid
 * services are prohibited in the current phase.
 */

/** Result of a notification delivery attempt. */
export interface NotificationDeliveryResult {
  success: boolean;
  provider: string;
  messageId?: string;
  error?: string;
  retryable: boolean;
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
 * - `NoOpPushProvider` — development/local (logs but does not deliver)
 *
 * Future: Firebase Cloud Messaging, Apple Push Notification Service, etc.
 */
export interface PushNotificationProvider {
  readonly name: string;
  readonly isConfigured: boolean;

  send(payload: PushNotificationPayload): Promise<NotificationDeliveryResult>;
  sendBatch(payloads: PushNotificationPayload[]): Promise<NotificationDeliveryResult[]>;
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
