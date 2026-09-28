/**
 * The provider-neutral, signed email-event endpoint.
 *
 * ```text
 * POST /api/v1/integrations/marketing/email-events
 * ```
 *
 * ### The honest framing
 *
 * Plain Gmail SMTP — the current sender — **does not call this endpoint**.
 * Gmail reports a delayed bounce or a spam complaint as a message in the
 * sending mailbox, not as an HTTP callback, and no free API turns that into
 * a reliable application webhook. What this deployment sees automatically is
 * only the *immediate* SMTP rejection the delivery worker already classifies.
 *
 * So this module is deliberately built as the **future-compatible** half of
 * the feedback loop: a verified, idempotent, provider-neutral ingest that a
 * real event source (a future provider, a Gmail/Workspace integration, or an
 * operator-run forwarder) can be pointed at without changing suppression
 * logic. The working path today is the Super Admin manual suppression
 * console. Nothing in the product claims automatic Gmail bounce processing.
 *
 * ### Why each guard is here
 *
 * - **A shared secret** (`MARKETING_PROVIDER_WEBHOOK_SECRET`). With no
 *   secret configured the endpoint is closed: an unauthenticated suppression
 *   endpoint is a denial-of-marketing vulnerability — anyone could suppress
 *   any address.
 * - **HMAC-SHA256 over `timestamp.rawBody`**, compared with
 *   `timingSafeEqual`. Signing the *raw* bytes (not a re-serialization) is
 *   what makes the signature mean anything.
 * - **A timestamp window** (±5 minutes) bounds replay to a tiny interval…
 * - **…and `(provider, provider_event_id)` is unique**, which closes replay
 *   completely: the second delivery of the same event is a no-op, not a
 *   second suppression.
 * - **A bounded body.** 64 KB, checked before parsing.
 * - **Safe, identical error responses.** Bad signature, stale timestamp and
 *   malformed payload all answer the same sentence; the endpoint is not an
 *   oracle for "is this secret right".
 *
 * ### What is stored
 *
 * A normalized event type, the provider's message/event ids, the correlated
 * campaign/recipient, a **digest** of the address and a bounded metadata
 * allowlist. Never the raw payload — provider payloads routinely embed the
 * full message, recipient headers and signed URLs.
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto';
import {
  MarketingEventType,
  MarketingProviderEventType,
  MarketingSuppressionReason,
  MarketingSuppressionSource,
  type MarketingProviderEventAckResponse,
} from '@school-bus-tracking/shared-types';
import { BadRequestException, Logger, UnauthorizedException } from '../../framework';
import type {
  EmailCampaignRecipient,
  EmailEvent,
  MarketingProviderEvent,
} from '../../database/models';
import type { MarketingSuppressionsService } from './marketing-suppressions.service';
import { marketingEmailDigest, normalizeMarketingEmail } from './marketing-suppressions.service';
import {
  MARKETING_PROVIDER_EVENTS_DISABLED,
  MARKETING_PROVIDER_EVENT_MAX_BODY_BYTES,
  MARKETING_PROVIDER_EVENT_REJECTED,
  MARKETING_PROVIDER_EVENT_TIMESTAMP_TOLERANCE_MS,
} from './marketing.constants';

/** Header names of the signed envelope (provider-neutral spelling). */
export const MARKETING_WEBHOOK_SIGNATURE_HEADER = 'x-marketing-signature';
export const MARKETING_WEBHOOK_TIMESTAMP_HEADER = 'x-marketing-timestamp';

/** Raw, already-read request material the endpoint definition hands over. */
export interface MarketingProviderEventRequest {
  rawBody: string;
  signature: string | undefined;
  timestamp: string | undefined;
}

export interface MarketingEmailEventsServiceDeps {
  providerEvents: typeof MarketingProviderEvent;
  recipients: typeof EmailCampaignRecipient;
  events: typeof EmailEvent;
  suppressions: MarketingSuppressionsService;
  /** Read at call time so rotating the secret needs no restart. */
  secret: () => string;
  now?: () => Date;
}

/** Normalizes a provider's vocabulary onto the four supported events. */
export function normalizeProviderEventType(payload: {
  type?: unknown;
  event?: unknown;
  bounce_type?: unknown;
}): MarketingProviderEventType | null {
  const raw = String(payload.type ?? payload.event ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const bounceClass = String(payload.bounce_type ?? '')
    .trim()
    .toLowerCase();

  switch (raw) {
    case 'delivered':
    case 'delivery':
      return MarketingProviderEventType.DELIVERED;
    case 'hard_bounce':
    case 'permanent_bounce':
      return MarketingProviderEventType.HARD_BOUNCE;
    case 'soft_bounce':
    case 'transient_bounce':
      return MarketingProviderEventType.SOFT_BOUNCE;
    case 'complaint':
    case 'spam_complaint':
    case 'abuse':
      return MarketingProviderEventType.COMPLAINT;
    case 'bounce':
      // A bare "bounce" is only actionable with its class; an unclassified
      // bounce is treated as soft, because suppressing on a temporary
      // failure would silently shrink the audience forever.
      return bounceClass === 'hard' || bounceClass === 'permanent'
        ? MarketingProviderEventType.HARD_BOUNCE
        : MarketingProviderEventType.SOFT_BOUNCE;
    default:
      return null;
  }
}

export class MarketingEmailEventsService {
  private readonly logger = new Logger(MarketingEmailEventsService.name);
  private readonly now: () => Date;

  constructor(private readonly deps: MarketingEmailEventsServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Verifies and ingests one signed provider event.
   *
   * Throws `UnauthorizedException` with one constant message for every
   * verification failure, and `BadRequestException` for a payload that is
   * signed but unusable. Neither error ever echoes the payload.
   */
  async ingest(request: MarketingProviderEventRequest): Promise<MarketingProviderEventAckResponse> {
    const secret = this.deps.secret();
    if (secret.length < 16) {
      // Closed by default: no secret, no ingest.
      throw new UnauthorizedException(MARKETING_PROVIDER_EVENTS_DISABLED);
    }

    const rawBody = request.rawBody ?? '';
    if (Buffer.byteLength(rawBody, 'utf8') > MARKETING_PROVIDER_EVENT_MAX_BODY_BYTES) {
      throw new BadRequestException(MARKETING_PROVIDER_EVENT_REJECTED);
    }

    this.assertFreshTimestamp(request.timestamp);
    this.assertValidSignature(secret, request.timestamp ?? '', rawBody, request.signature);

    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      throw new BadRequestException(MARKETING_PROVIDER_EVENT_REJECTED);
    }

    const providerEventId = safeIdentifier(payload['event_id'] ?? payload['id'], 190);
    if (!providerEventId) {
      throw new BadRequestException(MARKETING_PROVIDER_EVENT_REJECTED);
    }
    const provider = safeIdentifier(payload['provider'], 40) ?? 'unknown';
    const eventType = normalizeProviderEventType(payload);
    if (!eventType) {
      // Signed, well-formed, but not an event this system acts on. Answer
      // 200-shaped (accepted, nothing happened) so a provider does not retry
      // forever over an event type we simply ignore.
      return { accepted: true, duplicate: false, event_type: null, suppressed: false };
    }

    const providerMessageId = safeIdentifier(payload['message_id'], 255);
    const rawEmail = typeof payload['email'] === 'string' ? payload['email'] : '';
    let normalizedEmail: string | null = null;
    if (rawEmail) {
      try {
        normalizedEmail = normalizeMarketingEmail(rawEmail);
      } catch {
        normalizedEmail = null;
      }
    }

    // Correlate: the provider message id first (written by the delivery
    // worker on a successful send), the normalized address second — the
    // address is used server-side only, and never stored here in the clear.
    const recipient = await this.correlateRecipient(providerMessageId, normalizedEmail);
    const targetEmail = normalizedEmail ?? recipient?.normalized_email ?? null;

    const occurredAt = parseOccurredAt(payload['occurred_at'], this.now());
    const created = await this.storeEvent({
      provider,
      providerEventId,
      eventType,
      providerMessageId,
      recipient,
      emailDigest: targetEmail ? marketingEmailDigest(targetEmail) : null,
      occurredAt,
      bounceClass: safeIdentifier(payload['bounce_type'], 32),
      statusCode: safeIdentifier(payload['status'], 16),
    });
    if (!created) {
      // Duplicate provider event id — replay. Nothing is applied twice.
      return { accepted: true, duplicate: true, event_type: eventType, suppressed: false };
    }

    let suppressed = false;
    if (
      eventType === MarketingProviderEventType.HARD_BOUNCE ||
      eventType === MarketingProviderEventType.COMPLAINT
    ) {
      if (targetEmail) {
        await this.deps.suppressions.suppress(
          targetEmail,
          eventType === MarketingProviderEventType.HARD_BOUNCE
            ? MarketingSuppressionReason.HARD_BOUNCE
            : MarketingSuppressionReason.COMPLAINED,
          MarketingSuppressionSource.SYSTEM,
        );
        suppressed = true;
      }
      if (recipient) {
        await this.recordCampaignEvent(
          recipient,
          eventType === MarketingProviderEventType.HARD_BOUNCE
            ? MarketingEventType.BOUNCED
            : MarketingEventType.COMPLAINED,
          { source: 'provider-event' },
        );
      }
    }

    return { accepted: true, duplicate: false, event_type: eventType, suppressed };
  }

  // --------------------------------------------------------- verification

  private assertFreshTimestamp(raw: string | undefined): void {
    const value = Number(raw);
    if (!raw || !Number.isFinite(value)) {
      throw new UnauthorizedException(MARKETING_PROVIDER_EVENT_REJECTED);
    }
    // Accept seconds or milliseconds: providers differ, and both are
    // unambiguous by magnitude.
    const millis = value > 1e12 ? value : value * 1000;
    const drift = Math.abs(this.now().getTime() - millis);
    if (drift > MARKETING_PROVIDER_EVENT_TIMESTAMP_TOLERANCE_MS) {
      throw new UnauthorizedException(MARKETING_PROVIDER_EVENT_REJECTED);
    }
  }

  private assertValidSignature(
    secret: string,
    timestamp: string,
    rawBody: string,
    presented: string | undefined,
  ): void {
    const offered = (presented ?? '').trim().replace(/^sha256=/i, '');
    if (!/^[a-f0-9]{64}$/i.test(offered)) {
      throw new UnauthorizedException(MARKETING_PROVIDER_EVENT_REJECTED);
    }
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(offered.toLowerCase(), 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn('Provider event rejected: signature verification failed.');
      throw new UnauthorizedException(MARKETING_PROVIDER_EVENT_REJECTED);
    }
  }

  // -------------------------------------------------------------- storage

  /** Returns false when the event id already existed (idempotent replay). */
  private async storeEvent(input: {
    provider: string;
    providerEventId: string;
    eventType: MarketingProviderEventType;
    providerMessageId: string | null;
    recipient: EmailCampaignRecipient | null;
    emailDigest: string | null;
    occurredAt: Date;
    bounceClass: string | null;
    statusCode: string | null;
  }): Promise<boolean> {
    const [, created] = await this.deps.providerEvents.findOrCreate({
      where: { provider: input.provider, provider_event_id: input.providerEventId } as never,
      defaults: {
        provider: input.provider,
        provider_event_id: input.providerEventId,
        event_type: input.eventType,
        provider_message_id: input.providerMessageId,
        campaign_id: input.recipient?.campaign_id ?? null,
        campaign_recipient_id: input.recipient?.id ?? null,
        email_digest: input.emailDigest,
        occurred_at: input.occurredAt,
        received_at: this.now(),
        // The allowlist. Everything else in the provider payload is dropped.
        metadata: {
          event_type: input.eventType,
          ...(input.bounceClass ? { bounce_class: input.bounceClass } : {}),
          ...(input.statusCode ? { status: input.statusCode } : {}),
        },
      } as never,
    });
    return created;
  }

  /** Correlation is server-side only; the address never leaves this method. */
  private async correlateRecipient(
    providerMessageId: string | null,
    normalizedEmail: string | null,
  ): Promise<EmailCampaignRecipient | null> {
    if (providerMessageId) {
      const byMessage = await this.deps.recipients.findOne({
        where: { provider_message_id: providerMessageId } as never,
      });
      if (byMessage) {
        return byMessage;
      }
    }
    if (normalizedEmail) {
      const byEmail = await this.deps.recipients.findOne({
        where: { normalized_email: normalizedEmail } as never,
        order: [['created_at', 'DESC']],
      });
      if (byEmail) {
        return byEmail;
      }
    }
    return null;
  }

  /** Appends the campaign-level analytics event (safe metadata only). */
  private async recordCampaignEvent(
    recipient: EmailCampaignRecipient,
    eventType: MarketingEventType,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.deps.events.create({
        campaign_id: recipient.campaign_id,
        campaign_recipient_id: recipient.id,
        event_type: eventType,
        occurred_at: this.now(),
        metadata,
      } as never);
    } catch (error) {
      this.logger.warn(
        `Marketing event write failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}

/** Bounded, printable identifier or null — never trusted verbatim. */
function safeIdentifier(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return null;
  }
  return /^[\w.@:+/=-]+$/.test(trimmed) ? trimmed : null;
}

function parseOccurredAt(value: unknown, fallback: Date): Date {
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return fallback;
}

/** Exported for the endpoint definition and the tests. */
export function signMarketingProviderEvent(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/** Exported for tests that need the stored digest form. */
export function providerEventEmailDigest(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}
