import { Column, DataType, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import {
  PlanBillingPeriod,
  PlanFeaturesConfig,
  PlanLimitsConfig,
} from '@school-bus-tracking/shared-types';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';

export interface PlanAttributes extends BaseModelAttributes {
  /** Stable machine-readable code (kebab-case), unique platform-wide. */
  code: string;
  /** Human-readable tier name (e.g. "Basic", "Pro", "Enterprise"). */
  name: string;
  description: string | null;
  /** Price in integer **cents** of `currency` (e.g. 1999 = $19.99). */
  price_cents: number;
  /** ISO 4217 currency code (e.g. "USD"). */
  currency: string;
  billing_period: PlanBillingPeriod;
  /** When false, the plan is hidden from new subscription flows. */
  is_active: boolean;
  /** Feature toggle map, e.g. `{ live_tracking: true, analytics: false }`. */
  features: PlanFeaturesConfig;
  /** Resource limit map keyed by `PlanLimitResource`. */
  limits: PlanLimitsConfig;
}

export type PlanCreationAttributes = Optional<
  PlanAttributes,
  BaseModelManagedFields | 'description' | 'is_active' | 'features' | 'limits'
>;

/**
 * Platform-level commercial subscription plan.
 *
 * Plans are **tenant-less**: they belong to the SaaS platform itself and are
 * managed exclusively by a `SUPER_ADMIN`. They do not reference a school —
 * a future `school_subscriptions` table will map Schools → Plans together
 * with the lifecycle state (status, current period, trial, cancellation).
 *
 * Features and limits are stored as JSONB rather than hardcoded columns so
 * new capabilities and resource categories can ship without schema changes.
 * Unknown keys are preserved on read but rejected on write by the API
 * service layer, which guarantees forward compatibility while preventing
 * typo'd data.
 *
 * The schema is migration-driven (no `sequelize.sync`).
 */
@Table({
  tableName: 'plans',
  modelName: 'Plan',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    {
      name: 'uq_plans_code',
      unique: true,
      fields: ['code'],
      where: { deleted_at: null },
    },
    {
      name: 'idx_plans_period_active_price',
      fields: ['billing_period', 'is_active', 'price_cents'],
    },
    {
      name: 'idx_plans_active_created',
      fields: ['is_active', 'created_at'],
    },
  ],
})
export class Plan extends BaseModel<PlanAttributes, PlanCreationAttributes> {
  @Column({ type: DataType.STRING(32), allowNull: false })
  declare code: string;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare name: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare description: string | null;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare price_cents: number;

  @Column({ type: DataType.STRING(3), allowNull: false })
  declare currency: string;

  @Column({
    type: DataType.ENUM('monthly', 'yearly'),
    allowNull: false,
  })
  declare billing_period: PlanBillingPeriod;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare is_active: boolean;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  declare features: PlanFeaturesConfig;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  declare limits: PlanLimitsConfig;
}
