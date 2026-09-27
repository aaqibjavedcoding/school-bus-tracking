'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `email_campaigns` table — one marketing send.
 *
 * Design notes:
 *
 * - **Content is pinned, not referenced loosely.** Both `template_id` and
 *   `template_version_id` use `ON DELETE RESTRICT`: a template version a
 *   campaign sent can never be deleted, which is what keeps sent history
 *   reproducible.
 * - **`audience_filter` is the question, not the answer.** It stores the
 *   validated filter JSON (`MarketingCampaignAudienceFilter`) and never any
 *   email address — addresses live only in the recipient snapshot rows the
 *   scheduler materializes.
 * - **`audience_snapshot_hash`** (VARCHAR(64), a SHA-256 hex digest) is
 *   written once at scheduling time so two campaigns can be proven to have
 *   targeted the same audience without duplicating the address list.
 * - **Aggregate counters are denormalized** on purpose: the console's
 *   campaign list must not aggregate the recipient table per row. The worker
 *   maintains them transactionally with each delivery outcome.
 * - **No `school_id`.** A campaign is platform-level (SUPER_ADMIN only); the
 *   audience's tenancy lives on each recipient row.
 * - `status` is a plain VARCHAR validated against the shared
 *   `MarketingCampaignStatus` enum by the API layer.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'email_campaigns',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        name: {
          type: DataTypes.STRING(150),
          allowNull: false,
        },
        template_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'email_templates', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        template_version_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'email_template_versions', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        status: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: 'DRAFT',
        },
        audience_filter: {
          type: DataTypes.JSONB,
          allowNull: false,
        },
        audience_snapshot_hash: {
          type: DataTypes.STRING(64),
          allowNull: true,
        },
        scheduled_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        started_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        completed_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        recipient_count: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        sent_count: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        failed_count: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        clicked_count: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        unsubscribed_count: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        created_by: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
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

    // The scheduler's due-campaign scan: SCHEDULED rows whose time has come.
    await queryInterface.addIndex('email_campaigns', ['status', 'scheduled_at'], {
      name: 'idx_email_campaigns_status_scheduled',
      transaction,
    });

    // Console list: campaigns by status, newest first.
    await queryInterface.addIndex('email_campaigns', ['status', 'created_at'], {
      name: 'idx_email_campaigns_status_created',
      transaction,
    });

    // "Which campaigns used this template?"
    await queryInterface.addIndex('email_campaigns', ['template_id'], {
      name: 'idx_email_campaigns_template',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('email_campaigns');
}
