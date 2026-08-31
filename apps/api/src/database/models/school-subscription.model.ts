import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { PersistedSubscriptionStatus, SubscriptionStatus } from '@school-bus-tracking/shared-types';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { Plan } from './plan.model';
import { School } from './school.model';

export interface SchoolSubscriptionAttributes extends BaseModelAttributes {
  /** Owning tenant — references `schools.id`. */
  school_id: string;
  /** Commercial tier — references `plans.id` (Task 41 catalog). */
  plan_id: string;
  /**
   * Lifecycle state. `none` is never persisted (database CHECK constraint) —
   * it is the projection used when a school has no subscription row at all.
   */
  status: PersistedSubscriptionStatus;
  trial_start: Date | null;
  trial_end: Date | null;
  /** Start of the current service period; defaults to the creation instant. */
  current_period_start: Date;
  /** End of the current service period; `null` means open-ended. */
  current_period_end: Date | null;
  cancelled_at: Date | null;
}

export type SchoolSubscriptionCreationAttributes = Optional<
  SchoolSubscriptionAttributes,
  | BaseModelManagedFields
  | 'status'
  | 'trial_start'
  | 'trial_end'
  | 'current_period_start'
  | 'current_period_end'
  | 'cancelled_at'
>;

/**
 * A school's subscription to a platform plan (Task 42, step 1).
 *
 * ```text
 * School  →  SchoolSubscription  →  Plan
 * ```
 *
 * The row holds **only** the relationship and the lifecycle state. Plan name,
 * code, price, currency, billing period, features and limits are never
 * duplicated here: they are read through the `plan` association, so the
 * current commercial terms always come from the single Plans domain.
 *
 * History is append-friendly: a school may have many subscription rows over
 * time, but at most one *live* row (`trialing` / `active` / `past_due`) at any
 * moment. That invariant is enforced both in the service layer and by the
 * partial unique index `uq_school_subscriptions_live_school`, so a race
 * between two Super Admin requests cannot produce two live subscriptions.
 *
 * No payment/billing behaviour is attached to this model — the period, trial
 * and cancellation columns are the foundation a later billing phase builds on.
 *
 * The physical schema is migration-driven (no `sequelize.sync`).
 */
@Table({
  tableName: 'school_subscriptions',
  modelName: 'SchoolSubscription',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // Mirrors the partial unique index created by the migration. Sequelize
    // never syncs the schema; this entry documents the constraint alongside
    // the model (same convention as the other domain models).
    {
      name: 'uq_school_subscriptions_live_school',
      unique: true,
      fields: ['school_id'],
      where: {
        deleted_at: null,
        status: [
          SubscriptionStatus.TRIALING,
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.PAST_DUE,
        ],
      },
    },
    { name: 'idx_school_subscriptions_school_created', fields: ['school_id', 'created_at'] },
    { name: 'idx_school_subscriptions_plan_status', fields: ['plan_id', 'status'] },
    {
      name: 'idx_school_subscriptions_status_period_end',
      fields: ['status', 'current_period_end'],
    },
  ],
})
export class SchoolSubscription extends BaseModel<
  SchoolSubscriptionAttributes,
  SchoolSubscriptionCreationAttributes
> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => Plan)
  @Column({ type: DataType.UUID, allowNull: false })
  declare plan_id: string;

  @Column({
    type: DataType.ENUM(
      SubscriptionStatus.NONE,
      SubscriptionStatus.TRIALING,
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.CANCELLED,
      SubscriptionStatus.EXPIRED,
    ),
    allowNull: false,
    defaultValue: SubscriptionStatus.ACTIVE,
  })
  declare status: PersistedSubscriptionStatus;

  @Column({ type: DataType.DATE, allowNull: true })
  declare trial_start: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare trial_end: Date | null;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  declare current_period_start: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  declare current_period_end: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare cancelled_at: Date | null;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => Plan, { foreignKey: 'plan_id', as: 'plan' })
  declare plan?: Plan;
}
