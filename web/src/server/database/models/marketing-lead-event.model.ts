import { AllowNull, BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { MarketingLeadEventType } from '@school-bus-tracking/shared-types';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { MarketingLead } from './marketing-lead.model';

export interface MarketingLeadEventAttributes extends BaseModelAttributes {
  lead_id: string;
  event_type: MarketingLeadEventType;
  /**
   * Short, safe label for who caused the event: `system` (automatic capture),
   * `public-form` (the unauthenticated landing page submission) or
   * `super-admin` (console action). Never an email address, never a raw
   * token — the same "safe actor" rule `audit_logs` follows.
   */
  actor: string;
  /** Bounded, non-sensitive context (e.g. `from`/`to` statuses). */
  metadata: Record<string, unknown> | null;
}

export type MarketingLeadEventCreationAttributes = Omit<
  MarketingLeadEventAttributes,
  BaseModelManagedFields
> &
  Partial<Pick<MarketingLeadEventAttributes, BaseModelManagedFields>>;

/**
 * Append-only lifecycle trail for a marketing lead.
 *
 * Written in the same transaction as every lead mutation, so a lead's story
 * ("captured from the landing page with UTM X, contacted by a Super Admin,
 * qualified") is reconstructible from the database alone. Never updated,
 * never deleted from the application (retention may purge old rows).
 */
@Table({
  tableName: 'marketing_lead_events',
  modelName: 'MarketingLeadEvent',
  underscored: true,
  timestamps: true,
  updatedAt: false,
  deletedAt: false,
  paranoid: false,
  indexes: [
    // Lead timeline: events for one lead, in order.
    { name: 'idx_marketing_lead_events_lead_created', fields: ['lead_id', 'created_at'] },
    // Aggregate views (e.g. contact volume by source over time).
    { name: 'idx_marketing_lead_events_type_created', fields: ['event_type', 'created_at'] },
  ],
})
export class MarketingLeadEvent extends BaseModel<
  MarketingLeadEventAttributes,
  MarketingLeadEventCreationAttributes
> {
  @AllowNull(false)
  @ForeignKey(() => MarketingLead)
  @Column({ type: DataType.UUID })
  declare lead_id: string;

  @AllowNull(false)
  @Column({ type: DataType.STRING(32) })
  declare event_type: MarketingLeadEventType;

  @AllowNull(false)
  @Column({ type: DataType.STRING(120) })
  declare actor: string;

  @AllowNull(true)
  @Column({ type: DataType.JSONB })
  declare metadata: Record<string, unknown> | null;

  @BelongsTo(() => MarketingLead, { foreignKey: 'lead_id', as: 'lead' })
  declare lead?: MarketingLead;
}
