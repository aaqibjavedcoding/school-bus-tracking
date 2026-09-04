import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Assisted-management sessions for the Super Admin "Manage Data" feature.
 *
 * When a platform SUPER_ADMIN enters a school to help manage its operational
 * data (without impersonating anyone), a row is recorded here so the platform
 * can always answer *who* helped *which school*, *when the session started*,
 * *when and why it ended*. Audit rows written while the session is open
 * reference the session id in their JSONB metadata.
 *
 * The table never stores credentials or tokens — only ids, timestamps, the
 * close reason and the optional client IP captured at session start.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('assisted_management_sessions', {
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
    actor_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    ended_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    end_reason: {
      type: DataTypes.STRING(40),
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
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  // Session history per school (banner "since", activity review).
  await queryInterface.addIndex('assisted_management_sessions', ['school_id', 'started_at']);
  // Open-session lookup: the current session of one actor in one school —
  // checked on every assisted mutation that carries audit context.
  await queryInterface.addIndex('assisted_management_sessions', [
    'actor_user_id',
    'school_id',
    'ended_at',
  ]);
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('assisted_management_sessions');
}
