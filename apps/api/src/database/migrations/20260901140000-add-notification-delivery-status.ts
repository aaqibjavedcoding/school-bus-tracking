import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Adds delivery status tracking to notifications.
 *
 * Tracks the delivery status of external notification channels (push, email,
 * SMS) separately from the in-app delivery which is always immediate via
 * Socket.IO.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.addColumn('notifications', 'push_status', {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'pending',
  });

  await queryInterface.addColumn('notifications', 'email_status', {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'not_configured',
  });

  await queryInterface.addColumn('notifications', 'sms_status', {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'not_configured',
  });

  await queryInterface.addColumn('notifications', 'delivery_retry_count', {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  });

  await queryInterface.addColumn('notifications', 'last_delivery_attempt_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });

  await queryInterface.addColumn('notifications', 'delivery_failure_reason', {
    type: DataTypes.STRING(500),
    allowNull: true,
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.removeColumn('notifications', 'push_status');
  await queryInterface.removeColumn('notifications', 'email_status');
  await queryInterface.removeColumn('notifications', 'sms_status');
  await queryInterface.removeColumn('notifications', 'delivery_retry_count');
  await queryInterface.removeColumn('notifications', 'last_delivery_attempt_at');
  await queryInterface.removeColumn('notifications', 'delivery_failure_reason');
}
