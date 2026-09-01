import { registerAs } from '@nestjs/config';

export default registerAs('retention', () => ({
  locationDays: parseInt(process.env.LOCATION_RETENTION_DAYS || '90', 10),
  notificationDays: parseInt(process.env.NOTIFICATION_RETENTION_DAYS || '180', 10),
  refreshTokenDays: parseInt(process.env.REFRESH_TOKEN_RETENTION_DAYS || '30', 10),
  auditLogDays: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '365', 10),
  emergencyDays: parseInt(process.env.EMERGENCY_RETENTION_DAYS || '730', 10),
  idempotencyKeyDays: parseInt(process.env.IDEMPOTENCY_KEY_RETENTION_DAYS || '7', 10),
}));
