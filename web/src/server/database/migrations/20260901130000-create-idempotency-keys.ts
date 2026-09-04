import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Idempotency key store for critical mutations.
 *
 * Each row represents a completed (or in-progress) operation keyed by a
 * client-generated idempotency key. Duplicate requests with the same
 * `(school_id, user_id, endpoint, idempotency_key)` return the stored
 * result instead of re-executing the operation.
 *
 * Expired keys are cleaned up by the retention/worker infrastructure.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('idempotency_keys', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    school_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'schools', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    endpoint: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    idempotency_key: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    response_status: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    response_body: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  // Unique constraint: one result per (school, user, endpoint, key).
  await queryInterface.addIndex('idempotency_keys', {
    fields: ['school_id', 'user_id', 'endpoint', 'idempotency_key'],
    unique: true,
    name: 'idempotency_keys_unique_lookup',
  });

  // Cleanup index for expired keys.
  await queryInterface.addIndex('idempotency_keys', ['expires_at']);
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('idempotency_keys');
}
