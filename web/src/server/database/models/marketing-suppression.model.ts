import { AllowNull, Column, DataType, Table } from 'sequelize-typescript';
import {
  MarketingSuppressionReason,
  MarketingSuppressionSource,
} from '@school-bus-tracking/shared-types';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';

export interface MarketingSuppressionAttributes extends BaseModelAttributes {
  /** Trimmed + lowercased address; unique platform-wide. */
  normalized_email: string;
  reason: MarketingSuppressionReason;
  source: MarketingSuppressionSource;
}

export type MarketingSuppressionCreationAttributes = Optional<
  MarketingSuppressionAttributes,
  BaseModelManagedFields | 'reason' | 'source'
> &
  Pick<MarketingSuppressionAttributes, 'normalized_email'>;

/**
 * The global marketing do-not-send list.
 *
 * One row per address, ever: the unique index on `normalized_email` means a
 * re-suppression (e.g. a second unsubscribe click, or a bounce after a manual
 * removal and re-add) resolves to the existing row being updated — never a
 * duplicate. Every send path in the marketing worker consults this table
 * **at send time**, not only at snapshot time, so an unsubscribe that arrives
 * while a campaign is mid-flight is still honoured for every not-yet-sent
 * recipient.
 *
 * Suppression is **not** deletion: the row is the proof that the address
 * opted out, which is exactly what an auditor or a mailbox provider asks for.
 * Removing an entry is a deliberate Super Admin action (the API records who
 * and why in the audit log); the table has no soft delete because a hidden
 * row and a missing row must not be distinguishable states.
 *
 * Scope: this list governs **marketing** email only. Transactional school
 * notifications (trip alerts, password resets) are a different consent basis
 * and a different table — they are unaffected.
 */
@Table({
  tableName: 'marketing_suppressions',
  modelName: 'MarketingSuppression',
  underscored: true,
  timestamps: true,
  deletedAt: false,
  paranoid: false,
  indexes: [
    { name: 'uq_marketing_suppressions_email', unique: true, fields: ['normalized_email'] },
    { name: 'idx_marketing_suppressions_reason', fields: ['reason'] },
  ],
})
export class MarketingSuppression extends BaseModel<
  MarketingSuppressionAttributes,
  MarketingSuppressionCreationAttributes
> {
  @AllowNull(false)
  @Column({ type: DataType.STRING(254) })
  declare normalized_email: string;

  @AllowNull(false)
  @Column({ type: DataType.STRING(32) })
  declare reason: MarketingSuppressionReason;

  @AllowNull(false)
  @Column({ type: DataType.STRING(32) })
  declare source: MarketingSuppressionSource;
}
