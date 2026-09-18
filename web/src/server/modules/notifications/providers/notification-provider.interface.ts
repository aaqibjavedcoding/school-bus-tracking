/**
 * Notification provider abstractions.
 *
 * These interfaces define the contract for external notification delivery.
 *
 * Phase 2 push delivery has two platform rails, both free:
 *
 * - `FcmPushProvider` — Firebase Cloud Messaging for **Android** FCM
 *   registration tokens (free, via `firebase-admin`).
 * - `ApnsDirectProvider` — direct Apple Push Notification service delivery
 *   for **iOS** APNs tokens (HTTP/2 + ES256 token auth, Node built-ins —
 *   no paid service and no vendor in between; requires an Apple APNs key,
 *   team id and key id, which Apple issues without any purchase).
 *
 * `PushDeliveryRouter` is the composite {@link PushNotificationProvider} the
 * application actually constructs: it partitions the targets by platform and
 * forwards each device to the right rail, merging per-device outcomes. A raw
 * APNs token is therefore **never** handed to FCM.
 *
 * Email and SMS stay no-op placeholders; no paid service is connected.
 */
import type { DevicePlatform } from '@school-bus-tracking/shared-types';

/** Result of a notification delivery attempt. */
export interface NotificationDeliveryResult {
  success: boolean;
  provider: string;
  messageId?: string;
  error?: string;
  retryable: boolean;
}

/** Per-device outcome breakdown of one send attempt (Phase 2). */
export interface DeviceDeliveryOutcome {
  /** Device tokens the provider accepted the message for. */
  delivered: string[];
  /** Device tokens that failed for a retryable (provider) reason. */
  retryable: string[];
  /** Device tokens the provider rejected permanently (unregistered/invalid). */
  invalid: string[];
  /**
   * Device tokens whose platform has no provider configured (e.g. an iOS
   * APNs token when the APNs credentials are absent). Permanent for this
   * deployment — never retried, never reported as delivered.
   */
  notConfigured: string[];
}

/** Push delivery result, extended with the per-device outcome detail. */
export interface PushDeliveryResult extends NotificationDeliveryResult {
  /**
   * Device tokens the push provider rejected as unregistered / invalid
   * (deprecated alias for `deviceOutcome.invalid`).
   */
  invalidTokens?: string[];
  /** Per-device breakdown of the attempt (Phase 2, partial success). */
  deviceOutcome?: DeviceDeliveryOutcome;
  /** Classification of the *row-level* failure, when `success` is false. */
  delivery?: { retryable: boolean; permanent: boolean };
}

/** A notification to be delivered externally. */
export interface NotificationPayload {
  recipientId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: 'normal' | 'high';
}

/** One token targeted this attempt. */
export interface DeviceTokenTarget {
  /** The native token string. */
  token: string;
  /** Platform the token belongs to (routes to FCM / APNs correctly). */
  platform: DevicePlatform;
}

/** A push notification with device targeting. */
export interface PushNotificationPayload extends NotificationPayload {
  deviceTokens: string[];
  /**
   * Platform metadata aligned with `deviceTokens`. The Phase 2 callers always
   * pass this so iOS APNs tokens are routed to direct APNs, never to FCM.
   * A missing entry is treated as `null` (legacy "assume FCM").
   */
  tokenPlatforms?: ReadonlyArray<DevicePlatform | null>;
}

/** Single-delivery capability shared by the FCM and APNs providers. */
export interface PushDeliveryTransport {
  /**
   * Sends the payload. The implementation is expected to resolve per-device
   * outcomes and to never throw — provider/network errors surface as a
   * retryable result instead.
   */
  send(payload: PushNotificationPayload): Promise<PushDeliveryResult>;
}

/**
 * Push notification provider interface (FCM, direct APNs, or the composite
 * router). Implementations must never throw out of `send`/`sendBatch`: local
 * dev and CI (or a provider outage) must degrade to a recorded failure, never
 * a broken attendance/trip/arrival flow.
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
