'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Session 4 — public lead capture columns on `marketing_leads`.
 *
 * - **`consent_source`** completes the consent record: `consent_at` (already
 *   NOT NULL) says *when* permission was given, this column says *through
 *   which channel* (`public-form` for the landing page checkbox, `manual`
 *   for consent a Super Admin recorded out of band). Backfilled to
 *   `public-form`, which is the only capture channel that has existed.
 * - **`admin_notified_at`** records when the asynchronous new-lead
 *   notification to `MARKETING_ADMIN_EMAILS` succeeded. Nullable by design:
 *   a lead whose notification failed (or has not run yet) is still a fully
 *   valid lead — the notification outcome additionally lands in
 *   `marketing_lead_events` (`ADMIN_NOTIFIED` / `ADMIN_NOTIFY_FAILED`), so a
 *   failure is recorded, never silently lost, and never rolls the lead back.
 * - **`submission_fingerprint`** makes the public endpoint idempotent
 *   without an account or an auth-scoped idempotency key: a SHA-256 digest
 *   of the *normalized* submission content. A browser retry / double submit
 *   with identical content inside the dedupe window finds the original row
 *   through this column and returns the same generic response instead of
 *   creating a duplicate. It is a digest of data the row already stores —
 *   never an IP address, never a token — so it adds no new personal data.
 *
 * Deliberately absent: any IP column. The public endpoint rate limits by a
 * *hashed, in-memory* IP bucket and stores nothing about the caller's
 * network identity — the most privacy-preserving retention policy is not
 * collecting the data at all.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.addColumn(
      'marketing_leads',
      'consent_source',
      {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'public-form',
      },
      { transaction },
    );

    await queryInterface.addColumn(
      'marketing_leads',
      'admin_notified_at',
      {
        type: DataTypes.DATE,
        allowNull: true,
      },
      { transaction },
    );

    await queryInterface.addColumn(
      'marketing_leads',
      'submission_fingerprint',
      {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      { transaction },
    );

    // The idempotency probe: "same content, recently?" is one indexed lookup.
    await queryInterface.addIndex('marketing_leads', ['submission_fingerprint', 'created_at'], {
      name: 'idx_marketing_leads_fingerprint_created',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.removeIndex('marketing_leads', 'idx_marketing_leads_fingerprint_created', {
      transaction,
    });
    await queryInterface.removeColumn('marketing_leads', 'submission_fingerprint', { transaction });
    await queryInterface.removeColumn('marketing_leads', 'admin_notified_at', { transaction });
    await queryInterface.removeColumn('marketing_leads', 'consent_source', { transaction });
  });
}
