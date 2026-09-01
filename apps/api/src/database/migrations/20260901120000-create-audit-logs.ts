import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Durable audit log for security-relevant and operational mutations.
 *
 * Every row records *who* did *what* to *which* entity, *when*, and from
 * *which* request. The table is append-only from the application's
 * perspective — updates and deletes are never issued against it.
 *
 * Tenant isolation is enforced at the application layer (every query is
 * pinned with `school_id`); the database column is nullable so platform-
 * level events (school create, plan changes) that have no tenant context
 * can still be recorded.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('audit_logs', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    school_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'schools', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    actor_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    action: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    entity_type: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    entity_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    request_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    ip_address: {
      type: DataTypes.STRING(45),
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  // Fast lookups for the admin audit-log UI.
  await queryInterface.addIndex('audit_logs', ['school_id', 'created_at']);
  await queryInterface.addIndex('audit_logs', ['actor_user_id', 'created_at']);
  await queryInterface.addIndex('audit_logs', ['entity_type', 'entity_id']);
  await queryInterface.addIndex('audit_logs', ['request_id']);
  await queryInterface.addIndex('audit_logs', ['action']);
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('audit_logs');
}
