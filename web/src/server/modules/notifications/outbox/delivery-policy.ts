import type { NotificationType } from '@school-bus-tracking/shared-types';
import type { DeviceDeliveryOutcome } from '../providers';

/** Delivery workflow tunables (all env-backed in config/notification-delivery.config.ts). */
export interface DeliveryPolicyConfig {
  /** Drop a still-failing row after this many attempts. */
  maxAttempts: number;
  /** First retry delay; doubles per attempt up to a ceiling. */
  baseBackoffMs: number;
  /** How long after creation a proximity/attendance alert stays deliverable. */
  expiryMs: number;
  /** Rows claimed per transaction in one sweep (worker-only knob). */
  batchSize: number;
}

/** Ceiling of the exponential backoff (per attempt). */
export const DELIVERY_MAX_BACKOFF_MS = 90_000;

/**
 * Next retry delay for the given attempt number (1-based): bounded exponential
 * backoff (`base * 2^(attempt-1)`, capped at {@link DELIVERY_MAX_BACKOFF_MS}).
 * Attempt 1 (the first failure) waits `base`.
 */
export function backoffDelayMs(baseBackoffMs: number, attemptNumber: number): number {
  if (!Number.isFinite(baseBackoffMs) || baseBackoffMs <= 0) {
    baseBackoffMs = 2000;
  }
  const exponent = Math.max(0, attemptNumber - 1);
  const delay = baseBackoffMs * 2 ** exponent;
  return Math.min(delay, DELIVERY_MAX_BACKOFF_MS);
}

/**
 * Event-specific expiry: the deadline after which a proximity/attendance alert
 * is no longer useful and must not be delivered. Computed at creation from the
 * event clock + {@link DeliveryPolicyConfig.expiryMs}.
 */
export function deliveryExpiry(createdAtMs: number, config: DeliveryPolicyConfig): Date {
  return new Date(createdAtMs + config.expiryMs);
}

/** The stable natural key of one event — at most 64 chars to fit the column. */
export function deliveryDedupKey(args: {
  type: NotificationType | string;
  tripId?: string | null;
  studentId?: string | null;
  stopId?: string | null;
}): string {
  const parts = [args.type, args.tripId ?? '', args.studentId ?? '', args.stopId ?? ''];
  return parts.join(':').slice(0, 64);
}

/** Reasons recorded by the outbox when it stops trying. */
export const DELIVERY_ABANDON_REASONS = {
  expired: 'Expired before push delivery (event window closed)',
  tripEnded: 'Trip is no longer tracking — proximity alert abandoned',
  maxAttempts: 'Maximum delivery attempts reached',
  permanent: 'All device tokens rejected permanently',
  noProvider: 'No push provider configured for the device platform(s)',
} as const;

/**
 * Final row status derived from one attempt's per-device outcome. `sent` is
 * claimed only when at least one device was *accepted* by a provider — never
 * from an empty outcome or a no-op provider.
 */
export interface DeliveryOutcomeDecision {
  status: 'sent' | 'failed' | 'not_configured';
  reason: string | null;
  kind: 'transient' | 'permanent' | null;
  abandon: boolean;
  /** Tokens the provider accepted this attempt (accepted ≠ displayed). */
  deliveredTokens: string[];
}

export function decideDelivery(
  outcome: DeviceDeliveryOutcome,
  hasDevices: boolean,
  config: DeliveryPolicyConfig,
  attemptNumber: number,
): DeliveryOutcomeDecision {
  if (outcome.delivered.length > 0) {
    return {
      status: 'sent',
      reason: null,
      kind: null,
      abandon: false,
      deliveredTokens: [...outcome.delivered],
    };
  }
  if (!hasDevices) {
    // No device registered: retryable until the event window closes.
    return {
      status: 'failed',
      reason: 'No active device tokens registered',
      kind: attemptNumber >= config.maxAttempts ? 'permanent' : 'transient',
      abandon: attemptNumber >= config.maxAttempts,
      deliveredTokens: [],
    };
  }
  if (outcome.retryable.length > 0) {
    const gaveUp = attemptNumber >= config.maxAttempts;
    return {
      status: gaveUp ? 'failed' : 'failed',
      reason: gaveUp ? DELIVERY_ABANDON_REASONS.maxAttempts : 'Push delivery failed (transient)',
      kind: gaveUp ? 'permanent' : 'transient',
      abandon: gaveUp,
      deliveredTokens: [],
    };
  }
  if (outcome.notConfigured.length > 0 && outcome.invalid.length === 0) {
    return {
      status: 'not_configured',
      reason: DELIVERY_ABANDON_REASONS.noProvider,
      kind: 'permanent',
      abandon: true,
      deliveredTokens: [],
    };
  }
  return {
    status: 'failed',
    reason: DELIVERY_ABANDON_REASONS.permanent,
    kind: 'permanent',
    abandon: true,
    deliveredTokens: [],
  };
}
