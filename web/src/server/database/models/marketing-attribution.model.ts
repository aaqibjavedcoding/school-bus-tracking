import { AllowNull, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { EmailCampaign } from './marketing-campaign.model';
import { EmailCampaignRecipient } from './marketing-campaign-recipient.model';

export interface MarketingAttributionAttributes extends BaseModelAttributes {
  /** SHA-256 of the per-click nonce. The nonce itself is never stored. */
  nonce_digest: string;
  campaign_id: string;
  campaign_recipient_id: string;
  issued_at: Date;
  expires_at: Date;
  /** Set when a demo request claimed this attribution (replay protection). */
  consumed_at: Date | null;
  /** How often the cookie was presented; bounded to stop replay hammering. */
  use_count: number;
}

export type MarketingAttributionCreationAttributes = Optional<
  MarketingAttributionAttributes,
  BaseModelManagedFields | 'issued_at' | 'consumed_at' | 'use_count'
>;

/**
 * One tracked click's attribution grant.
 *
 * A valid click mints a cryptographically random nonce, stores **only its
 * SHA-256 digest** here, and hands the browser a signed cookie carrying the
 * nonce. Resolving a later demo request is therefore a single unique-index
 * probe — never a scan over campaigns and recipients — and a database leak
 * yields no usable cookie, exactly like the click/unsubscribe tokens.
 *
 * Honest limitation, unchanged from Session 4: this binds a lead to the
 * **original recipient address** of the campaign email. If that email was
 * forwarded, the attribution still names the original recipient — it never
 * proves which human clicked. The address on the form is the reliable
 * identity of the submitter.
 */
@Table({
  tableName: 'marketing_attributions',
  modelName: 'MarketingAttribution',
  underscored: true,
  timestamps: true,
  paranoid: false,
  indexes: [
    { name: 'uq_marketing_attributions_nonce', unique: true, fields: ['nonce_digest'] },
    { name: 'idx_marketing_attributions_expires', fields: ['expires_at'] },
    { name: 'idx_marketing_attributions_recipient', fields: ['campaign_recipient_id'] },
  ],
})
export class MarketingAttribution extends BaseModel<
  MarketingAttributionAttributes,
  MarketingAttributionCreationAttributes
> {
  @AllowNull(false)
  @Column({ type: DataType.CHAR(64) })
  declare nonce_digest: string;

  @AllowNull(false)
  @ForeignKey(() => EmailCampaign)
  @Column({ type: DataType.UUID })
  declare campaign_id: string;

  @AllowNull(false)
  @ForeignKey(() => EmailCampaignRecipient)
  @Column({ type: DataType.UUID })
  declare campaign_recipient_id: string;

  @AllowNull(false)
  @Column({ type: DataType.DATE })
  declare issued_at: Date;

  @AllowNull(false)
  @Column({ type: DataType.DATE })
  declare expires_at: Date;

  @AllowNull(true)
  @Column({ type: DataType.DATE })
  declare consumed_at: Date | null;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare use_count: number;
}
