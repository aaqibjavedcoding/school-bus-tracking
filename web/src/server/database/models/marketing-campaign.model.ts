import {
  AllowNull,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Table,
} from 'sequelize-typescript';
import type { MarketingCampaignAudienceFilter } from '@school-bus-tracking/shared-types';
import { MarketingCampaignStatus } from '@school-bus-tracking/shared-types';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { User } from './user.model';
import { EmailTemplate } from './marketing-template.model';
import { EmailTemplateVersion } from './marketing-template-version.model';
import { EmailCampaignRecipient } from './marketing-campaign-recipient.model';

export interface EmailCampaignAttributes extends BaseModelAttributes {
  name: string;
  /** The template this campaign sends. */
  template_id: string;
  /**
   * The exact immutable version whose subject/bodies are rendered — pinned at
   * scheduling time and never rewritten afterwards.
   */
  template_version_id: string;
  status: MarketingCampaignStatus;
  /**
   * The audience *question* (see `MarketingCampaignAudienceFilter`). Bounded
   * by validation; never contains email addresses — those live only in the
   * recipient snapshot.
   */
  audience_filter: MarketingCampaignAudienceFilter;
  /**
   * SHA-256 of the canonicalized recipient snapshot, written when the
   * campaign is scheduled. Lets an operator verify after the fact that two
   * "identical" campaigns really targeted the same audience, without keeping
   * a second copy of the address list.
   */
  audience_snapshot_hash: string | null;
  /** When the worker may start delivering (set at scheduling time). */
  scheduled_at: Date | null;
  /** When the first recipient attempt actually happened. */
  started_at: Date | null;
  /** When every snapshotted recipient reached a terminal status. */
  completed_at: Date | null;
  // ---- aggregate counters (maintained by the worker, denormalized for the
  // console's list view so it never counts the recipient table per row) ----
  /** Rows in the recipient snapshot. */
  recipient_count: number;
  /** Snapshotted rows still waiting for their first claim. */
  queued_count: number;
  /** Rows claimed by a worker under a live lease. */
  processing_count: number;
  /** Provider-accepted sends. */
  sent_count: number;
  /** Rows waiting out a transient-failure backoff. */
  retrying_count: number;
  /** Terminal failures (incl. attempts exhausted). */
  failed_count: number;
  /** Rows skipped because the address was suppressed at send time. */
  suppressed_count: number;
  /** Rows skipped for another safe reason. */
  skipped_count: number;
  /** Rows abandoned because the campaign was cancelled. */
  cancelled_count: number;
  /** Rows abandoned because the delivery window closed. */
  expired_count: number;
  /** Recipients who followed at least one tracked link (unique clicks). */
  clicked_count: number;
  /** Every tracked click, including repeats by the same recipient. */
  total_click_count: number;
  /** Recipients who unsubscribed from this campaign. */
  unsubscribed_count: number;
  /** SUPER_ADMIN who created the campaign (nullable: history survives account removal). */
  created_by: string | null;
}

export type EmailCampaignCreationAttributes = Optional<
  EmailCampaignAttributes,
  | BaseModelManagedFields
  | 'status'
  | 'audience_snapshot_hash'
  | 'scheduled_at'
  | 'started_at'
  | 'completed_at'
  | 'recipient_count'
  | 'queued_count'
  | 'processing_count'
  | 'sent_count'
  | 'retrying_count'
  | 'failed_count'
  | 'suppressed_count'
  | 'skipped_count'
  | 'cancelled_count'
  | 'expired_count'
  | 'clicked_count'
  | 'total_click_count'
  | 'unsubscribed_count'
  | 'created_by'
>;

/**
 * One marketing email campaign.
 *
 * The campaign row is the coordination point between three frozen facts:
 *
 * 1. **Content** — `template_version_id` pins an immutable
 *    {@link EmailTemplateVersion}, so what was sent can never change
 *    retroactively.
 * 2. **Audience** — `audience_filter` is the human question ("active schools
 *    in India on a trial"); the answer is materialized once, at scheduling
 *    time, into {@link EmailCampaignRecipient} rows, and summarized by
 *    `audience_snapshot_hash`.
 * 3. **Progress** — aggregate counters plus the per-recipient rows the
 *    background worker walks.
 *
 * Delivery is **never** performed inside an HTTP request: the API only moves
 * the campaign between lifecycle states; the worker (Phase 3) claims due
 * campaigns and their pending recipients. This table is platform-level
 * (SUPER_ADMIN only) and carries no `school_id` — the audience is the
 * `school_id` on each recipient row.
 */
@Table({
  tableName: 'email_campaigns',
  modelName: 'EmailCampaign',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // The scheduler's due-campaign scan: due rows by status, soonest first.
    { name: 'idx_email_campaigns_status_scheduled', fields: ['status', 'scheduled_at'] },
    // Console list view: campaigns newest first, optionally filtered by status.
    { name: 'idx_email_campaigns_status_created', fields: ['status', 'created_at'] },
    // Template usage ("which campaigns used this template?").
    { name: 'idx_email_campaigns_template', fields: ['template_id'] },
  ],
})
export class EmailCampaign extends BaseModel<
  EmailCampaignAttributes,
  EmailCampaignCreationAttributes
> {
  @AllowNull(false)
  @Column({ type: DataType.STRING(150) })
  declare name: string;

  @AllowNull(false)
  @ForeignKey(() => EmailTemplate)
  @Column({ type: DataType.UUID })
  declare template_id: string;

  @AllowNull(false)
  @ForeignKey(() => EmailTemplateVersion)
  @Column({ type: DataType.UUID })
  declare template_version_id: string;

  @AllowNull(false)
  @Column({
    type: DataType.STRING(16),
    defaultValue: MarketingCampaignStatus.DRAFT,
  })
  declare status: MarketingCampaignStatus;

  @AllowNull(false)
  @Column({ type: DataType.JSONB })
  declare audience_filter: MarketingCampaignAudienceFilter;

  @AllowNull(true)
  @Column({ type: DataType.STRING(64) })
  declare audience_snapshot_hash: string | null;

  @AllowNull(true)
  @Column({ type: DataType.DATE })
  declare scheduled_at: Date | null;

  @AllowNull(true)
  @Column({ type: DataType.DATE })
  declare started_at: Date | null;

  @AllowNull(true)
  @Column({ type: DataType.DATE })
  declare completed_at: Date | null;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare recipient_count: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare queued_count: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare processing_count: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare sent_count: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare retrying_count: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare failed_count: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare suppressed_count: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare skipped_count: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare cancelled_count: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare expired_count: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare clicked_count: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare total_click_count: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare unsubscribed_count: number;

  @AllowNull(true)
  @ForeignKey(() => User)
  @Column({ type: DataType.UUID })
  declare created_by: string | null;

  @BelongsTo(() => EmailTemplate, { foreignKey: 'template_id', as: 'template' })
  declare template?: EmailTemplate;

  @BelongsTo(() => EmailTemplateVersion, {
    foreignKey: 'template_version_id',
    as: 'templateVersion',
  })
  declare templateVersion?: EmailTemplateVersion;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'creator', constraints: false })
  declare creator?: User;

  @HasMany(() => EmailCampaignRecipient, { foreignKey: 'campaign_id', as: 'recipients' })
  declare recipients?: EmailCampaignRecipient[];
}
