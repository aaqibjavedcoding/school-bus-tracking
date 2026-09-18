import { Logger } from '../../../framework';
import { cert, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { Messaging, SendResponse } from 'firebase-admin/messaging';
import type {
  DeviceDeliveryOutcome,
  PushDeliveryResult,
  PushNotificationPayload,
  PushNotificationProvider,
} from './notification-provider.interface';

/**
 * Firebase Cloud Messaging push provider (free) — Android rail only.
 *
 * Selected automatically by {@link createPushProvider} when
 * `FIREBASE_SERVICE_ACCOUNT_JSON` is set; otherwise the `NoOpPushProvider`
 * stays the default so local dev and CI pass without credentials.
 *
 * ### Phase 2 — iOS is not FCM
 *
 * Expo's `getDevicePushTokenAsync()` returns an **FCM registration token on
 * Android** and a **raw APNs device token on iOS**; `firebase-admin` can only
 * send to FCM registration tokens. This provider therefore accepts **Android
 * targets only** (and, for a token without platform metadata, the legacy
 * "assume FCM" fallback): any target explicitly declared `platform === 'ios'`
 * is reported via `deviceOutcome.notConfigured` so the row is never retried
 * against the wrong rail. iOS delivery happens in `ApnsDirectProvider`, and
 * the composite `PushDeliveryRouter` splits the two by platform.
 *
 * Delivery uses `sendEachForMulticast` (FCM HTTP v1) with a **notification
 * message** (`notification.title` / `notification.body`) so the OS renders it
 * in the system tray even when the app is killed, plus a string-only `data`
 * payload for deep-linking. Android targets channel `notifications` (high
 * priority, default sound) — the id the app creates with
 * `setNotificationChannelAsync`.
 */
export class FcmPushProvider implements PushNotificationProvider {
  readonly name = 'fcm';
  readonly isConfigured = true;

  /** Android notification channel the app creates (`notifications`). */
  static readonly channelId = 'notifications';
  private readonly logger = new Logger(FcmPushProvider.name);
  private messagingInstance: Messaging | null = null;

  constructor(
    private readonly serviceAccount: Record<string, unknown>,
    private readonly projectId: string | null | undefined,
    /** Injectable for unit tests; production uses firebase-admin. */
    private readonly messagingOverride?: Pick<Messaging, 'sendEachForMulticast'>,
  ) {}

  async send(payload: PushNotificationPayload): Promise<PushDeliveryResult> {
    if (payload.deviceTokens.length === 0) {
      return {
        success: false,
        provider: this.name,
        error: 'No device tokens',
        retryable: false,
        delivery: { retryable: false, permanent: true },
      };
    }

    // Split by platform. iOS targets never reach FCM.
    const fcmTokens: string[] = [];
    const notConfigured: string[] = [];
    payload.deviceTokens.forEach((token, index) => {
      const platform = payload.tokenPlatforms?.[index] ?? null;
      if (platform === 'ios') {
        notConfigured.push(token);
      } else {
        // Android, or legacy "no metadata" → FCM registration token.
        fcmTokens.push(token);
      }
    });

    const outcome: DeviceDeliveryOutcome = {
      delivered: [],
      retryable: [],
      invalid: [],
      notConfigured,
    };
    if (fcmTokens.length === 0) {
      return {
        success: false,
        provider: this.name,
        error: `No Android FCM tokens to send (${notConfigured.length} iOS APNs token(s) must go through direct APNs)`,
        retryable: false,
        delivery: { retryable: false, permanent: true },
        deviceOutcome: outcome,
      };
    }

    try {
      const messaging = this.messaging();
      const response = await messaging.sendEachForMulticast({
        tokens: fcmTokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: toDataStrings(payload.data),
        android: {
          priority: payload.priority === 'high' ? 'high' : 'normal',
          notification: {
            channelId: FcmPushProvider.channelId,
            sound: 'default',
            // Ticker is the most compatible "same message on the tray" hint;
            // excluded when absent because FCM rejects empty strings.
            ...(payload.title ? { ticker: payload.title } : {}),
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              // Badge-less alerts stay simple; the notification row in the
              // app is the single source of truth for unread state.
              'content-available': 1,
            },
          },
        },
      });

      const skuErrors: string[] = [];
      accumulateOutcome(response.responses, fcmTokens, outcome, skuErrors);

      const hasDelivery = outcome.delivered.length > 0;
      const noRetryable = outcome.retryable.length === 0;
      const permanent =
        !hasDelivery && noRetryable && outcome.invalid.length > 0
          ? true
          : // all-invalid crashed batch
            !hasDelivery && noRetryable;

      const common = {
        provider: this.name,
        messageId: `fcm-${Date.now()}`,
        ...(outcome.invalid.length > 0 ? { invalidTokens: outcome.invalid } : {}),
        deviceOutcome: outcome,
      };

      if (hasDelivery) {
        // A multicast with at least one success is a successful delivery; the
        // per-device detail is still carried for partial-success accounting.
        return { ...common, success: true, retryable: false };
      }

      if (noRetryable) {
        // Every Android token failed permanently (unregistered/invalid).
        return {
          ...common,
          success: false,
          error: firstErrorOf(outcome) ?? 'FCM delivery failed',
          retryable: false,
          delivery: { retryable: false, permanent: true },
        };
      }

      return {
        ...common,
        success: false,
        error:
          firstErrorOf(outcome) ??
          skuErrors[0] ??
          'FCM delivery failed for every target (transient)',
        retryable: true,
        delivery: { retryable: true, permanent },
      };
    } catch (error) {
      // Provider/auth/network errors must never propagate — the caller keeps
      // the notification flow alive and records the failure.
      this.logger.warn(
        `FCM send failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        success: false,
        provider: this.name,
        error: error instanceof Error ? error.message : String(error),
        retryable: true,
        delivery: { retryable: true, permanent: false },
        deviceOutcome: {
          delivered: [],
          retryable: [...fcmTokens],
          invalid: [],
          notConfigured,
        },
      };
    }
  }

  async sendBatch(payloads: PushNotificationPayload[]): Promise<PushDeliveryResult[]> {
    const results: PushDeliveryResult[] = [];
    for (const payload of payloads) {
      results.push(await this.send(payload));
    }
    return results;
  }

  /** Lazily bootstraps the firebase-admin app (once per process). */
  private messaging(): Messaging {
    if (this.messagingOverride) {
      return this.messagingOverride as Messaging;
    }
    if (this.messagingInstance) {
      return this.messagingInstance;
    }

    const app: App = initializeApp(
      {
        credential: cert(this.serviceAccount),
        projectId: this.projectId ?? undefined,
      },
      'school-bus-tracking-push',
    );
    const instance = getMessaging(app);
    this.messagingInstance = instance;
    return instance;
  }
}

function accumulateOutcome(
  responses: SendResponse[],
  tokens: string[],
  outcome: DeviceDeliveryOutcome,
  skuErrors: string[],
): void {
  responses.forEach((result, index) => {
    if (result.success) {
      outcome.delivered.push(tokens[index]);
      return;
    }
    const error = result.error as
      { code?: string; errorInfo?: { code?: string; message?: string } } | undefined;
    if (error?.errorInfo?.message) {
      skuErrors.push(error.errorInfo.message);
    }
    if (tokens[index] && isInvalidTokenError(error)) {
      outcome.invalid.push(tokens[index]);
    } else if (tokens[index]) {
      outcome.retryable.push(tokens[index]);
    }
  });
}

function firstErrorOf(outcome: DeviceDeliveryOutcome): string | null {
  if (outcome.invalid.length > 0) {
    return 'All device tokens were rejected as unregistered/invalid';
  }
  return null;
}

/**
 * FCM messages carry `UNREGISTERED` / `INVALID_REGISTRATION` for tokens the
 * provider no longer recognises. Newer Admin SDKs report them under
 * `errorInfo.code` (e.g. `messaging/registration-token-not-registered`); both
 * spellings are matched so a stale row is deactivated either way.
 */
export function isInvalidTokenError(
  error: { code?: string; errorInfo?: { code?: string } } | null | undefined,
): boolean {
  const codes = [error?.code, error?.errorInfo?.code].filter(
    (c): c is string => typeof c === 'string',
  );
  return codes.some((code) =>
    [
      'UNREGISTERED',
      'INVALID_REGISTRATION',
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token',
    ].includes(code),
  );
}

/** FCM `data` accepts string values only; non-strings are stringified, null/undefined dropped. */
function toDataStrings(
  data: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!data) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      continue;
    }
    result[key] =
      typeof value === 'string'
        ? value
        : value instanceof Date
          ? value.toISOString()
          : String(value);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
