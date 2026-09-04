'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `school_subscriptions` table — the link between a tenant School
 * and a commercial Plan of the Task 41 catalog (Task 42, step 1).
 *
 * Design notes:
 *
 * - **No plan data is copied.** Name, code, price, currency, billing period,
 *   features and limits stay in `plans` and are resolved through `plan_id`,
 *   so editing a plan is immediately reflected in every subscription.
 * - **History is preserved.** A school may accumulate many subscription rows
 *   (plan changes, cancellations, expiries). Only one of them may be *live*
 *   at a time — enforced by the partial unique index
 *   `uq_school_subscriptions_live_school`. Changing a plan closes the current
 *   row and inserts a new one instead of overwriting history.
 * - **`status = 'none'` is never stored.** The enum carries the value so the
 *   shared `SubscriptionStatus` type maps 1:1 onto the database type, but a
 *   CHECK constraint rejects it on rows: "no subscription" is the *absence*
 *   of a row, which the API projects as `status: 'none'` (the behaviour the
 *   previous `NO_SUBSCRIPTION` placeholder had).
 * - **Payment-compatible, payment-free.** The period window, trial window and
 *   cancellation timestamp are the columns a future billing phase needs; no
 *   payment, invoice or renewal logic is introduced here.
 *
 * `ON DELETE CASCADE` on the school keeps the tenant delete path intact,
 * while the plan reference uses `ON DELETE RESTRICT`: a plan that is
 * referenced by subscription history can never be hard-deleted out from
 * under it (plans are retired with `is_active = false`, not deleted).
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'school_subscriptions',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        school_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        plan_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        status: {
          type: DataTypes.ENUM('none', 'trialing', 'active', 'past_due', 'cancelled', 'expired'),
          allowNull: false,
          defaultValue: 'active',
        },
        // Trial window — both null when the subscription has no trial.
        trial_start: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        trial_end: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        // Current service period. `current_period_end = NULL` means
        // open-ended (no renewal date is computed before the billing phase).
        current_period_start: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        current_period_end: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        cancelled_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        deleted_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    // ---- Foreign keys ---------------------------------------------------
    await queryInterface.addConstraint('school_subscriptions', {
      type: 'foreign key',
      name: 'fk_school_subscriptions_school',
      fields: ['school_id'],
      references: { table: 'schools', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
      transaction,
    });

    await queryInterface.addConstraint('school_subscriptions', {
      type: 'foreign key',
      name: 'fk_school_subscriptions_plan',
      fields: ['plan_id'],
      references: { table: 'plans', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
      transaction,
    });

    // ---- Indexes --------------------------------------------------------
    // At most one *live* subscription (trialing/active/past_due) per school.
    // Terminal rows (cancelled/expired) and soft-deleted rows are excluded so
    // full subscription history can accumulate freely.
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX "uq_school_subscriptions_live_school"
         ON "school_subscriptions" ("school_id")
         WHERE "deleted_at" IS NULL
           AND "status" IN ('trialing', 'active', 'past_due');`,
      { transaction },
    );

    // History reads: "subscriptions of this school, newest first".
    await queryInterface.addIndex('school_subscriptions', ['school_id', 'created_at'], {
      name: 'idx_school_subscriptions_school_created',
      transaction,
    });

    // "Which schools are on this plan" + plan retirement impact checks.
    await queryInterface.addIndex('school_subscriptions', ['plan_id', 'status'], {
      name: 'idx_school_subscriptions_plan_status',
      transaction,
    });

    // Future period-expiry sweeps (billing phase) without a table scan.
    await queryInterface.addIndex('school_subscriptions', ['status', 'current_period_end'], {
      name: 'idx_school_subscriptions_status_period_end',
      transaction,
    });

    // ---- Check constraints ---------------------------------------------
    // `none` is a projection-only status and must never be persisted.
    await queryInterface.sequelize.query(
      `ALTER TABLE "school_subscriptions"
         ADD CONSTRAINT "ck_school_subscriptions_status_not_none"
         CHECK ("status" <> 'none');`,
      { transaction },
    );

    // Trial window ordering.
    await queryInterface.sequelize.query(
      `ALTER TABLE "school_subscriptions"
         ADD CONSTRAINT "ck_school_subscriptions_trial_range"
         CHECK ("trial_start" IS NULL
                OR "trial_end" IS NULL
                OR "trial_end" >= "trial_start");`,
      { transaction },
    );

    // A trialing subscription must declare when the trial ends.
    await queryInterface.sequelize.query(
      `ALTER TABLE "school_subscriptions"
         ADD CONSTRAINT "ck_school_subscriptions_trialing_requires_trial_end"
         CHECK ("status" <> 'trialing' OR "trial_end" IS NOT NULL);`,
      { transaction },
    );

    // Current period ordering.
    await queryInterface.sequelize.query(
      `ALTER TABLE "school_subscriptions"
         ADD CONSTRAINT "ck_school_subscriptions_period_range"
         CHECK ("current_period_end" IS NULL
                OR "current_period_end" >= "current_period_start");`,
      { transaction },
    );

    // A cancelled subscription always records when it was cancelled.
    await queryInterface.sequelize.query(
      `ALTER TABLE "school_subscriptions"
         ADD CONSTRAINT "ck_school_subscriptions_cancelled_requires_timestamp"
         CHECK ("status" <> 'cancelled' OR "cancelled_at" IS NOT NULL);`,
      { transaction },
    );

    // A cancellation cannot predate the period it cancels.
    await queryInterface.sequelize.query(
      `ALTER TABLE "school_subscriptions"
         ADD CONSTRAINT "ck_school_subscriptions_cancelled_after_start"
         CHECK ("cancelled_at" IS NULL
                OR "cancelled_at" >= "current_period_start");`,
      { transaction },
    );
  });
}

/**
 * Safe rollback: drops the table (which also drops its indexes, constraints
 * and the PostgreSQL enum type created for the `status` column). No other
 * table is touched — `schools` and `plans` are left exactly as they were.
 */
export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.dropTable('school_subscriptions', { transaction });
  });
}
