'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `email_events` table — the append-only engagement log behind
 * campaign analytics (sent / failed / clicked / unsubscribed / bounced /
 * complained).
 *
 * What deliberately never appears on this table:
 *
 * - **No raw token.** An event is tied to its recipient row by
 *   `campaign_recipient_id`; the click/unsubscribe token itself is never
 *   stored anywhere in plaintext, so this log cannot be replayed to forge an
 *   attribution.
 * - **No email body or subject.** Content lives on the immutable template
 *   version the campaign pins; repeating it per event would multiply
 *   sensitive payload across every row.
 * - **No free-form provider error.** Failures carry only a safe category
 *   inside `metadata`.
 *
 * The table is append-only from the application (`created_at` only — no
 * `updated_at`, no `deleted_at`, the `audit_logs` pattern); retention cleanup
 * may purge old rows. Both foreign keys CASCADE: an event's meaning is
 * scoped to its campaign, and campaign teardown (hard delete after
 * retention) takes the analytics with it.
 *
 * Indexes cover the three query shapes: per-campaign funnels
 * (`campaign_id`, `event_type`, `occurred_at`), one recipient's timeline
 * (`campaign_recipient_id`, `occurred_at`) and platform-wide trends
 * (`event_type`, `occurred_at`).
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'email_events',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        campaign_id: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'email_campaigns', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        campaign_recipient_id: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'email_campaign_recipients', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        event_type: {
          type: DataTypes.STRING(32),
          allowNull: false,
        },
        occurred_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        metadata: {
          type: DataTypes.JSONB,
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
      },
      { transaction },
    );

    await queryInterface.addIndex('email_events', ['campaign_id', 'event_type', 'occurred_at'], {
      name: 'idx_email_events_campaign_type_occurred',
      transaction,
    });

    await queryInterface.addIndex('email_events', ['campaign_recipient_id', 'occurred_at'], {
      name: 'idx_email_events_recipient_occurred',
      transaction,
    });

    await queryInterface.addIndex('email_events', ['event_type', 'occurred_at'], {
      name: 'idx_email_events_type_occurred',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('email_events');
}
