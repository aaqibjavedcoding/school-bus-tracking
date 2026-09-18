import type { DevicePlatform } from '@school-bus-tracking/shared-types';
import type {
  DeviceDeliveryOutcome,
  PushNotificationPayload,
  PushNotificationProvider,
  PushDeliveryResult,
} from './notification-provider.interface';

/** An empty per-device outcome. */
export function emptyDeviceOutcome(): DeviceDeliveryOutcome {
  return { delivered: [], retryable: [], invalid: [], notConfigured: [] };
}

/**
 * Composite push provider (Phase 2): routes each device token to the rail its
 * platform belongs to.
 *
 * - `platform === 'android'` → FCM (FCM registration token).
 * - `platform === 'ios'` → direct APNs (APNs token) when an APNs provider is
 *   configured; otherwise the device is reported `not_configured`
 *   (permanent for this deployment — never retried, never "sent").
 * - no metadata → FCM (legacy fallback for tokens registered before the
 *   platform field existed; a raw APNs token there is the historical bug this
 *   phase retires).
 *
 * The router is the provider the notification/outbox code actually talks to,
 * so callers never need to know the per-platform topology — but corner cases
 * (iOS token with no APNs credentials) are surfaced honestly instead of being
 * silently pretended success.
 */
export class PushDeliveryRouter implements PushNotificationProvider {
  readonly isConfigured: boolean;
  readonly name = 'push-router';

  constructor(
    private readonly fcm: PushNotificationProvider | null,
    private readonly apns: PushNotificationProvider | null,
  ) {
    this.isConfigured = Boolean(fcm || apns);
  }

  async send(payload: PushNotificationPayload): Promise<PushDeliveryResult> {
    const { android, ios, legacy } = partition(payload);

    const rails: Array<{
      tokens: string[];
      platform: DevicePlatform | null;
      provider: PushNotificationProvider | null;
    }> = [
      { tokens: android, platform: 'android', provider: this.fcm },
      { tokens: legacy, platform: null, provider: this.fcm },
      { tokens: ios, platform: 'ios', provider: this.apns },
    ];

    const outcomes: DeviceDeliveryOutcome[] = [];
    for (const rail of rails) {
      if (rail.tokens.length === 0) {
        continue;
      }
      if (!rail.provider) {
        outcomes.push(allNotConfigured(rail.tokens));
        continue;
      }
      const railPayload = subPayload(payload, rail.tokens, rail.platform);
      try {
        const result = await rail.provider.send(railPayload);
        outcomes.push(result.deviceOutcome ?? outcomeFromResult(result, rail.tokens));
      } catch {
        // A throwing provider must degrade to an honest retryable outcome,
        // never an exception out of the notification flow.
        outcomes.push(allRetryable(rail.tokens));
      }
    }

    const merged = mergeOutcomes(outcomes);
    const delivered = merged.delivered.length > 0;
    const retryable = merged.retryable.length > 0;
    const permanent = !delivered && !retryable && payload.deviceTokens.length > 0;

    let error: string | undefined;
    if (!delivered) {
      error =
        permanent && merged.notConfigured.length > 0
          ? `${merged.notConfigured.length} device(s) have no provider configured for their platform`
          : permanent && merged.invalid.length > 0
            ? 'Every device token was rejected as unregistered/invalid'
            : 'Push delivery failed for every device';
    }

    return {
      success: delivered,
      provider: this.name,
      messageId: `router-${Date.now()}`,
      ...(merged.invalid.length > 0 ? { invalidTokens: merged.invalid } : {}),
      deviceOutcome: merged,
      error,
      retryable,
      delivery: { retryable, permanent },
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

function partition(payload: PushNotificationPayload): {
  android: string[];
  ios: string[];
  legacy: string[];
} {
  const android: string[] = [];
  const ios: string[] = [];
  const legacy: string[] = [];
  payload.deviceTokens.forEach((token, index) => {
    const platform = payload.tokenPlatforms?.[index] ?? null;
    if (platform === 'android') {
      android.push(token);
    } else if (platform === 'ios') {
      ios.push(token);
    } else {
      legacy.push(token);
    }
  });
  return { android, ios, legacy };
}

function subPayload(
  payload: PushNotificationPayload,
  tokens: string[],
  platform: DevicePlatform | null,
): PushNotificationPayload {
  return { ...payload, deviceTokens: tokens, tokenPlatforms: tokens.map(() => platform) };
}

function allNotConfigured(tokens: string[]): DeviceDeliveryOutcome {
  return { ...emptyDeviceOutcome(), notConfigured: tokens };
}

function allRetryable(tokens: string[]): DeviceDeliveryOutcome {
  return { ...emptyDeviceOutcome(), retryable: tokens };
}

function outcomeFromResult(result: PushDeliveryResult, tokens: string[]): DeviceDeliveryOutcome {
  const invalid = new Set(result.invalidTokens ?? []);
  return {
    delivered: result.success ? tokens.filter((token) => !invalid.has(token)) : [],
    retryable: result.retryable ? tokens.filter((token) => !invalid.has(token)) : [],
    invalid: [...invalid],
    notConfigured: [],
  };
}

export function mergeOutcomes(outcomes: DeviceDeliveryOutcome[]): DeviceDeliveryOutcome {
  const merged = emptyDeviceOutcome();
  for (const outcome of outcomes) {
    merged.delivered.push(...outcome.delivered);
    merged.retryable.push(...outcome.retryable);
    merged.invalid.push(...outcome.invalid);
    merged.notConfigured.push(...outcome.notConfigured);
  }
  return merged;
}
