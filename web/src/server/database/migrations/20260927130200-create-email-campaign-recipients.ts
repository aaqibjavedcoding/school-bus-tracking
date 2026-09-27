'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `email_campaign_recipients` table — the immutable per-campaign
 * audience snapshot and its delivery state machine.
 *
 * Security & data integrity:
 *
 * - **Only digests, never tokens.** `click_token_hash` and
 *   `unsubscribe_token_hash` are VARCHAR(64) — exactly one SHA-256 hex
 *   digest, the `password_reset_tokens` construction. The raw tokens exist
 *   only inside the links of the sent email; no column could hold them, so a
 *   database read (or a leaked backup) cannot forge a click attribution or an
 *   unsubscribe. Both digests are **unique**, so resolving a clicked link
 *   lands on at most one row.
 * - **`(campaign_id, normalized_email)` is unique** — the snapshot's
 *   deduplicate-by-address guarantee at the database level.
 * - **No raw provider errors.** `last_error_category` is VARCHAR(32) and
 *   holds only the safe classification (`MarketingErrorCategory`); SMTP
 *   transcripts can echo credentials, hostnames and message content and are
 *   never persisted.
 * - **No email body / subject / template content** — content lives on the
 *   immutable template version the campaign pins.
 * - **No soft delete.** The row *is* the delivery state; deleting it
 *   mid-campaign would orphan events and break counters. `school_id` is
 *   `ON DELETE SET NULL` so the row outlives the school record.
 * - `status` / `recipient_source` are plain VARCHARs validated against the
 *   shared enums by the API layer.
 *
 * Indexes match the three query shapes: the worker's claim scan
 * (`status`, `next_attempt_at`), per-campaign progress
 * (`campaign_id`, `status`) and address research (`normalized_email`).
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'email_campaign_recipients',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        campaign_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'email_campaigns', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        school_id: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'schools', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        normalized_email: {
          type: DataTypes.STRING(254),
          allowNull: false,
        },
        recipient_name: {
          type: DataTypes.STRING(150),
          allowNull: true,
        },
        recipient_source: {
          type: DataTypes.STRING(32),
          allowNull: false,
        },
        status: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: 'PENDING',
        },
        attempts: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        next_attempt_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        last_error_category: {
          type: DataTypes.STRING(32),
          allowNull: true,
        },
        sent_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        provider_message_id: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        click_token_hash: {
          type: DataTypes.STRING(64),
          allowNull: true,
        },
        unsubscribe_token_hash: {
          type: DataTypes.STRING(64),
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
      },
      { transaction },
    );

    // One row per address per campaign.
    await queryInterface.addIndex(
      'email_campaign_recipients',
      ['campaign_id', 'normalized_email'],
      {
        name: 'uq_email_campaign_recipients_campaign_email',
        unique: true,
        transaction,
      },
    );

    // Digest → exactly one recipient row (link resolution).
    await queryInterface.addIndex('email_campaign_recipients', ['click_token_hash'], {
      name: 'uq_email_campaign_recipients_click_token',
      unique: true,
      transaction,
    });

    await queryInterface.addIndex('email_campaign_recipients', ['unsubscribe_token_hash'], {
      name: 'uq_email_campaign_recipients_unsubscribe_token',
      unique: true,
      transaction,
    });

    // The worker's claim scan: due pending rows, soonest first.
    await queryInterface.addIndex('email_campaign_recipients', ['status', 'next_attempt_at'], {
      name: 'idx_email_campaign_recipients_status_next',
      transaction,
    });

    // Per-campaign progress and school drill-downs.
    await queryInterface.addIndex('email_campaign_recipients', ['campaign_id', 'status'], {
      name: 'idx_email_campaign_recipients_campaign_status',
      transaction,
    });

    await queryInterface.addIndex('email_campaign_recipients', ['school_id'], {
      name: 'idx_email_campaign_recipients_school',
      transaction,
    });

    // "Which campaigns reached this address?" — suppression research.
    await queryInterface.addIndex('email_campaign_recipients', ['normalized_email'], {
      name: 'idx_email_campaign_recipients_email',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('email_campaign_recipients');
}
