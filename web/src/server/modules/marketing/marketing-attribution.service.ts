/**
 * Campaign attribution for demo leads — signed cookie in, indexed lookup out.
 *
 * ### Why this replaced the Session 4 resolver
 *
 * The first implementation recomputed digests over "recent" campaigns and
 * then over every clicked recipient of the matched campaign. That is a scan
 * of hundreds of campaigns and thousands of recipient rows **on every public
 * form submission** — an unauthenticated endpoint, i.e. exactly the place
 * where an O(n) path becomes a denial-of-service lever. Resolution is now:
 *
 * ```text
 * cookie → format check → HMAC check → expiry check
 *        → SHA-256(nonce) → ONE unique-index probe on marketing_attributions
 *        → binding re-check against the stored campaign/recipient
 * ```
 *
 * No `findAll`, no in-memory comparison loop, and the cost is independent of
 * how many campaigns and recipients exist.
 *
 * ### The security properties, and why each mechanism is here
 *
 * - **A random nonce, stored only as a digest.** The cookie carries 32 bytes
 *   of `randomBytes`; the database keeps `sha256(nonce)`. A database leak
 *   therefore yields no usable cookie — the same construction as the click
 *   and unsubscribe tokens.
 * - **An HMAC signature** (`MARKETING_ATTRIBUTION_SECRET`) over
 *   `version.nonce.expiry`. Without it a visitor could hammer the endpoint
 *   with random nonces and turn every submission into a database probe; with
 *   it, a forged cookie is rejected before any query runs. Compared with
 *   `timingSafeEqual`.
 * - **An expiry inside the signed material**, re-checked against the stored
 *   row. A cookie cannot be extended by editing it, and a stale grant cannot
 *   be resurrected.
 * - **Binding re-validation.** The stored row names the campaign *and* the
 *   recipient, and the recipient is re-checked to actually belong to that
 *   campaign before anything is returned. A row whose binding does not hold
 *   attributes to nothing.
 * - **Bounded reuse.** `use_count` is incremented on every resolution and a
 *   grant stops resolving past {@link MARKETING_ATTRIBUTION_MAX_USES}, so a
 *   stolen cookie cannot be replayed indefinitely.
 * - **No address anywhere.** Neither the URL nor the cookie contains an email
 *   address; the cookie is opaque even to the browser that holds it.
 * - **Nothing raw is ever logged.** Not the cookie, not the nonce, not the
 *   signature — failures log a reason word, never the value.
 *
 * ### Honest limitation (unchanged, and deliberately preserved)
 *
 * Attribution identifies the **original recipient address** of the campaign
 * email. If that email was forwarded, the attribution still names the
 * original recipient; it does not prove which human clicked. The address the
 * visitor types into the form is the reliable identity of the submitter.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { MarketingCampaignStatus } from '@school-bus-tracking/shared-types';
import { Logger } from '../../framework';
import type {
  EmailCampaign,
  EmailCampaignRecipient,
  MarketingAttribution,
} from '../../database/models';

/** Current signed cookie version tag. */
export const MARKETING_ATTRIBUTION_COOKIE_VERSION = 'v2';

/** Attribution cookie lifetime: 30 days, the usual marketing window. */
export const MARKETING_ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How often one grant may resolve before it is treated as replay. A person
 * filling in the form twice is normal; a cookie presented dozens of times is
 * not, and each click mints a fresh grant anyway.
 */
export const MARKETING_ATTRIBUTION_MAX_USES = 5;

/** `v2.<nonce>.<expiryMs>.<signature>` — all URL-safe, bounded lengths. */
export const MARKETING_SIGNED_ATTRIBUTION_PATTERN =
  /^v2\.([A-Za-z0-9_-]{43})\.(\d{10,16})\.([a-f0-9]{32})$/;

/** Legacy (Session 3/4) cookie: `campaignDigest[.recipientDigest]`. */
export const MARKETING_LEGACY_ATTRIBUTION_PATTERN = /^[a-f0-9]{32}(\.[a-f0-9]{32})?$/;

/** A resolved (and therefore valid) attribution. */
export interface MarketingResolvedAttribution {
  campaign_id: string;
  campaign_recipient_id: string | null;
}

export interface MarketingAttributionServiceDeps {
  attributions: typeof MarketingAttribution;
  campaigns: typeof EmailCampaign;
  recipients: typeof EmailCampaignRecipient;
  /** Read at call time: rotating the secret needs no restart. */
  secret: () => string;
  ttlMs?: number;
  now?: () => Date;
  /** Injected in tests for deterministic nonces. */
  randomNonce?: () => string;
}

/** SHA-256 hex digest — the stored form of a nonce. */
export function hashAttributionNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

export class MarketingAttributionService {
  private readonly logger = new Logger(MarketingAttributionService.name);
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly randomNonce: () => string;

  constructor(private readonly deps: MarketingAttributionServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.ttlMs = deps.ttlMs ?? MARKETING_ATTRIBUTION_TTL_MS;
    this.randomNonce = deps.randomNonce ?? (() => randomBytes(32).toString('base64url'));
  }

  /** True when a signing secret is configured (otherwise: legacy cookies). */
  isSigningEnabled(): boolean {
    return this.deps.secret().length >= 16;
  }

  /**
   * Mints one attribution grant for a valid tracked click and returns the
   * cookie value, or `null` when signing is not configured (the caller then
   * falls back to the legacy opaque digest cookie).
   *
   * The row is written **before** the cookie is handed out: a cookie whose
   * grant does not exist would silently resolve to nothing.
   */
  async issue(campaignId: string, recipientId: string): Promise<string | null> {
    if (!this.isSigningEnabled()) {
      return null;
    }
    try {
      const nonce = this.randomNonce();
      const issuedAt = this.now();
      const expiresAt = new Date(issuedAt.getTime() + this.ttlMs);
      await this.deps.attributions.create({
        nonce_digest: hashAttributionNonce(nonce),
        campaign_id: campaignId,
        campaign_recipient_id: recipientId,
        issued_at: issuedAt,
        expires_at: expiresAt,
        use_count: 0,
      } as never);
      return this.sign(nonce, expiresAt.getTime());
    } catch (error) {
      // Attribution is nice-to-have; a failure here must never break the
      // redirect a recipient is waiting on.
      this.logger.warn(
        `Attribution grant could not be issued for campaign ${campaignId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  /**
   * Resolves a cookie value to its campaign/recipient, or `null`.
   *
   * Every rejection path returns the same `null`: a caller (and therefore a
   * visitor) cannot distinguish "forged" from "expired" from "absent".
   */
  async resolve(rawValue: string | undefined): Promise<MarketingResolvedAttribution | null> {
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (value === '' || value.length > 512) {
      return null;
    }
    if (MARKETING_SIGNED_ATTRIBUTION_PATTERN.test(value)) {
      return this.resolveSigned(value);
    }
    if (MARKETING_LEGACY_ATTRIBUTION_PATTERN.test(value)) {
      return this.resolveLegacy(value);
    }
    return null;
  }

  // ------------------------------------------------------------- signed v2

  private async resolveSigned(value: string): Promise<MarketingResolvedAttribution | null> {
    const match = MARKETING_SIGNED_ATTRIBUTION_PATTERN.exec(value);
    if (!match) {
      return null;
    }
    const [, nonce, expiryRaw, signature] = match;
    if (!this.isSigningEnabled()) {
      // A signed cookie cannot be trusted without the key that signed it.
      return null;
    }

    const expiresAtMs = Number(expiryRaw);
    if (!Number.isFinite(expiresAtMs)) {
      return null;
    }
    const nowMs = this.now().getTime();
    if (expiresAtMs <= nowMs || expiresAtMs > nowMs + this.ttlMs * 2) {
      // Expired, or an absurd far-future expiry that a forger picked.
      return null;
    }
    if (!this.verify(nonce, expiresAtMs, signature)) {
      this.logger.debug('Attribution cookie rejected: signature mismatch.');
      return null;
    }

    // One indexed probe. Never a scan, regardless of dataset size.
    const grant = await this.deps.attributions.findOne({
      where: { nonce_digest: hashAttributionNonce(nonce) } as never,
    });
    if (!grant) {
      return null;
    }
    const grantExpiry =
      grant.expires_at instanceof Date ? grant.expires_at : new Date(grant.expires_at);
    if (grantExpiry.getTime() <= nowMs) {
      return null;
    }
    if ((grant.use_count ?? 0) >= MARKETING_ATTRIBUTION_MAX_USES) {
      this.logger.warn('Attribution cookie rejected: reuse limit reached.');
      return null;
    }

    const binding = await this.validateBinding(grant.campaign_id, grant.campaign_recipient_id);
    if (!binding) {
      return null;
    }

    await this.recordUse(grant.id);
    return binding;
  }

  /** `v2.<nonce>.<expiry>` is the signed material; the tag is truncated HMAC. */
  private sign(nonce: string, expiresAtMs: number): string {
    const signature = this.signature(nonce, expiresAtMs);
    return `${MARKETING_ATTRIBUTION_COOKIE_VERSION}.${nonce}.${expiresAtMs}.${signature}`;
  }

  private signature(nonce: string, expiresAtMs: number): string {
    return createHmac('sha256', this.deps.secret())
      .update(`${MARKETING_ATTRIBUTION_COOKIE_VERSION}.${nonce}.${expiresAtMs}`)
      .digest('hex')
      .slice(0, 32);
  }

  private verify(nonce: string, expiresAtMs: number, presented: string): boolean {
    const expected = Buffer.from(this.signature(nonce, expiresAtMs), 'utf8');
    const actual = Buffer.from(presented, 'utf8');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** Bounded, non-blocking replay accounting. */
  private async recordUse(grantId: string): Promise<void> {
    try {
      await this.deps.attributions.increment('use_count' as never, {
        where: { id: grantId } as never,
      });
      await this.deps.attributions.update(
        { consumed_at: this.now() } as never,
        { where: { id: grantId, consumed_at: null } as never },
      );
    } catch (error) {
      this.logger.warn(
        `Attribution use could not be recorded: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  // ------------------------------------------------------------- legacy v1

  /**
   * Resolves a cookie minted before this session — still by index.
   *
   * Both halves are matched against the database-generated
   * `attribution_digest` columns, so an old cookie in a real inbox keeps
   * working without reintroducing the scan it used to require.
   */
  private async resolveLegacy(value: string): Promise<MarketingResolvedAttribution | null> {
    const [campaignDigest, recipientDigest] = value.split('.');
    const campaign = await this.deps.campaigns.findOne({
      where: { attribution_digest: campaignDigest } as never,
    });
    if (!campaign || campaign.status === MarketingCampaignStatus.CANCELLED) {
      return null;
    }
    if (!recipientDigest) {
      return { campaign_id: campaign.id, campaign_recipient_id: null };
    }
    const recipient = await this.deps.recipients.findOne({
      where: {
        attribution_digest: recipientDigest,
        campaign_id: campaign.id,
      } as never,
    });
    return {
      campaign_id: campaign.id,
      // A recipient digest that does not belong to this campaign resolves to
      // campaign-only attribution — never to another campaign's recipient.
      campaign_recipient_id: recipient?.id ?? null,
    };
  }

  // --------------------------------------------------------------- helpers

  /**
   * Re-checks the stored binding: the campaign must still be live and the
   * recipient must still belong to it.
   */
  private async validateBinding(
    campaignId: string,
    recipientId: string,
  ): Promise<MarketingResolvedAttribution | null> {
    const campaign = await this.deps.campaigns.findOne({ where: { id: campaignId } });
    if (!campaign || campaign.status === MarketingCampaignStatus.CANCELLED) {
      return null;
    }
    const recipient = await this.deps.recipients.findOne({
      where: { id: recipientId, campaign_id: campaignId } as never,
    });
    if (!recipient) {
      // The grant names a recipient that is not (or no longer) part of this
      // campaign: attribute to the campaign only.
      return { campaign_id: campaign.id, campaign_recipient_id: null };
    }
    return { campaign_id: campaign.id, campaign_recipient_id: recipient.id };
  }
}
