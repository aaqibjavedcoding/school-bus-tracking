'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `marketing_suppressions` table — the global do-not-send list
 * for marketing email.
 *
 * Design notes:
 *
 * - **One row per address, ever.** The unique index on `normalized_email`
 *   means a re-suppression (second unsubscribe click, bounce after a manual
 *   removal-and-re-add) resolves to the existing row being updated — never a
 *   duplicate. The worker consults this table at *send time*, not only at
 *   snapshot time, so an unsubscribe that arrives mid-campaign is still
 *   honoured for every not-yet-sent recipient.
 * - **Suppression is not deletion.** The row is the proof the address opted
 *   out — exactly what an auditor or a mailbox provider asks for. Removal is
 *   a deliberate Super Admin action recorded in the audit log; there is no
 *   soft delete because a hidden row and a missing row must not be
 *   distinguishable states.
 * - **Marketing scope only.** Transactional school notifications (trip
 *   alerts, password resets) are a different consent basis and unaffected.
 * - `reason` / `source` are plain VARCHARs validated against the shared
 *   `MarketingSuppressionReason` / `MarketingSuppressionSource` enums by the
 *   API layer.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'marketing_suppressions',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        normalized_email: {
          type: DataTypes.STRING(254),
          allowNull: false,
        },
        reason: {
          type: DataTypes.STRING(32),
          allowNull: false,
        },
        source: {
          type: DataTypes.STRING(32),
          allowNull: false,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
      },
      { transaction },
    );

    // The do-not-send lookup is by exact normalized address.
    await queryInterface.addIndex('marketing_suppressions', ['normalized_email'], {
      name: 'uq_marketing_suppressions_email',
      unique: true,
      transaction,
    });

    // Breakdown views ("how many hard bounces are on the list?").
    await queryInterface.addIndex('marketing_suppressions', ['reason'], {
      name: 'idx_marketing_suppressions_reason',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('marketing_suppressions');
}
