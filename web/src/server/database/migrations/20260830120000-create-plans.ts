'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes, Op } from 'sequelize';

/**
 * Creates the `plans` table — the platform-level commercial plan catalog.
 *
 * Plans are tenant-less (they belong to the platform, not to a school) and are
 * managed exclusively by SUPER_ADMIN. They describe a commercial tier that
 * future `school_subscriptions` rows will reference; no subscription lifecycle
 * is introduced in this migration.
 *
 * Feature flags and usage limits are stored as JSONB columns so new features
 * or resource categories can be rolled out without schema changes. The API
 * layer enforces a documented set of known keys (see `PlanFeature` /
 * `PlanLimitResource` in `@school-bus-tracking/shared-types`); unknown keys
 * are rejected on write and preserved on read so gradual rollout is safe.
 *
 * The `price` column stores the plan price in integer **cents** of `currency`
 * to eliminate floating-point rounding; the API exposes it as a decimal
 * string / number to clients. A plan with `is_active = false` is hidden from
 * any new subscription flow but remains referenced by historical data.
 */
export async function up(queryInterface: QueryInterface, _Sequelize: typeof DataTypes): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'plans',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        code: {
          type: DataTypes.STRING(32),
          allowNull: false,
        },
        name: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        description: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        // Price in integer cents of `currency` (e.g. 1999 = $19.99).
        price_cents: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        currency: {
          type: DataTypes.STRING(3),
          allowNull: false,
        },
        billing_period: {
          type: DataTypes.ENUM('monthly', 'yearly'),
          allowNull: false,
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        // `{ [featureKey]: boolean }` — extensible feature toggle map.
        features: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: {},
        },
        // `{ [resourceKey]: { unlimited: boolean, value: number | null } }`
        limits: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: {},
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

    // Plan codes are unique platform-wide (soft-deleted rows must not hold a
    // code hostage so historical data can be archived and the code reused).
    await queryInterface.addIndex('plans', ['code'], {
      name: 'uq_plans_code',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    // Hot path: active-plan listings ordered by billing period + price.
    await queryInterface.addIndex('plans', ['billing_period', 'is_active', 'price_cents'], {
      name: 'idx_plans_period_active_price',
      transaction,
    });

    // Soft-delete / lifecycle lookups by active flag.
    await queryInterface.addIndex('plans', ['is_active', 'created_at'], {
      name: 'idx_plans_active_created',
      transaction,
    });

    // Check: price_cents cannot be negative.
    await queryInterface.addConstraint('plans', {
      type: 'check',
      name: 'ck_plans_price_cents_non_negative',
      fields: ['price_cents'],
      where: { price_cents: { [Op.gte]: 0 } },
      transaction,
    });

    // Check: currency is uppercase 3 letters.
    await queryInterface.addConstraint('plans', {
      type: 'check',
      name: 'ck_plans_currency_uppercase',
      fields: ['currency'],
      where: { currency: { [Op.regexp]: '^[A-Z]{3}$' } },
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.dropTable('plans', { transaction });
    // ENUM types are created per column by Sequelize and are dropped alongside
    // the table on PostgreSQL, so no manual ENUM cleanup is required.
  });
}
