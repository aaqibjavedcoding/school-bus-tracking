import { createHash } from 'node:crypto';
import type { NotificationType } from '@school-bus-tracking/shared-types';
import type { DeviceDeliveryOutcome } from '../providers';

/** Delivery workflow tunables (all env-backed in config/notification-delivery.config.ts). */
export interface DeliveryPolicyConfig {
  /** Drop a still-failing row after this many attempts. */
  maxAttempts: number;
  /** First retry delay; doubles per attempt up to a ceiling. */
  baseBackoffMs: number;
  /** How long after the event a proximity/attendance alert stays deliverable. */
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
 * is no longer useful and must not be delivered.
 *
 * `eventAtMs` is the **event's** clock (when the bus neared the stop, when the
 * child boarded), not the notification row's creation time: a delayed batch
 * must not grant an obsolete event a fresh 10-minute lifetime. The worker
 * additionally never sends a row whose deadline already passed.
 */
export function deliveryExpiry(eventAtMs: number, config: DeliveryPolicyConfig): Date {
  return new Date(eventAtMs + config.expiryMs);
}

/**
 * The stable natural key of one event — a full SHA-256 digest (64 hex chars) of
 * every identifier, formatted to fit the `dedup_key` column exactly.
 *
 * The previous implementation concatenated `<type>:<trip>:<student>:<stop>` and
 * sliced it to 64 characters, which can truncate a UUID and make two *different*
 * events (e.g. two stops, or two trips whose ids share a prefix) collide — a
 * collision would silently drop a real notification. A digest never truncates
 * an input: it is a fixed-length, collision-resistant function of the complete
 * composite key.
 */
export function deliveryDedupKey(args: {
  type: NotificationType | string;
  tripId?: string | null;
  studentId?: string | null;
  stopId?: string | null;
}): string {
  const composite = JSON.stringify([
    args.type,
    args.tripId ?? '',
    args.studentId ?? '',
    args.stopId ?? '',
  ]);
  return createHash('sha256').update(composite, 'utf8').digest('hex');
}

/** Reasons recorded by the outbox when it stops trying. */
export const DELIVERY_ABANDON_REASONS = {
  expired: 'Expired before push delivery (event window closed)',
  tripEnded: 'Trip is no longer tracking — proximity alert abandoned',
  maxAttempts: 'Maximum delivery attempts reached with devices still undelivered',
  permanent: 'All device tokens rejected permanently',
  noProvider: 'No push provider configured for the device platform(s)',
  misconfigured: 'Push provider configuration rejected the request — tokens kept',
  messageRejected: 'Push provider rejected the message payload permanently',
  devicesGone: 'Target device token(s) were unregistered or rotated away',
  providerDisabled: 'Push provider is a no-op in this deployment (not configured)',
} as const;

/** One attempt's per-device result, plus the durable state carried into it. */
export interface DeliveryAttempt {
  /** Attempt number, 1-based (persisted `delivery_retry_count` + 1). */
  attemptNumber: number;
  /** Device tokens targeted by this attempt (active + still pending). */
  attempted: string[];
  /** Provider outcome for `attempted`. */
  outcome: DeviceDeliveryOutcome;
  /** Tokens the provider already accepted on earlier attempts (persisted). */
  alreadyAccepted: string[];
  /**
   * Pending tokens that were *not* attempted because their device row is gone
   * (logged out, unregistered, invalidated). They are terminal — and they are
   * never replaced by newly registered devices mid-delivery, so a long retry
   * loop cannot keep expanding the recipient set.
   */
  dropped: string[];
  /** Whether the recipient had at least one active device at attempt time. */
  hasActiveDevices: boolean;
  /** Whether the event deadline passed before this attempt could send. */
  deadlinePassed: boolean;
}

/**
 * Final row status derived from one attempt's accumulated per-device outcome.
 *
 * - `sent`           every targeted device was accepted by a provider (or was
 *                    already accepted on an earlier attempt);
 * - `partial`        at least one device was accepted, but other targeted
 *                    device(s) reached a terminal non-delivery (retired token,
 *                    no rail, provider misconfiguration, exhausted retries or
 *                    a closed event window) — the failed devices are never
 *                    counted as delivered;
 * - `not_configured` nothing was accepted and no device could be reached
 *                    because the rail is absent/misconfigured;
 * - `failed`         nothing was accepted (and, when `abandon` is false, the
 *                    row will be retried).
 */
export type DeliveryDecisionStatus = 'sent' | 'partial' | 'failed' | 'not_configured';

export interface DeliveryOutcomeDecision {
  status: DeliveryDecisionStatus;
  reason: string | null;
  kind: 'transient' | 'permanent' | null;
  abandon: boolean;
  /** Provider-accepted tokens, accumulated across every attempt. */
  acceptedTokens: string[];
  /** Tokens still owed a delivery when `abandon` is false. */
  pendingTokens: string[];
  /** True only when every targeted device ended up accepted or permanently dead. */
  complete: boolean;
}

/**
 * Decides what happens to one notification row after an attempt, from the
 * **accumulated** per-device state.
 *
 * Key properties (corrective patch):
 * - an accepted device is never re-sent and never lost when another device
 *   fails (the accepted set is carried through `alreadyAccepted`);
 * - only devices still owed a delivery are retried;
 * - retries continue until the remaining devices succeed, are permanently
 *   rejected, expire, or the attempt limit is hit;
 * - complete success (`sent`) is distinguished from partial terminal success
 *   (`partial`) — a failed device is never reported as delivered;
 * - token-level invalidity (`invalid`) never blocks the other devices;
 * - configuration failures (`misconfigured`) are terminal but never retire a
 *   token, and a bare "no device registered yet" keeps retrying inside the
 *   event window.
 */
export function decideDelivery(
  attempt: DeliveryAttempt,
  config: DeliveryPolicyConfig,
): DeliveryOutcomeDecision {
  const outcome = attempt.outcome;
  const attempted = new Set(attempt.attempted);

  // Accumulate: previously accepted ∪ accepted this attempt (attempted only).
  const acceptedTokens = unique([
    ...attempt.alreadyAccepted,
    ...outcome.delivered.filter((token) => attempted.has(token)),
  ]);

  // Only retryable devices are owed another try.
  const retryable = unique(outcome.retryable.filter((token) => attempted.has(token)));

  const invalid = unique(outcome.invalid.filter((token) => attempted.has(token)));
  const notConfigured = unique(outcome.notConfigured.filter((token) => attempted.has(token)));
  const misconfigured = unique(
    (outcome.misconfigured ?? []).filter((token) => attempted.has(token)),
  );
  const messageRejected = unique((outcome.permanent ?? []).filter((token) => attempted.has(token)));
  const expired = unique((outcome.expired ?? []).filter((token) => attempted.has(token)));
  const dropped = unique(attempt.dropped);

  const permanentlyLost = [
    ...invalid,
    ...notConfigured,
    ...misconfigured,
    ...messageRejected,
    ...expired,
    ...dropped,
  ];

  // Defensive: a provider bug that silently drops a token must never look like
  // a success — the token stays pending and is retried.
  const unaccounted = attempt.attempted.filter(
    (token) =>
      !acceptedTokens.includes(token) &&
      !retryable.includes(token) &&
      !permanentlyLost.includes(token),
  );
  const stillPending = unique([...retryable, ...unaccounted]);

  // Devices that were targeted and never accepted. `invalid` and `dropped`
  // tokens are *gone* and excluded; the rest stay visible as "never
  // delivered" evidence on a terminal row (e.g. a configuration failure that
  // would be fixable, or a device that ran out of retries).
  const undelivered = unique([
    ...stillPending,
    ...notConfigured,
    ...misconfigured,
    ...messageRejected,
    ...expired,
  ]);

  const gaveUp = attempt.attemptNumber >= config.maxAttempts;
  const terminalWithoutRetry =
    attempt.deadlinePassed || gaveUp || misconfigured.length > 0 || messageRejected.length > 0;

  // Nothing left to try for the devices that were targeted.
  if (stillPending.length === 0) {
    if (acceptedTokens.length > 0) {
      if (permanentlyLost.length === 0) {
        return decision('sent', null, null, false, acceptedTokens, [], true);
      }
      return decision(
        'partial',
        `Delivered to ${acceptedTokens.length} device(s); ${permanentlyLost.length} device(s) could not receive it (${describeLoss(
          {
            invalid,
            notConfigured,
            misconfigured,
            messageRejected,
            expired,
            dropped,
          },
        )})`,
        'permanent',
        true,
        acceptedTokens,
        [],
        false,
      );
    }

    // No accepted device at all.
    if (!attempt.hasActiveDevices && attempt.attempted.length === 0 && dropped.length === 0) {
      // No device registered yet: retryable until the window closes, so a
      // parent who installs/logs in during the window still gets the alert.
      if (gaveUp || attempt.deadlinePassed) {
        return decision(
          'failed',
          gaveUp ? DELIVERY_ABANDON_REASONS.maxAttempts : DELIVERY_ABANDON_REASONS.expired,
          'permanent',
          true,
          [],
          undelivered,
          true,
        );
      }
      return decision(
        'failed',
        'No active device tokens registered yet (will retry within the event window)',
        'transient',
        false,
        [],
        [],
        false,
      );
    }

    if (notConfigured.length > 0 && misconfigured.length === 0) {
      return decision(
        'not_configured',
        DELIVERY_ABANDON_REASONS.noProvider,
        'permanent',
        true,
        [],
        undelivered,
        true,
      );
    }
    if (misconfigured.length > 0) {
      return decision(
        'not_configured',
        configReason(outcome, misconfigured),
        'permanent',
        true,
        [],
        undelivered,
        true,
      );
    }
    if (messageRejected.length > 0) {
      return decision(
        'failed',
        outcome.permanentReason
          ? `${DELIVERY_ABANDON_REASONS.messageRejected}: ${outcome.permanentReason}`
          : DELIVERY_ABANDON_REASONS.messageRejected,
        'permanent',
        true,
        [],
        undelivered,
        true,
      );
    }
    if (invalid.length > 0) {
      return decision(
        'failed',
        DELIVERY_ABANDON_REASONS.permanent,
        'permanent',
        true,
        [],
        undelivered,
        true,
      );
    }
    if (expired.length > 0) {
      return decision(
        'failed',
        'Device(s) skipped: notification deadline passed before send',
        'permanent',
        true,
        [],
        undelivered,
        true,
      );
    }
    return decision(
      'failed',
      DELIVERY_ABANDON_REASONS.devicesGone,
      'permanent',
      true,
      [],
      undelivered,
      true,
    );
  }

  // Devices are still owed a delivery. Terminal only when the event window
  // closed, the attempt budget is spent, or the rail/message is permanently
  // rejected (a configuration error is not fixed by retrying the same body).
  if (terminalWithoutRetry) {
    const reason = attempt.deadlinePassed
      ? DELIVERY_ABANDON_REASONS.expired
      : gaveUp
        ? DELIVERY_ABANDON_REASONS.maxAttempts
        : misconfigured.length > 0
          ? configReason(outcome, misconfigured)
          : DELIVERY_ABANDON_REASONS.messageRejected;
    if (acceptedTokens.length > 0) {
      return decision(
        'partial',
        `Delivered to ${acceptedTokens.length} device(s); ${stillPending.length} still undelivered (${reason})`,
        'permanent',
        true,
        acceptedTokens,
        undelivered,
        false,
      );
    }
    if (misconfigured.length > 0) {
      return decision('not_configured', reason, 'permanent', true, [], undelivered, false);
    }
    return decision('failed', reason, 'permanent', true, [], undelivered, false);
  }

  return decision(
    'failed',
    acceptedTokens.length > 0
      ? `Delivered to ${acceptedTokens.length} device(s); retrying ${stillPending.length} device(s)`
      : 'Push delivery incomplete (transient) — retrying',
    'transient',
    false,
    acceptedTokens,
    stillPending,
    false,
  );
}

function decision(
  status: DeliveryDecisionStatus,
  reason: string | null,
  kind: 'transient' | 'permanent' | null,
  abandon: boolean,
  acceptedTokens: string[],
  pendingTokens: string[],
  complete: boolean,
): DeliveryOutcomeDecision {
  return {
    status,
    reason,
    kind,
    abandon,
    acceptedTokens: unique(acceptedTokens),
    pendingTokens: unique(pendingTokens),
    complete,
  };
}

function configReason(outcome: DeviceDeliveryOutcome, tokens: string[]): string {
  const detail = outcome.misconfiguredReason ? `: ${outcome.misconfiguredReason}` : '';
  return `${DELIVERY_ABANDON_REASONS.misconfigured} (${tokens.length} device(s))${detail}`;
}

function describeLoss(groups: {
  invalid: string[];
  notConfigured: string[];
  misconfigured: string[];
  messageRejected: string[];
  expired: string[];
  dropped: string[];
}): string {
  const parts: string[] = [];
  if (groups.invalid.length > 0) parts.push(`${groups.invalid.length} invalid token(s)`);
  if (groups.notConfigured.length > 0)
    parts.push(`${groups.notConfigured.length} without a provider`);
  if (groups.misconfigured.length > 0)
    parts.push(`${groups.misconfigured.length} blocked by configuration`);
  if (groups.messageRejected.length > 0)
    parts.push(`${groups.messageRejected.length} rejected message(s)`);
  if (groups.expired.length > 0) parts.push(`${groups.expired.length} past the deadline`);
  if (groups.dropped.length > 0) parts.push(`${groups.dropped.length} no longer registered`);
  return parts.length > 0 ? parts.join(', ') : 'reason unknown';
}

function unique(tokens: string[]): string[] {
  return [...new Set(tokens)];
}
