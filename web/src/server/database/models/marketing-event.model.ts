import { AllowNull, BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { MarketingEventType } from '@school-bus-tracking/shared-types';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { EmailCampaign } from './marketing-campaign.model';
import { EmailCampaignRecipient } from './marketing-campaign-recipient.model';

export interface EmailEventAttributes extends BaseModelAttributes {
  campaign_id: string | null;
  campaign_recipient_id: string | null;
  event_type: MarketingEventType;
  /** When the event happened (provider-observed clock when available). */
  occurred_at: Date;
  /**
   * Safe, bounded context for analytics — e.g. which tracked link was
   * followed (path, not full URL with token) or the failure category. Never
   * a raw token, never an email body, never a recipient address (that lives
   * on the recipient row).
   */
  metadata: Record<string, unknown> | null;
}

export type EmailEventCreationAttributes = Omit<EmailEventAttributes, BaseModelManagedFields> &
  Partial<Pick<EmailEventAttributes, BaseModelManagedFields>>;

/**
 * Append-only analytics log for marketing email engagement
 * (`SENT`/`FAILED`/`CLICKED`/`UNSUBSCRIBED`/`BOUNCED`/`COMPLAINED`).
 *
 * The table is written by the delivery worker and the public click/unsubscribe
 * endpoints, and read by campaign analytics only — it is never updated and
 * never deleted from the application (retention cleanup may purge old rows,
 * like `audit_logs`).
 *
 * ### What deliberately never appears here
 *
 * - **Raw tokens** — a click/unsubscribe event is tied to its recipient row by
 *   id; the token itself is not stored anywhere in plaintext.
 * - **Email bodies / subjects** — content lives on the immutable template
 *   version the campaign pins.
 * - **Free-form provider errors** — failures carry a safe category, because
 *   SMTP transcripts can echo credentials and message content.
 */
@Table({
  tableName: 'email_events',
  modelName: 'EmailEvent',
  underscored: true,
  timestamps: true,
  updatedAt: false,
  deletedAt: false,
  paranoid: false,
  indexes: [
    // Campaign analytics: per-campaign event timelines and funnels.
    {
      name: 'idx_email_events_campaign_type_occurred',
      fields: ['campaign_id', 'event_type', 'occurred_at'],
    },
    // Recipient timeline: "what happened to this send?"
    {
      name: 'idx_email_events_recipient_occurred',
      fields: ['campaign_recipient_id', 'occurred_at'],
    },
    // Platform-wide aggregates over time (e.g. unsubscribe rate trend).
    { name: 'idx_email_events_type_occurred', fields: ['event_type', 'occurred_at'] },
  ],
})
export class EmailEvent extends BaseModel<EmailEventAttributes, EmailEventCreationAttributes> {
  @AllowNull(true)
  @ForeignKey(() => EmailCampaign)
  @Column({ type: DataType.UUID })
  declare campaign_id: string | null;

  @AllowNull(true)
  @ForeignKey(() => EmailCampaignRecipient)
  @Column({ type: DataType.UUID })
  declare campaign_recipient_id: string | null;

  @AllowNull(false)
  @Column({ type: DataType.STRING(32) })
  declare event_type: MarketingEventType;

  @AllowNull(false)
  @Column({ type: DataType.DATE })
  declare occurred_at: Date;

  @AllowNull(true)
  @Column({ type: DataType.JSONB })
  declare metadata: Record<string, unknown> | null;

  @BelongsTo(() => EmailCampaign, { foreignKey: 'campaign_id', as: 'campaign' })
  declare campaign?: EmailCampaign;

  @BelongsTo(() => EmailCampaignRecipient, {
    foreignKey: 'campaign_recipient_id',
    as: 'recipient',
  })
  declare recipient?: EmailCampaignRecipient;
}
