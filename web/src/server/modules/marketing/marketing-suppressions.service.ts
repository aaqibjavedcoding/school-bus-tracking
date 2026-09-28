/**
 * The marketing do-not-send list: the console surface plus the one code path
 * every suppressor (unsubscribe link, provider event, Super Admin) goes
 * through.
 *
 * ### Why a manual console exists at all
 *
 * Be technically honest about the current setup: **plain Gmail SMTP gives
 * this application no reliable webhook for delayed bounces and complaints.**
 * An address that hard-bounces hours later produces a bounce message in the
 * sending mailbox, not an HTTP call. What the system *can* see automatically
 * is an immediate SMTP rejection (the delivery worker classifies it). So the
 * missing feedback loop is closed the only way that is truthful without a
 * paid provider: an operator reads the bounce in the mailbox and suppresses
 * the address here, in two clicks, with an audit record.
 *
 * The signed provider-event endpoint exists beside it for the day an actual
 * event source is configured — it is not a claim that one is.
 *
 * ### Rules encoded here
 *
 * - **Addresses are masked on the way out** (`ze***@gmail.com`). The console
 *   proves an address is suppressed without turning the page into a
 *   harvestable recipient list.
 * - **Search is exact-or-domain, never substring.** A substring search over
 *   local parts would be an enumeration oracle; matching a full address or a
 *   bare domain answers the operator's real question without one.
 * - **Suppressing is idempotent and forward-looking.** The unique index on
 *   `normalized_email` means re-suppression updates the existing row, and
 *   every not-yet-sent recipient row for that address is flipped to
 *   `SUPPRESSED` so a campaign mid-flight honours it immediately. Historic
 *   rows, counters and `email_events` are never touched.
 * - **Removal is deliberate.** It needs an explicit confirmation, and
 *   removing an `UNSUBSCRIBED` row additionally needs the opt-out
 *   acknowledgement — an unsubscribe is a legal instruction, not a filter.
 */

import { Op } from 'sequelize';
import { createHash } from 'crypto';
import {
  MarketingRecipientStatus,
  MarketingSuppressionReason,
  MarketingSuppressionSource,
  type MarketingSuppressionListQuery,
  type MarketingSuppressionListResponse,
  type MarketingSuppressionMutationResponse,
  type MarketingSuppressionSummary,
  type PaginationMeta,
} from '@school-bus-tracking/shared-types';
import { BadRequestException, Logger, NotFoundException } from '../../framework';
import type { EmailCampaignRecipient, MarketingSuppression } from '../../database/models';
import {
  MARKETING_EMAIL_PATTERN,
  MARKETING_SUPPRESSION_ADDED,
  MARKETING_SUPPRESSION_CONFIRM_REQUIRED,
  MARKETING_SUPPRESSION_INVALID_EMAIL,
  MARKETING_SUPPRESSION_NOT_FOUND,
  MARKETING_SUPPRESSION_REMOVED,
  MARKETING_SUPPRESSION_UNSUBSCRIBE_PROTECTED,
} from './marketing.constants';

export interface MarketingSuppressionsServiceDeps {
  suppressions: typeof MarketingSuppression;
  recipients: typeof EmailCampaignRecipient;
  now?: () => Date;
}

/** Result of the shared suppress-an-address path. */
export interface MarketingSuppressionApplied {
  suppression: MarketingSuppression;
  created: boolean;
  /** Not-yet-sent recipient rows switched to `SUPPRESSED`. */
  suppressedRecipients: number;
}

/**
 * `ze***@gmail.com` — enough to recognise an address you already know,
 * not enough to learn one you do not.
 */
export function maskMarketingEmail(email: string): string {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0) {
    return '***';
  }
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

/** SHA-256 of the normalized address — the only form safe for an audit log. */
export function marketingEmailDigest(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/** Normalizes and shape-checks an address; throws the safe 400 otherwise. */
export function normalizeMarketingEmail(raw: string): string {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (email.length < 3 || email.length > 254 || !MARKETING_EMAIL_PATTERN.test(email)) {
    throw new BadRequestException(MARKETING_SUPPRESSION_INVALID_EMAIL);
  }
  return email;
}

export class MarketingSuppressionsService {
  private readonly logger = new Logger(MarketingSuppressionsService.name);
  private readonly now: () => Date;

  constructor(private readonly deps: MarketingSuppressionsServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  // ----------------------------------------------------------------- reads

  async list(query: MarketingSuppressionListQuery): Promise<MarketingSuppressionListResponse> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const where: Record<string, unknown> = {};
    if (query.reason) {
      where.reason = query.reason;
    }
    const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';
    if (search.length > 0) {
      if (search.includes('@')) {
        // A full address: exact match only. Never a LIKE over local parts.
        where.normalized_email = search;
      } else {
        // A bare domain: anchored suffix match, so `gmail.com` cannot also
        // return `notgmail.com.example.org`.
        where.normalized_email = { [Op.like]: `%@${search}` };
      }
    }

    const { rows, count } = await this.deps.suppressions.findAndCountAll({
      where: where as never,
      order: [['created_at', 'DESC']],
      offset: (page - 1) * limit,
      limit,
    });

    const totalPages = Math.ceil(count / limit) || 1;
    const meta: PaginationMeta = {
      page,
      limit,
      total: count,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
    return { items: rows.map((row) => toSuppressionSummary(row)), meta };
  }

  // ------------------------------------------------------------- mutations

  /**
   * The single suppression path, shared by the manual console action and the
   * signed provider-event ingest.
   *
   * Idempotent: an existing row is updated (its reason is upgraded from a
   * weaker one, never downgraded away from `UNSUBSCRIBED`), and unsent
   * recipient rows are flipped every time — a second call costs one update
   * and changes nothing else.
   */
  async suppress(
    rawEmail: string,
    reason: MarketingSuppressionReason,
    source: MarketingSuppressionSource,
  ): Promise<MarketingSuppressionApplied> {
    const email = normalizeMarketingEmail(rawEmail);

    const [suppression, created] = await this.deps.suppressions.findOrCreate({
      where: { normalized_email: email },
      defaults: { normalized_email: email, reason, source } as never,
    });

    if (!created && suppression.reason !== reason) {
      // An opt-out is never overwritten by a system signal: the person's
      // instruction outranks the provider's observation.
      if (suppression.reason !== MarketingSuppressionReason.UNSUBSCRIBED) {
        await suppression.update({ reason, source } as never);
      }
    }

    const suppressedRecipients = await this.suppressPendingRecipients(email);
    return { suppression, created, suppressedRecipients };
  }

  /** `POST /api/v1/marketing/suppressions` — a Super Admin action. */
  async addManual(input: {
    email: string;
    reason: MarketingSuppressionReason;
  }): Promise<MarketingSuppressionMutationResponse> {
    const applied = await this.suppress(
      input.email,
      input.reason,
      MarketingSuppressionSource.SUPER_ADMIN,
    );
    return {
      suppression: toSuppressionSummary(applied.suppression),
      suppressed_recipients: applied.suppressedRecipients,
      message: MARKETING_SUPPRESSION_ADDED,
    };
  }

  /**
   * `DELETE /api/v1/marketing/suppressions/:id`.
   *
   * Two gates, both server-side: an explicit confirmation, and — for an
   * `UNSUBSCRIBED` row — an explicit acknowledgement that an opt-out is
   * being reversed. A console mis-click can therefore never put an address
   * that asked to be left alone back into a campaign.
   */
  async remove(
    id: string,
    options: { confirm: boolean; acknowledgeUnsubscribed?: boolean },
  ): Promise<MarketingSuppressionMutationResponse> {
    const suppression = await this.deps.suppressions.findOne({ where: { id } });
    if (!suppression) {
      throw new NotFoundException(MARKETING_SUPPRESSION_NOT_FOUND);
    }
    if (!options.confirm) {
      throw new BadRequestException(MARKETING_SUPPRESSION_CONFIRM_REQUIRED);
    }
    if (
      suppression.reason === MarketingSuppressionReason.UNSUBSCRIBED &&
      options.acknowledgeUnsubscribed !== true
    ) {
      throw new BadRequestException(MARKETING_SUPPRESSION_UNSUBSCRIBE_PROTECTED);
    }

    const summary = toSuppressionSummary(suppression);
    await this.deps.suppressions.destroy({ where: { id } as never });
    return {
      suppression: summary,
      suppressed_recipients: 0,
      message: MARKETING_SUPPRESSION_REMOVED,
    };
  }

  /** Reads one row (used by the API layer to build safe audit metadata). */
  async findOneOrThrow(id: string): Promise<MarketingSuppression> {
    const suppression = await this.deps.suppressions.findOne({ where: { id } });
    if (!suppression) {
      throw new NotFoundException(MARKETING_SUPPRESSION_NOT_FOUND);
    }
    return suppression;
  }

  // --------------------------------------------------------------- helpers

  /**
   * Flips every not-yet-sent recipient row of this address to `SUPPRESSED`,
   * across all campaigns.
   *
   * Only `PENDING`/`RETRYING` rows are touched, so `SENT` history, counters
   * and analytics stay exactly as they were: suppression is a forward-looking
   * rule, never a rewrite of what already happened.
   */
  private async suppressPendingRecipients(email: string): Promise<number> {
    try {
      const [affected] = await this.deps.recipients.update(
        {
          status: MarketingRecipientStatus.SUPPRESSED,
          next_attempt_at: null,
          locked_by: null,
          lease_expires_at: null,
        } as never,
        {
          where: {
            normalized_email: email,
            status: {
              [Op.in]: [MarketingRecipientStatus.PENDING, MarketingRecipientStatus.RETRYING],
            },
          } as never,
        },
      );
      return affected ?? 0;
    } catch (error) {
      this.logger.warn(
        `Could not suppress pending recipients: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return 0;
    }
  }
}

/** Projection: masked address only — the full mailbox never leaves the server. */
export function toSuppressionSummary(row: MarketingSuppression): MarketingSuppressionSummary {
  const email = row.normalized_email.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  return {
    id: row.id,
    masked_email: maskMarketingEmail(email),
    email_domain: at >= 0 ? email.slice(at + 1) : '',
    reason: row.reason,
    source: row.source,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

function toIso(value: Date | string | undefined | null): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' ? value : new Date().toISOString();
}
