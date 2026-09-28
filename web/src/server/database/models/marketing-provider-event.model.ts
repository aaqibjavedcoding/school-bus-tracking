import { AllowNull, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import type { MarketingProviderEventType } from '@school-bus-tracking/shared-types';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { EmailCampaign } from './marketing-campaign.model';
import { EmailCampaignRecipient } from './marketing-campaign-recipient.model';

export interface MarketingProviderEventAttributes extends BaseModelAttributes {
  /** Which event source produced it (`smtp-webhook`, a future provider, …). */
  provider: string;
  /** The provider's own event id — the idempotency key. */
  provider_event_id: string;
  event_type: MarketingProviderEventType;
  /** Correlation handle written by the delivery worker on a successful send. */
  provider_message_id: string | null;
  campaign_id: string | null;
  campaign_recipient_id: string | null;
  /** SHA-256 of the normalized address. Never the address itself. */
  email_digest: string | null;
  occurred_at: Date;
  received_at: Date;
  /** Bounded, allowlisted fields only — never the raw provider payload. */
  metadata: Record<string, unknown> | null;
}

export type MarketingProviderEventCreationAttributes = Optional<
  MarketingProviderEventAttributes,
  | BaseModelManagedFields
  | 'provider_message_id'
  | 'campaign_id'
  | 'campaign_recipient_id'
  | 'email_digest'
  | 'occurred_at'
  | 'received_at'
  | 'metadata'
>;

/**
 * One normalized provider feedback event (delivery receipt, bounce,
 * complaint) received through the signed webhook.
 *
 * Honest scope note: plain Gmail SMTP does **not** call this endpoint. Only
 * an immediate SMTP rejection is visible to this system today (the delivery
 * worker classifies it). This table is the provider-neutral landing zone for
 * the day a real event source is configured — and the record the manual
 * suppression console reads alongside.
 *
 * Storage rules, enforced by the service that writes here:
 *
 * - `(provider, provider_event_id)` is unique, so a replayed webhook call is
 *   a no-op instead of a second suppression;
 * - the address is stored as a digest only;
 * - `metadata` holds a bounded allowlist (event type, bounce class, an
 *   optional short status code) — never the raw payload, which can carry the
 *   full message, headers, or the provider's credentials in a URL.
 */
@Table({
  tableName: 'marketing_provider_events',
  modelName: 'MarketingProviderEvent',
  underscored: true,
  timestamps: true,
  paranoid: false,
  indexes: [
    {
      name: 'uq_marketing_provider_events_provider_event',
      unique: true,
      fields: ['provider', 'provider_event_id'],
    },
    { name: 'idx_marketing_provider_events_message', fields: ['provider_message_id'] },
    { name: 'idx_marketing_provider_events_received', fields: ['received_at'] },
  ],
})
export class MarketingProviderEvent extends BaseModel<
  MarketingProviderEventAttributes,
  MarketingProviderEventCreationAttributes
> {
  @AllowNull(false)
  @Column({ type: DataType.STRING(40) })
  declare provider: string;

  @AllowNull(false)
  @Column({ type: DataType.STRING(190) })
  declare provider_event_id: string;

  @AllowNull(false)
  @Column({ type: DataType.STRING(32) })
  declare event_type: MarketingProviderEventType;

  @AllowNull(true)
  @Column({ type: DataType.STRING(255) })
  declare provider_message_id: string | null;

  @AllowNull(true)
  @ForeignKey(() => EmailCampaign)
  @Column({ type: DataType.UUID })
  declare campaign_id: string | null;

  @AllowNull(true)
  @ForeignKey(() => EmailCampaignRecipient)
  @Column({ type: DataType.UUID })
  declare campaign_recipient_id: string | null;

  @AllowNull(true)
  @Column({ type: DataType.CHAR(64) })
  declare email_digest: string | null;

  @AllowNull(false)
  @Column({ type: DataType.DATE })
  declare occurred_at: Date;

  @AllowNull(false)
  @Column({ type: DataType.DATE })
  declare received_at: Date;

  @AllowNull(true)
  @Column({ type: DataType.JSONB })
  declare metadata: Record<string, unknown> | null;
}
