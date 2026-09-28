import {
  AllowNull,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Table,
} from 'sequelize-typescript';
import type {
  MarketingLeadConsentSource,
  MarketingUtmParameters,
} from '@school-bus-tracking/shared-types';
import { MarketingLeadSource, MarketingLeadStatus } from '@school-bus-tracking/shared-types';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { EmailCampaign } from './marketing-campaign.model';
import { EmailCampaignRecipient } from './marketing-campaign-recipient.model';
import { MarketingLeadEvent } from './marketing-lead-event.model';

export interface MarketingLeadAttributes extends BaseModelAttributes {
  /** Contact person's name as submitted. */
  full_name: string;
  /** Trimmed + lowercased contact address (NOT deduplicated: the same person
   *  may legitimately submit more than one request; duplicates are merged by
   *  the service layer, not by a unique constraint). */
  normalized_email: string;
  /** School / institution the request is about. */
  institution_name: string | null;
  phone: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string | null;
  /** Free-text request details entered on the form. */
  message: string | null;
  /** When the person asked to be contacted ("weekday mornings"). */
  preferred_contact_time: string | null;
  status: MarketingLeadStatus;
  source: MarketingLeadSource;
  /** UTM attribution echoed from the landing page URL. */
  utm: MarketingUtmParameters | null;
  /** Campaign that produced the lead, when it came from an email reply. */
  campaign_id: string | null;
  /** The specific snapshotted recipient whose email produced the lead. */
  campaign_recipient_id: string | null;
  /**
   * When the data subject consented to be contacted. Always set by the
   * server at capture time (`now()` for public submissions) — a lead without
   * a consent record is a lead the system must not keep.
   */
  consent_at: Date;
  /** Which channel the consent came through (`public-form` / `manual`). */
  consent_source: MarketingLeadConsentSource;
  /**
   * When the new-lead notification to `MARKETING_ADMIN_EMAILS` succeeded.
   * Null while pending or after a failure — the lead itself is unaffected
   * either way (the outcome is also an event on the timeline).
   */
  admin_notified_at: Date | null;
  /**
   * SHA-256 digest of the normalized submission content, used to answer a
   * duplicate public submission idempotently. Never derived from an IP or a
   * token — only from data the row already stores.
   */
  submission_fingerprint: string | null;
}

export type MarketingLeadCreationAttributes = Optional<
  MarketingLeadAttributes,
  | BaseModelManagedFields
  | 'institution_name'
  | 'phone'
  | 'city'
  | 'country'
  | 'message'
  | 'preferred_contact_time'
  | 'status'
  | 'source'
  | 'utm'
  | 'campaign_id'
  | 'campaign_recipient_id'
  | 'consent_source'
  | 'admin_notified_at'
  | 'submission_fingerprint'
>;

/**
 * One sales lead captured by the marketing system.
 *
 * Leads arrive from three places: the **public landing page** demo-request
 * form (Phase 4 — unauthenticated, strictly validated, rate limited),
 * **replies to campaign emails** (attributed via `campaign_id` /
 * `campaign_recipient_id`), and **manual entry** by a Super Admin. Every
 * lifecycle change appends a {@link MarketingLeadEvent}; the lead row itself
 * only ever moves forward through `status`.
 *
 * ### Why the attribution FKs are `SET NULL`
 *
 * A lead is a *sales record*; the campaign that produced it is *context*. If
 * campaign data is ever purged (retention, right-to-erasure of a school's
 * address), the lead — and its consent record — must survive with the
 * attribution simply gone.
 *
 * ### Privacy
 *
 * This is personal data volunteered for a sales conversation. `consent_at`
 * is non-nullable proof of permission; the soft delete (`deleted_at`) hides
 * a lead from the console without destroying the consent evidence, and a
 * right-to-erasure request is a hard delete plus lead-event cleanup.
 */
@Table({
  tableName: 'marketing_leads',
  modelName: 'MarketingLead',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // Console pipeline: leads by status, newest first.
    { name: 'idx_marketing_leads_status_created', fields: ['status', 'created_at'] },
    // "Has this person contacted us before?" during intake.
    { name: 'idx_marketing_leads_email', fields: ['normalized_email'] },
    // Campaign attribution drill-down.
    { name: 'idx_marketing_leads_campaign', fields: ['campaign_id'] },
    { name: 'idx_marketing_leads_source_created', fields: ['source', 'created_at'] },
    // Idempotent public capture: "same content, recently?" in one lookup.
    {
      name: 'idx_marketing_leads_fingerprint_created',
      fields: ['submission_fingerprint', 'created_at'],
    },
  ],
})
export class MarketingLead extends BaseModel<
  MarketingLeadAttributes,
  MarketingLeadCreationAttributes
> {
  @AllowNull(false)
  @Column({ type: DataType.STRING(120) })
  declare full_name: string;

  @AllowNull(false)
  @Column({ type: DataType.STRING(254) })
  declare normalized_email: string;

  @AllowNull(true)
  @Column({ type: DataType.STRING(200) })
  declare institution_name: string | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(32) })
  declare phone: string | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(100) })
  declare city: string | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(2) })
  declare country: string | null;

  @AllowNull(true)
  @Column({ type: DataType.TEXT })
  declare message: string | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(100) })
  declare preferred_contact_time: string | null;

  @AllowNull(false)
  @Column({
    type: DataType.STRING(16),
    defaultValue: MarketingLeadStatus.NEW,
  })
  declare status: MarketingLeadStatus;

  @AllowNull(false)
  @Column({
    type: DataType.STRING(32),
    defaultValue: MarketingLeadSource.LANDING_PAGE,
  })
  declare source: MarketingLeadSource;

  @AllowNull(true)
  @Column({ type: DataType.JSONB })
  declare utm: MarketingUtmParameters | null;

  @AllowNull(true)
  @ForeignKey(() => EmailCampaign)
  @Column({ type: DataType.UUID })
  declare campaign_id: string | null;

  @AllowNull(true)
  @ForeignKey(() => EmailCampaignRecipient)
  @Column({ type: DataType.UUID })
  declare campaign_recipient_id: string | null;

  @AllowNull(false)
  @Column({ type: DataType.DATE })
  declare consent_at: Date;

  @AllowNull(false)
  @Column({ type: DataType.STRING(32), defaultValue: 'public-form' })
  declare consent_source: MarketingLeadConsentSource;

  @AllowNull(true)
  @Column({ type: DataType.DATE })
  declare admin_notified_at: Date | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(64) })
  declare submission_fingerprint: string | null;

  @BelongsTo(() => EmailCampaign, { foreignKey: 'campaign_id', as: 'campaign' })
  declare campaign?: EmailCampaign;

  @BelongsTo(() => EmailCampaignRecipient, {
    foreignKey: 'campaign_recipient_id',
    as: 'campaignRecipient',
  })
  declare campaignRecipient?: EmailCampaignRecipient;

  @HasMany(() => MarketingLeadEvent, { foreignKey: 'lead_id', as: 'events' })
  declare events?: MarketingLeadEvent[];
}
