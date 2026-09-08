import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Adds the standard `updated_at` timestamp to `idempotency_keys`.
 *
 * Same defect the audit-log table had (fixed in 20260903120100): the table was
 * created with `created_at` only, while its Sequelize model inherits the
 * platform-wide `BaseModel`, which always maps an `updated_at` attribute. The
 * inherited `@Column` wins over the model's `@Table({ updatedAt: false })`,
 * so **every** `IdempotencyKey.create()` — the write path of the idempotency
 * replay guard itself (trip status, trip cancel, GPS ingest) — failed with
 * `column "updated_at" does not exist` against a migrated database.
 *
 * The columns are additive and nullable: the model keeps `updatedAt: false`,
 * so the application never writes them (a stored idempotency result is
 * immutable until its TTL expiry deletes it). The retention worker's cleanup
 * keys on `expires_at`, not on these columns.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  // Both columns are nullable and never written by the application (the
  // model disables the `updatedAt` mapping and is not soft-deletable) — they
  // exist so the BaseModel-inherited attributes the ORM selects on every
  // query resolve against the real schema.
  await queryInterface.addColumn('idempotency_keys', 'updated_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await queryInterface.addColumn('idempotency_keys', 'deleted_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.removeColumn('idempotency_keys', 'deleted_at');
  await queryInterface.removeColumn('idempotency_keys', 'updated_at');
}
