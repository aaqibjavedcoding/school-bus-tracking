'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the marketing email **template** tables:
 * `email_templates` (the container) and `email_template_versions` (the
 * immutable content snapshots a campaign pins).
 *
 * Design notes:
 *
 * - **Content is versioned, not overwritten.** `email_template_versions`
 *   stores every subject/body pair; the unique `(template_id, version)`
 *   constraint makes "campaign #12 sent version 3 of `welcome-email`" a
 *   database fact. Publishing sets `published_at`; from that moment the
 *   service layer refuses to modify the row.
 * - **The slug is unique among live rows only** (partial index, like
 *   `schools.code`): a soft-deleted template must not keep its slug hostage.
 * - **`allowed_variables` is JSONB** — the checkable contract of which
 *   `{{placeholders}}` the renderer may substitute. Bounded by validation
 *   before any write.
 * - **No `school_id`.** Marketing templates are platform-level (SUPER_ADMIN
 *   only) concerns; schools are the audience, never the owner.
 * - `created_by` / `updated_by` are nullable user references with
 *   `ON DELETE SET NULL` (the `audit_logs` actor pattern): authorship history
 *   survives account removal.
 * - Status columns are plain VARCHARs validated against the shared
 *   `MarketingTemplateStatus` enum by the API layer (the `import_jobs`
 *   pattern — adding a value stays a code-only change).
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'email_templates',
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
        slug: {
          type: DataTypes.STRING(80),
          allowNull: false,
        },
        status: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: 'DRAFT',
        },
        created_by: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        updated_by: {
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

    // Slug identity among live templates (soft-deleted rows release theirs).
    await queryInterface.addIndex('email_templates', ['slug'], {
      name: 'uq_email_templates_slug',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    // Console list: templates by status, most recently edited first.
    await queryInterface.addIndex('email_templates', ['status', 'updated_at'], {
      name: 'idx_email_templates_status_updated',
      transaction,
    });

    await queryInterface.createTable(
      'email_template_versions',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        template_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'email_templates', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        version: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        subject: {
          type: DataTypes.STRING(200),
          allowNull: false,
        },
        html_body: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        text_body: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        allowed_variables: {
          type: DataTypes.JSONB,
          allowNull: false,
        },
        created_by: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        /** NULL = draft version (still editable); set = published (immutable). */
        published_at: {
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
      },
      { transaction },
    );

    // One version number per template — the reproducibility guarantee.
    await queryInterface.addIndex('email_template_versions', ['template_id', 'version'], {
      name: 'uq_email_template_versions_template_version',
      unique: true,
      transaction,
    });

    // "Latest published version of this template" lookup.
    await queryInterface.addIndex('email_template_versions', ['template_id', 'published_at'], {
      name: 'idx_email_template_versions_template_published',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    // Children first: versions reference templates.
    await queryInterface.dropTable('email_template_versions', { transaction });
    await queryInterface.dropTable('email_templates', { transaction });
  });
}
