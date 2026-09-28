import { QueryInterface, DataTypes, Transaction } from 'sequelize';

/**
 * Adds the nullable `updated_at` / `deleted_at` columns that `BaseModel`
 * always *maps* but several tables never got.
 *
 * This is the same defect `20260903120100-add-updated-at-to-audit-logs`
 * fixed for `audit_logs`, repaired the same way. Every model inherits
 * `BaseModel`, which declares `created_at`, `updated_at` and `deleted_at` as
 * attributes. Setting `updatedAt: false` / `deletedAt: false` on the `@Table`
 * decorator stops Sequelize *writing* them — it does not remove the
 * attributes. The INSERT column list is therefore correct, but the
 * `RETURNING` clause Sequelize appends on PostgreSQL still names every mapped
 * attribute:
 *
 * ```sql
 * INSERT INTO marketing_lead_events (id, created_at, ...)
 * VALUES (...)
 * RETURNING "id","created_at","updated_at","deleted_at",...;
 * --                          ^^^^^^^^^^^^ column does not exist
 * ```
 *
 * The result is a hard `column "updated_at" does not exist` failure on any
 * `Model.create()` against these tables — invisible to unit suites that stub
 * the database, and caught here by the first DB-backed marketing tests.
 *
 * Both columns are **nullable and never written**: the models keep
 * `updatedAt: false` / `deletedAt: false`, so `marketing_lead_events` and
 * `email_events` stay append-only and nothing gains soft-delete semantics.
 * Purely additive, safe against live data, trivially reversible.
 */

const TIMESTAMP_COLUMN = { type: DataTypes.DATE, allowNull: true } as const;

/**
 * The `(table, column)` pairs this migration adds.
 *
 * Exported so the schema guard spec can reason about them directly instead of
 * pattern-matching migration source text.
 */
export const ADDED_TIMESTAMP_COLUMNS: ReadonlyArray<readonly [table: string, column: string]> = [
  ['email_template_versions', 'deleted_at'],
  ['email_campaign_recipients', 'deleted_at'],
  ['email_events', 'updated_at'],
  ['email_events', 'deleted_at'],
  ['marketing_suppressions', 'deleted_at'],
  ['marketing_lead_events', 'updated_at'],
  ['marketing_lead_events', 'deleted_at'],
  // Not a marketing table, but the identical latent failure: the password
  // reset model maps both columns and the table has neither.
  ['password_reset_tokens', 'updated_at'],
  ['password_reset_tokens', 'deleted_at'],
];

/** Adds `column` to `table` unless it is already there (re-run safe). */
async function addIfMissing(
  queryInterface: QueryInterface,
  table: string,
  column: string,
  transaction: Transaction,
): Promise<void> {
  // The typings for `describeTable` omit `transaction`; the implementation
  // honours it, and the check must run inside this migration's transaction.
  const described = await queryInterface.describeTable(table, { transaction } as never);
  if (described[column]) {
    return;
  }
  await queryInterface.addColumn(table, column, TIMESTAMP_COLUMN, { transaction });
}

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const [table, column] of ADDED_TIMESTAMP_COLUMNS) {
      await addIfMissing(queryInterface, table, column, transaction);
    }
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const [table, column] of [...ADDED_TIMESTAMP_COLUMNS].reverse()) {
      await queryInterface.removeColumn(table, column, { transaction });
    }
  });
}
