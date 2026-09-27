import { AllowNull, BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import {
  MarketingErrorCategory,
  MarketingRecipientSource,
  MarketingRecipientStatus,
} from '@school-bus-tracking/shared-types';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { EmailCampaign } from './marketing-campaign.model';

export interface EmailCampaignRecipientAttributes extends BaseModelAttributes {
  campaign_id: string;
  /** The school this address was snapshotted from (nullable: the row outlives the school). */
  school_id: string | null;
  /** Trimmed + lowercased address; the uniqueness key inside one campaign. */
  normalized_email: string;
  /** Display name for the greeting (`{{recipient_name}}`). */
  recipient_name: string | null;
  /** Where the address came from (admin account vs school primary email). */
  recipient_source: MarketingRecipientSource;
  status: MarketingRecipientStatus;
  /** Delivery attempts made so far (0 = never attempted). */
  attempts: number;
  /** When the worker may next try (exponential backoff), `NULL` when terminal. */
  next_attempt_at: Date | null;
  /**
   * Safe classification of the last failure — never the raw provider error,
   * which can echo credentials, hostnames or message content.
   */
  last_error_category: MarketingErrorCategory | null;
  /** When the provider accepted the message. */
  sent_at: Date | null;
  /** Provider-assigned message id, for cross-referencing bounces. */
  provider_message_id: string | null;
  /**
   * SHA-256 digest of the raw per-recipient click token. The plaintext only
   * ever exists inside the links of the sent email; it is never persisted,
   * logged or returned, so a database read cannot forge a click attribution.
   */
  click_token_hash: string | null;
  /** SHA-256 digest of the raw per-recipient unsubscribe token (same rules). */
  unsubscribe_token_hash: string | null;
}

export type EmailCampaignRecipientCreationAttributes = Optional<
  EmailCampaignRecipientAttributes,
  | BaseModelManagedFields
  | 'school_id'
  | 'recipient_name'
  | 'status'
  | 'attempts'
  | 'next_attempt_at'
  | 'last_error_category'
  | 'sent_at'
  | 'provider_message_id'
  | 'click_token_hash'
  | 'unsubscribe_token_hash'
>;

/**
 * One (campaign, address) pair — the immutable audience snapshot.
 *
 * Rows are materialized once, by the server, when a campaign is scheduled:
 * the audience filter is evaluated against schools/school-admins, deduplicated
 * by normalized address, checked against `marketing_suppressions` later at
 * send time (a suppression that arrives after the snapshot is still honoured),
 * and written here. From that moment the campaign's audience can never drift
 * — schools added afterwards are simply not in this campaign, which is the
 * audit-correct behaviour for a marketing send.
 *
 * ### Token security
 *
 * Personalized click and unsubscribe links carry a per-recipient random
 * token; only its SHA-256 digest is stored (the `password_reset_tokens`
 * construction). Both digests are **unique**, which is what makes resolving
 * a clicked link to exactly one row a database guarantee. The default scope
 * and `toJSON()` strip both digests so they cannot reach a response or a log
 * by accident.
 *
 * ### No soft delete
 *
 * The row is the delivery state machine; deleting it mid-campaign would
 * orphan events and break counters. Campaign teardown (hard delete after
 * retention) cascades.
 */
@Table({
  tableName: 'email_campaign_recipients',
  modelName: 'EmailCampaignRecipient',
  underscored: true,
  timestamps: true,
  deletedAt: false,
  paranoid: false,
  defaultScope: {
    attributes: { exclude: ['click_token_hash', 'unsubscribe_token_hash'] },
  },
  indexes: [
    // One row per address per campaign — the snapshot's dedup guarantee.
    {
      name: 'uq_email_campaign_recipients_campaign_email',
      unique: true,
      fields: ['campaign_id', 'normalized_email'],
    },
    // Clicked/unsubscribed link resolution: digest → exactly one row.
    {
      name: 'uq_email_campaign_recipients_click_token',
      unique: true,
      fields: ['click_token_hash'],
    },
    {
      name: 'uq_email_campaign_recipients_unsubscribe_token',
      unique: true,
      fields: ['unsubscribe_token_hash'],
    },
    // The worker's claim scan: due pending rows, soonest first.
    { name: 'idx_email_campaign_recipients_status_next', fields: ['status', 'next_attempt_at'] },
    // Per-campaign progress views and school drill-downs.
    { name: 'idx_email_campaign_recipients_campaign_status', fields: ['campaign_id', 'status'] },
    { name: 'idx_email_campaign_recipients_school', fields: ['school_id'] },
    // "Which campaigns reached this address?" — suppression research.
    { name: 'idx_email_campaign_recipients_email', fields: ['normalized_email'] },
  ],
})
export class EmailCampaignRecipient extends BaseModel<
  EmailCampaignRecipientAttributes,
  EmailCampaignRecipientCreationAttributes
> {
  @AllowNull(false)
  @ForeignKey(() => EmailCampaign)
  @Column({ type: DataType.UUID })
  declare campaign_id: string;

  @AllowNull(true)
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID })
  declare school_id: string | null;

  @AllowNull(false)
  @Column({ type: DataType.STRING(254) })
  declare normalized_email: string;

  @AllowNull(true)
  @Column({ type: DataType.STRING(150) })
  declare recipient_name: string | null;

  @AllowNull(false)
  @Column({ type: DataType.STRING(32) })
  declare recipient_source: MarketingRecipientSource;

  @AllowNull(false)
  @Column({
    type: DataType.STRING(16),
    defaultValue: MarketingRecipientStatus.PENDING,
  })
  declare status: MarketingRecipientStatus;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare attempts: number;

  @AllowNull(true)
  @Column({ type: DataType.DATE })
  declare next_attempt_at: Date | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(32) })
  declare last_error_category: MarketingErrorCategory | null;

  @AllowNull(true)
  @Column({ type: DataType.DATE })
  declare sent_at: Date | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(255) })
  declare provider_message_id: string | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(64) })
  declare click_token_hash: string | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(64) })
  declare unsubscribe_token_hash: string | null;

  @BelongsTo(() => EmailCampaign, { foreignKey: 'campaign_id', as: 'campaign' })
  declare campaign?: EmailCampaign;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  /**
   * Strips both digests even if a query opted out of the default scope, so
   * neither can reach a response body or a log line by accident.
   */
  override toJSON(): object {
    const values = { ...this.get() } as Record<string, unknown>;
    delete values.click_token_hash;
    delete values.unsubscribe_token_hash;
    return values;
  }
}
