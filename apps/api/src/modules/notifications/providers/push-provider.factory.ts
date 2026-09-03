import { Logger } from '@nestjs/common';
import type { PushNotificationProvider } from './notification-provider.interface';
import { FcmPushProvider } from './fcm-push.provider';
import { NoOpPushProvider } from './noop-push.provider';

/**
 * Push provider selection.
 *
 * `FIREBASE_SERVICE_ACCOUNT_JSON` carries the full service-account JSON on one
 * line; when it is set (and parses) the API delivers real FCM pushes through
 * `firebase-admin`. Without it — or when the value is malformed — the
 * `NoOpPushProvider` remains the default, so local dev and CI without
 * credentials keep every suite green and every flow functional.
 *
 * The credential value is never logged or echoed. On a parse failure only the
 * *absence of a valid configuration* is reported.
 */
export function createPushProvider(options: {
  serviceAccountJson?: string | null;
  projectId?: string | null;
}): PushNotificationProvider {
  const raw = options.serviceAccountJson?.trim();
  if (!raw) {
    return new NoOpPushProvider();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    new Logger('PushProviderSelection').warn(
      'FIREBASE_SERVICE_ACCOUNT_JSON is set but is not valid JSON — falling back to NoOpPushProvider. Check the variable (its value is never logged).',
    );
    return new NoOpPushProvider();
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    new Logger('PushProviderSelection').warn(
      'FIREBASE_SERVICE_ACCOUNT_JSON is set but is not a service-account object — falling back to NoOpPushProvider.',
    );
    return new NoOpPushProvider();
  }

  return new FcmPushProvider(parsed as Record<string, unknown>, options.projectId?.trim() || null);
}
