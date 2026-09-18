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
 *   no paid service and no vendor in between).
 *
 *   Apple signing prerequisites (separate from delivery cost): sending to
 *   APNs is *free* — no per-notification charge exists — but the app must be
 *   signed with a bundle id whose App ID has the Push Notifications
 *   capability, and the APNs auth key (`.p8`) / Key ID / Team ID must come
 *   from the same Apple Developer account that owns that bundle id. Building
 *   and installing on a physical iPhone additionally requires Apple code
 *   signing (a free personal team works only with its own limited
 *   provisioning; a paid membership removes those limits). Nothing in this
 *   codebase bypasses Apple signing, and no purchase is required or
 *   suggested for APNs *delivery* itself.
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

/**
 * Per-device outcome breakdown of one send attempt (Phase 2; the corrective
 * patch separates the failure *classes* so the outbox can react correctly).
 *
 * The buckets partition the tokens that were attempted; every attempted token
 * ends up in exactly one of them.
 */
export interface DeviceDeliveryOutcome {
  /** Device tokens the provider accepted the message for. */
  delivered: string[];
  /** Device tokens that failed for a retryable (provider/network) reason. */
  retryable: string[];
  /**
   * Device tokens the provider declared unregistered/invalid. These are
   * retired (deactivated) and never retried, while the *other* devices of the
   * same attempt keep their own outcome.
   */
  invalid: string[];
  /**
   * Device tokens whose platform has no provider configured (e.g. an iOS
   * APNs token when the APNs credentials are absent). Permanent for this
   * deployment — never retried, never reported as delivered, never retired.
   */
  notConfigured: string[];
  /**
   * Device tokens rejected because the *provider rail is misconfigured*
   * (bad/expired provider credentials, wrong topic, forbidden certificate
   * environment, …). Configuration failures are terminal for this attempt
   * and must never retire a token: a wrong `apns-topic` or a rotated key
   * would otherwise wipe the whole device registry.
   */
  misconfigured: string[];
  /**
   * Device tokens rejected because the *message* itself was refused
   * permanently by the provider (payload too large, bad priority/expiration,
   * empty payload, …). The message can never be delivered as-is; the device
   * token stays untouched.
   */
  permanent: string[];
  /**
   * Device tokens that were deliberately not sent because the notification's
   * deadline had already passed (see `PushNotificationPayload.expiresAt`).
   * Never retried, never retired.
   */
  expired: string[];
  /** Human-readable provider reason for `misconfigured` tokens, when known. */
  misconfiguredReason?: string | null;
  /** Human-readable provider reason for `permanent` (message) tokens. */
  permanentReason?: string | null;
}

/**
 * An empty per-device outcome. Every bucket is present so one attempt's
 * result can be partitioned without optional-chaining mistakes; a token
 * missing from all buckets is treated by the outbox as a defensive
 * "retryable" outcome rather than a silent success.
 */
export function emptyDeviceOutcome(): DeviceDeliveryOutcome {
  return {
    delivered: [],
    retryable: [],
    invalid: [],
    notConfigured: [],
    misconfigured: [],
    permanent: [],
    expired: [],
  };
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
  /**
   * Absolute event deadline of the notification (`notifications.push_expires_at`).
   *
   * The provider must translate this into its own expiry mechanism —
   * Android FCM `ttl` (milliseconds, bounded to the 4-week maximum) and the
   * APNs `apns-expiration` header (Unix **seconds**) — computed from the
   * remaining lifetime **at send time**, never from the original lifetime.
   *
   * This reduces stale queued delivery only: provider-side keys cannot
   * retract an already displayed alert, and they are not a guarantee of
   * instant delivery. `null`/absent means "no server-known deadline" (legacy
   * rows and non-trip callers).
   */
  expiresAt?: Date | null;
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
