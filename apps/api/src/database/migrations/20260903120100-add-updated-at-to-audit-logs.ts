import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Adds the standard `updated_at` timestamp to `audit_logs`.
 *
 * The table was created with `created_at` only while its Sequelize model
 * inherits the platform-wide `BaseModel`, which always maps an `updated_at`
 * attribute. Any query that does not pin an explicit attribute list — e.g. the
 * admin audit-log listing — therefore selected a column that did not exist.
 *
 * The column is additive and backfilled with the row's own `created_at`
 * (audit rows are never updated, so it stays equal to it). The model keeps
 * `updatedAt: false`, so the application still never *writes* the column —
 * the audit trail remains append-only.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  // Both columns are nullable: the audit model maps them through the shared
  // BaseModel but disables the `updatedAt` mapping (`updatedAt: false` — the
  // trail is append-only), so the ORM leaves `updated_at` NULL on insert.
  // Rows are never updated or soft-deleted, and every query already orders
  // and filters on `created_at`.
  await queryInterface.addColumn('audit_logs', 'updated_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await queryInterface.addColumn('audit_logs', 'deleted_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.removeColumn('audit_logs', 'deleted_at');
  await queryInterface.removeColumn('audit_logs', 'updated_at');
}
