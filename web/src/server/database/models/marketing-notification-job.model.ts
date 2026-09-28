import { AllowNull, BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import {
  MarketingErrorCategory,
  MarketingNotificationJobStatus,
  MarketingNotificationJobType,
} from '@school-bus-tracking/shared-types';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { MarketingLead } from './marketing-lead.model';

export interface MarketingNotificationJobAttributes extends BaseModelAttributes {
  job_type: MarketingNotificationJobType;
  /** The lead this notification is about (cascades with the lead). */
  lead_id: string | null;
  status: MarketingNotificationJobStatus;
  attempts: number;
  /** Backoff deadline; the claim query never picks a row before it. */
  next_attempt_at: Date;
  /** Worker instance holding the claim — a label, never a secret. */
  locked_by: string | null;
  /** Claim deadline; an expired lease makes a `PROCESSING` row claimable. */
  lease_expires_at: Date | null;
  /** Safe failure class only — never a provider transcript. */
  last_error_category: MarketingErrorCategory | null;
  provider_message_id: string | null;
  sent_at: Date | null;
}

export type MarketingNotificationJobCreationAttributes = Optional<
  MarketingNotificationJobAttributes,
  | BaseModelManagedFields
  | 'lead_id'
  | 'status'
  | 'attempts'
  | 'next_attempt_at'
  | 'locked_by'
  | 'lease_expires_at'
  | 'last_error_category'
  | 'provider_message_id'
  | 'sent_at'
>;

/**
 * One durable operational notification owed to `MARKETING_ADMIN_EMAILS`.
 *
 * This table exists so the public demo-request endpoint can answer as soon as
 * the lead is safely stored: the lead row and its job row are written in one
 * transaction, and the SMTP conversation happens later, in the worker. A
 * process restart, a dead relay or a killed container can therefore delay a
 * notification but never lose one — and never lose or roll back the lead.
 *
 * It is deliberately **not** `email_campaign_recipients`:
 *
 * - campaign rows are the audit record of who was mailed a campaign, and
 *   reusing them for operational mail would corrupt campaign counters and
 *   analytics;
 * - the two rails have different caps, different recipients and different
 *   consent bases. Keeping them apart is what guarantees a notification can
 *   never be sent to a campaign address, and vice versa.
 *
 * Recipients are never stored here: they are read from
 * `MARKETING_ADMIN_EMAILS` at send time, so the browser (and anything a
 * visitor submitted) can never influence where a notification goes.
 */
@Table({
  tableName: 'marketing_notification_jobs',
  modelName: 'MarketingNotificationJob',
  underscored: true,
  timestamps: true,
  paranoid: false,
  indexes: [
    { name: 'idx_marketing_notification_jobs_claim', fields: ['status', 'next_attempt_at'] },
    { name: 'idx_marketing_notification_jobs_lease', fields: ['status', 'lease_expires_at'] },
  ],
})
export class MarketingNotificationJob extends BaseModel<
  MarketingNotificationJobAttributes,
  MarketingNotificationJobCreationAttributes
> {
  @AllowNull(false)
  @Column({ type: DataType.STRING(48) })
  declare job_type: MarketingNotificationJobType;

  @AllowNull(true)
  @ForeignKey(() => MarketingLead)
  @Column({ type: DataType.UUID })
  declare lead_id: string | null;

  @AllowNull(false)
  @Column({
    type: DataType.STRING(16),
    defaultValue: MarketingNotificationJobStatus.PENDING,
  })
  declare status: MarketingNotificationJobStatus;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare attempts: number;

  @AllowNull(false)
  @Column({ type: DataType.DATE })
  declare next_attempt_at: Date;

  @AllowNull(true)
  @Column({ type: DataType.STRING(64) })
  declare locked_by: string | null;

  @AllowNull(true)
  @Column({ type: DataType.DATE })
  declare lease_expires_at: Date | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(32) })
  declare last_error_category: MarketingErrorCategory | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(255) })
  declare provider_message_id: string | null;

  @AllowNull(true)
  @Column({ type: DataType.DATE })
  declare sent_at: Date | null;

  @BelongsTo(() => MarketingLead, { foreignKey: 'lead_id', as: 'lead' })
  declare lead?: MarketingLead;
}
