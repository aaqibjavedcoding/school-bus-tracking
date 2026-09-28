/**
 * The public (unauthenticated) half of marketing: click tracking and
 * unsubscribe.
 *
 * Both endpoints are reachable by anyone holding a link out of an inbox, so
 * the service is written defensively from the first line:
 *
 * - **The token is the only credential, and it is opaque.** It is compared
 *   against a stored SHA-256 digest, exactly like a password-reset token. A
 *   database leak therefore yields no usable links, and a guessed id yields
 *   nothing at all because ids are not tokens.
 * - **Every rejection is the same rejection.** Unknown token, cancelled
 *   campaign, expired campaign and malformed input all produce one message.
 *   Distinguishing them would turn the endpoint into an oracle for "does
 *   this token/campaign exist".
 * - **Nothing personal comes back.** No address, no school, no campaign
 *   name, no counts. The unsubscribe response is a sentence; the click
 *   response is a redirect.
 * - **The redirect target is fixed.** It is built from the configured
 *   `APP_URL` and a constant path — never from anything in the request. A
 *   tracking redirect that honoured a `?next=` parameter would be a textbook
 *   open redirect, and a marketing link is precisely the link people click
 *   without looking.
 * - **Raw tokens are never logged.** Not at debug level, not in an error
 *   path. The only identifiers that reach a log line here are campaign ids.
 */

import { Op } from 'sequelize';
import {
  MarketingEventType,
  MarketingCampaignStatus,
  MarketingRecipientStatus,
  MarketingSuppressionReason,
  MarketingSuppressionSource,
  MARKETING_SAFE_UTM_PARAMETERS,
  type MarketingUnsubscribeResponse,
  type MarketingUtmParameters,
} from '@school-bus-tracking/shared-types';
import { Logger, NotFoundException } from '../../framework';
import type {
  EmailCampaign,
  EmailCampaignRecipient,
  EmailEvent,
  MarketingSuppression,
} from '../../database/models';
import { hashMarketingToken, pickSafeUtmParameters } from './marketing-message.builder';
import {
  MARKETING_ALREADY_UNSUBSCRIBED_MESSAGE,
  MARKETING_TRACKING_TOKEN_INVALID,
  MARKETING_UNSUBSCRIBED_MESSAGE,
} from './marketing.constants';

/** Name of the first-party attribution cookie set on a tracked click. */
export const MARKETING_ATTRIBUTION_COOKIE = 'zms_ref';

/** Attribution cookie lifetime: 30 days, the usual marketing window. */
export const MARKETING_ATTRIBUTION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Shape of the attribution cookie value: `campaignDigest.recipientDigest`,
 * two truncated SHA-256 digests. The recipient half is optional so a cookie
 * minted by the Session 3 format (campaign digest only) still resolves its
 * campaign.
 */
export const MARKETING_ATTRIBUTION_VALUE_PATTERN = /^[a-f0-9]{32}(\.[a-f0-9]{32})?$/;

/** Truncated digest of a campaign id — the public half of the cookie. */
export function marketingAttributionCampaignDigest(campaignId: string): string {
  return hashMarketingToken(`attribution:${campaignId}`).slice(0, 32);
}

/** Truncated digest binding a recipient to its campaign inside the cookie. */
export function marketingAttributionRecipientDigest(
  campaignId: string,
  recipientId: string,
): string {
  return hashMarketingToken(`attribution:${campaignId}:${recipientId}`).slice(0, 32);
}

/**
 * A resolved (and therefore *valid*) attribution cookie.
 *
 * `campaign_recipient_id` is null when only the campaign half resolved —
 * either a legacy cookie or a recipient digest that matches nothing, which
 * is treated as "no recipient attribution", never as an error the visitor
 * could observe.
 */
export interface MarketingResolvedAttribution {
  campaign_id: string;
  campaign_recipient_id: string | null;
}

/** Where a tracked click lands. A constant, never request-derived. */
export const MARKETING_LANDING_PATH = '/';

/** What the click endpoint needs in order to answer. */
export interface MarketingClickResult {
  /** Absolute, allowlisted redirect target. */
  redirectUrl: string;
  /** Opaque value for the first-party attribution cookie. */
  attributionValue: string;
  /** True when this recipient had already clicked before. */
  repeat: boolean;
}

export interface MarketingTrackingServiceDeps {
  recipients: typeof EmailCampaignRecipient;
  campaigns: typeof EmailCampaign;
  events: typeof EmailEvent;
  suppressions: typeof MarketingSuppression;
  /** Public origin of this deployment (`APP_URL`). */
  appUrl: () => string;
}

/** Token shape check before any database work (cheap, and bounds the input). */
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

export class MarketingTrackingService {
  private readonly logger = new Logger(MarketingTrackingService.name);

  constructor(private readonly deps: MarketingTrackingServiceDeps) {}

  /**
   * Records a click and returns the (fixed) redirect target.
   *
   * Unique clicks are counted by a **conditional** update
   * (`WHERE first_clicked_at IS NULL`): the database decides, atomically,
   * which of N concurrent clicks is the first. Counting them in application
   * code would either double-count a double-click or need a lock; this needs
   * neither, and it makes a repeated click provably unable to inflate the
   * unique figure.
   */
  async recordClick(
    rawToken: string,
    query: URLSearchParams = new URLSearchParams(),
  ): Promise<MarketingClickResult> {
    const recipient = await this.resolveRecipient('click_token_hash', rawToken);
    const campaign = await this.requireLiveCampaign(recipient.campaign_id);

    const now = new Date();
    // Total clicks: an unconditional atomic increment (never a read-modify-
    // write, which would lose concurrent clicks).
    await this.deps.recipients.increment('click_count', { where: { id: recipient.id } as never });
    const [firstClickAffected] = await this.deps.recipients.update(
      { first_clicked_at: now } as never,
      { where: { id: recipient.id, first_clicked_at: null } as never },
    );
    const isFirstClick = (firstClickAffected ?? 0) > 0;

    await this.increment(campaign.id, 'total_click_count');
    if (isFirstClick) {
      await this.increment(campaign.id, 'clicked_count');
    }

    await this.recordEvent(recipient, MarketingEventType.CLICKED, {
      // Bounded, non-identifying: whether it was the first click, and the
      // attribution that came in on the link. Never the token, never the
      // address, never a full URL.
      unique: isFirstClick,
      utm: pickSafeUtmParameters(query, MARKETING_SAFE_UTM_PARAMETERS),
    });

    return {
      redirectUrl: this.buildRedirectUrl(query),
      attributionValue: this.attributionValue(campaign.id, recipient.id),
      repeat: !isFirstClick,
    };
  }

  /**
   * Resolves an attribution cookie back to its campaign (and, when the
   * recipient half matches, the specific snapshotted recipient).
   *
   * Everything about this is defensive, because the input is a cookie any
   * visitor can forge:
   *
   * - the value must match {@link MARKETING_ATTRIBUTION_VALUE_PATTERN} —
   *   junk is dropped before any database work;
   * - the campaign is found by recomputing digests over a **bounded** set of
   *   recent campaigns (never by trusting an id from the client — the cookie
   *   carries no id to trust);
   * - the recipient half only matches recipients **of that campaign** that
   *   have actually **clicked** (only a click ever mints the cookie), again
   *   over a bounded set;
   * - a mismatch anywhere resolves to `null` / campaign-only. No caller can
   *   distinguish "forged" from "expired" from "absent".
   *
   * Honest scope note: if the campaign email was forwarded, the cookie — and
   * therefore this attribution — represents the **original recipient**, not
   * necessarily the person now filling in the form. The form's own email
   * field is the reliable identity of the submitter.
   */
  async resolveAttribution(rawValue: string | undefined): Promise<MarketingResolvedAttribution | null> {
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!MARKETING_ATTRIBUTION_VALUE_PATTERN.test(value)) {
      return null;
    }
    const [campaignDigest, recipientDigest] = value.split('.');

    // Recompute digests over recent campaigns. The cookie lives 30 days, so
    // anything older than the cookie window (plus slack) cannot match.
    const cutoff = new Date(Date.now() - MARKETING_ATTRIBUTION_COOKIE_MAX_AGE_MS * 2);
    const campaigns = await this.deps.campaigns.findAll({
      where: { created_at: { [Op.gte]: cutoff } } as never,
      order: [['created_at', 'DESC']],
      limit: 500,
    });
    const campaign = campaigns.find(
      (candidate) => marketingAttributionCampaignDigest(candidate.id) === campaignDigest,
    );
    if (!campaign || campaign.status === MarketingCampaignStatus.CANCELLED) {
      return null;
    }

    if (!recipientDigest) {
      return { campaign_id: campaign.id, campaign_recipient_id: null };
    }

    // Only clicked recipients of this campaign can have minted the cookie.
    const clicked = await this.deps.recipients.findAll({
      where: { campaign_id: campaign.id, first_clicked_at: { [Op.ne]: null } } as never,
      order: [['first_clicked_at', 'DESC']],
      limit: 5000,
    });
    const recipient = clicked.find(
      (candidate) =>
        marketingAttributionRecipientDigest(campaign.id, candidate.id) === recipientDigest,
    );

    return {
      campaign_id: campaign.id,
      campaign_recipient_id: recipient?.id ?? null,
    };
  }

  /**
   * Suppresses the recipient's address. Idempotent by construction.
   *
   * Scope note: this adds the address to `marketing_suppressions`, which
   * governs **marketing** mail only. Password resets, trip alerts and other
   * transactional messages rest on a different basis (the school's service
   * relationship) and are deliberately untouched — silently disabling them
   * would strand a school admin outside their own account.
   *
   * Historic analytics are never deleted: the recipient rows and
   * `email_events` of past campaigns stay exactly as they were. Suppression
   * is a forward-looking rule, not an erasure.
   */
  async unsubscribe(rawToken: string): Promise<MarketingUnsubscribeResponse> {
    const recipient = await this.resolveRecipient('unsubscribe_token_hash', rawToken);
    // A cancelled campaign's unsubscribe link must still work — the message
    // is already in the recipient's inbox, and refusing the opt-out would be
    // both rude and non-compliant. Only the token itself has to be valid.
    const email = recipient.normalized_email.trim().toLowerCase();

    const [, created] = await this.deps.suppressions.findOrCreate({
      where: { normalized_email: email },
      defaults: {
        normalized_email: email,
        reason: MarketingSuppressionReason.UNSUBSCRIBED,
        source: MarketingSuppressionSource.RECIPIENT_LINK,
      } as never,
    });

    const now = new Date();
    const [affected] = await this.deps.recipients.update(
      { unsubscribed_at: now } as never,
      { where: { id: recipient.id, unsubscribed_at: null } as never },
    );
    const firstTimeForThisCampaign = (affected ?? 0) > 0;

    if (firstTimeForThisCampaign) {
      await this.increment(recipient.campaign_id, 'unsubscribed_count');
      await this.recordEvent(recipient, MarketingEventType.UNSUBSCRIBED, { one_click: true });
    }

    // Any recipient row of this address that has not gone out yet is skipped
    // — including rows in *other* scheduled campaigns. The worker re-checks
    // suppression at send time as well; doing it here too means the console
    // shows the truth immediately instead of after the next sweep.
    await this.deps.recipients.update(
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

    return {
      unsubscribed: true,
      already_unsubscribed: !created,
      message: created ? MARKETING_UNSUBSCRIBED_MESSAGE : MARKETING_ALREADY_UNSUBSCRIBED_MESSAGE,
    };
  }

  // -------------------------------------------------------------- helpers

  /** Resolves a raw token to its recipient row, or throws the safe 404. */
  private async resolveRecipient(
    column: 'click_token_hash' | 'unsubscribe_token_hash',
    rawToken: string,
  ): Promise<EmailCampaignRecipient> {
    const token = typeof rawToken === 'string' ? rawToken.trim() : '';
    if (!TOKEN_PATTERN.test(token)) {
      // Shape check first: it costs nothing and keeps junk out of the query
      // planner. The message is the same as every other rejection.
      throw new NotFoundException(MARKETING_TRACKING_TOKEN_INVALID);
    }
    const recipient = await this.deps.recipients.findOne({
      where: { [column]: hashMarketingToken(token) } as never,
    });
    if (!recipient) {
      throw new NotFoundException(MARKETING_TRACKING_TOKEN_INVALID);
    }
    return recipient;
  }

  /** The campaign must still be a live one for a click to be attributable. */
  private async requireLiveCampaign(campaignId: string): Promise<EmailCampaign> {
    const campaign = await this.deps.campaigns.findOne({ where: { id: campaignId } });
    if (!campaign || campaign.status === MarketingCampaignStatus.CANCELLED) {
      throw new NotFoundException(MARKETING_TRACKING_TOKEN_INVALID);
    }
    return campaign;
  }

  /** Atomic `SET x = x + 1`; counters can only ever move up this way. */
  private async increment(campaignId: string, column: string): Promise<void> {
    try {
      await this.deps.campaigns.increment(column as never, {
        where: { id: campaignId } as never,
      });
    } catch (error) {
      this.logger.warn(
        `Marketing counter increment failed for campaign ${campaignId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async recordEvent(
    recipient: EmailCampaignRecipient,
    eventType: MarketingEventType,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.deps.events.create({
        campaign_id: recipient.campaign_id,
        campaign_recipient_id: recipient.id,
        event_type: eventType,
        occurred_at: new Date(),
        metadata,
      } as never);
    } catch (error) {
      this.logger.warn(
        `Marketing event write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Builds the redirect target: configured origin + constant path, plus the
   * allowlisted UTM parameters.
   *
   * Nothing from the request can change the origin or the path. The only
   * request-derived data that survives is a bounded set of `utm_*` values,
   * copied one by one (never spread), so an injected `?next=` or
   * `?redirect=` is simply dropped.
   */
  private buildRedirectUrl(query: URLSearchParams): string {
    const base = `${this.deps.appUrl().replace(/\/+$/, '')}${MARKETING_LANDING_PATH}`;
    const url = new URL(base);
    const utm = pickSafeUtmParameters(query, MARKETING_SAFE_UTM_PARAMETERS) as Record<
      string,
      string | undefined
    >;
    const defaults: MarketingUtmParameters = { utm_source: 'campaign-email', utm_medium: 'email' };
    for (const [key, value] of Object.entries({ ...defaults, ...utm })) {
      if (typeof value === 'string' && value !== '') {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  /**
   * The attribution cookie value: `campaignDigest.recipientDigest`.
   *
   * Truncated digests, not ids: the landing page only needs a stable opaque
   * key to correlate a later demo request with the click that produced the
   * visit, and an opaque value means a shared screenshot of a browser's
   * cookie jar reveals no internal identifier. The recipient half is bound
   * to the campaign id inside the digest, so a recipient digest cannot be
   * replayed against a different campaign's cookie.
   */
  private attributionValue(campaignId: string, recipientId: string): string {
    return `${marketingAttributionCampaignDigest(campaignId)}.${marketingAttributionRecipientDigest(
      campaignId,
      recipientId,
    )}`;
  }
}
