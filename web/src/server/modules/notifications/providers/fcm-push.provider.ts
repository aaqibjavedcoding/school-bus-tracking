import { Logger } from '../../../framework';
import { cert, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { Messaging, SendResponse } from 'firebase-admin/messaging';
import type {
  PushNotificationProvider,
  PushNotificationPayload,
  PushDeliveryResult,
} from './notification-provider.interface';

/**
 * Firebase Cloud Messaging push provider (free).
 *
 * Selected automatically by {@link createPushProvider} when
 * `FIREBASE_SERVICE_ACCOUNT_JSON` is set; otherwise the `NoOpPushProvider`
 * stays the default so local dev and CI pass without credentials.
 *
 * Delivery uses `sendEachForMulticast` (FCM HTTP v1) with a **notification
 * message** (`notification.title` / `notification.body`) so the OS renders it
 * in the system tray even when the app is killed, plus a string-only `data`
 * payload (school/user/trip/type/id) for deep-linking when the app is opened.
 *
 * The Firebase app is initialised lazily on the first send — a bootstrap
 * never fails because of push configuration, and the JSON credential is only
 * parsed here (never logged, never echoed).
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
      };
    }

    try {
      const messaging = this.messaging();
      const response = await messaging.sendEachForMulticast({
        tokens: payload.deviceTokens,
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

      const invalidTokens: string[] = [];
      let succeeded = 0;
      let firstError: string | null = null;

      response.responses.forEach((result: SendResponse, index: number) => {
        if (result.success) {
          succeeded += 1;
          return;
        }
        const token = payload.deviceTokens[index];
        const error = result.error as
          { code?: string; errorInfo?: { code?: string; message?: string } } | undefined;
        if (token && isInvalidTokenError(error)) {
          invalidTokens.push(token);
        }
        if (!firstError) {
          firstError = errorMessage(error);
        }
      });

      // A multicast with at least one success is a successful delivery; the
      // per-token invalidation detail is still carried so the caller can
      // deactivate the stale rows. When every token failed — including the
      // all-invalid case — the delivery is a failure (the caller still
      // receives `invalidTokens` and will deactivate them).
      const common: Omit<PushDeliveryResult, 'success'> = {
        provider: this.name,
        messageId: `fcm-${Date.now()}`,
        retryable: false,
        ...(invalidTokens.length > 0 ? { invalidTokens } : {}),
      };

      if (succeeded > 0) {
        return { ...common, success: true };
      }

      return {
        ...common,
        success: false,
        error: firstError ?? 'FCM delivery failed',
        retryable: true,
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

function errorMessage(
  error: { message?: string; errorInfo?: { message?: string; code?: string } } | undefined,
): string {
  return (
    error?.errorInfo?.message ?? error?.message ?? error?.errorInfo?.code ?? 'Unknown FCM error'
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
