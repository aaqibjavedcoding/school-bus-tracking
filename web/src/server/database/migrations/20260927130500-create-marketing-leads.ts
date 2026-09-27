'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the marketing **lead** tables: `marketing_leads` (the sales record)
 * and `marketing_lead_events` (its append-only lifecycle trail).
 *
 * Design notes:
 *
 * - **`consent_at` is NOT NULL.** It is the record that the data subject
 *   permitted contact; a lead without it is a lead the system must not keep.
 *   The server always sets it at capture time (`now()` for public
 *   submissions) — no client ever supplies a timestamp.
 * - **The email is not unique.** The same person may legitimately submit more
 *   than one demo request; duplicates are merged by the service layer, not
 *   by a constraint that would silently drop a fresh submission.
 * - **Attribution is `ON DELETE SET NULL`.** A lead is a sales record; the
 *   campaign that produced it is context. If campaign data is ever purged,
 *   the lead — and its consent evidence — survives with the attribution
 *   simply gone.
 * - **`marketing_lead_events` is append-only** (`created_at` only — the
 *   `audit_logs` pattern) and `actor` is a short safe label (`system`,
 *   `public-form`, `super-admin`), never an email address or raw token.
 * - `utm` is JSONB attribution echoed from the landing page URL, bounded by
 *   validation before any write.
 * - `status` / `source` are plain VARCHARs validated against the shared
 *   `MarketingLeadStatus` / `MarketingLeadSource` enums by the API layer.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'marketing_leads',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        full_name: {
          type: DataTypes.STRING(120),
          allowNull: false,
        },
        normalized_email: {
          type: DataTypes.STRING(254),
          allowNull: false,
        },
        institution_name: {
          type: DataTypes.STRING(200),
          allowNull: true,
        },
        phone: {
          type: DataTypes.STRING(32),
          allowNull: true,
        },
        city: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        country: {
          type: DataTypes.STRING(2),
          allowNull: true,
        },
        message: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        preferred_contact_time: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        status: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: 'NEW',
        },
        source: {
          type: DataTypes.STRING(32),
          allowNull: false,
          defaultValue: 'LANDING_PAGE',
        },
        utm: {
          type: DataTypes.JSONB,
          allowNull: true,
        },
        campaign_id: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'email_campaigns', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        campaign_recipient_id: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'email_campaign_recipients', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        consent_at: {
          type: DataTypes.DATE,
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
        deleted_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    // Console pipeline: leads by status, newest first.
    await queryInterface.addIndex('marketing_leads', ['status', 'created_at'], {
      name: 'idx_marketing_leads_status_created',
      transaction,
    });

    // "Has this person contacted us before?" during intake.
    await queryInterface.addIndex('marketing_leads', ['normalized_email'], {
      name: 'idx_marketing_leads_email',
      transaction,
    });

    // Campaign attribution drill-down ("leads from the spring campaign").
    await queryInterface.addIndex('marketing_leads', ['campaign_id'], {
      name: 'idx_marketing_leads_campaign',
      transaction,
    });

    // Volume by acquisition channel.
    await queryInterface.addIndex('marketing_leads', ['source', 'created_at'], {
      name: 'idx_marketing_leads_source_created',
      transaction,
    });

    await queryInterface.createTable(
      'marketing_lead_events',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        lead_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'marketing_leads', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        event_type: {
          type: DataTypes.STRING(32),
          allowNull: false,
        },
        actor: {
          type: DataTypes.STRING(120),
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

    // Lead timeline: events for one lead, in order.
    await queryInterface.addIndex('marketing_lead_events', ['lead_id', 'created_at'], {
      name: 'idx_marketing_lead_events_lead_created',
      transaction,
    });

    // Aggregate views (contact volume over time).
    await queryInterface.addIndex('marketing_lead_events', ['event_type', 'created_at'], {
      name: 'idx_marketing_lead_events_type_created',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    // Children first: lead events reference leads.
    await queryInterface.dropTable('marketing_lead_events', { transaction });
    await queryInterface.dropTable('marketing_leads', { transaction });
  });
}
