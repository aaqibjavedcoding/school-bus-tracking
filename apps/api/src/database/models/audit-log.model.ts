import {
  AllowNull,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Table,
} from 'sequelize-typescript';
import { BaseModel, type BaseModelAttributes, type BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { User } from './user.model';

/**
 * Attributes exposed to the application layer.
 *
 * Sensitive fields (passwords, tokens, medical data) are never stored.
 * `metadata` is a free-form JSONB column for safe contextual information
 * (entity name, old/new values of non-sensitive fields, etc.).
 */
export interface AuditLogAttributes extends BaseModelAttributes {
  school_id: string | null;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  request_id: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
}

/** Fields auto-managed by the ORM or generated on insert. */
export type AuditLogManagedFields = BaseModelManagedFields | 'created_at';

export type AuditLogCreationAttributes = Omit<AuditLogAttributes, AuditLogManagedFields> &
  Partial<Pick<AuditLogAttributes, AuditLogManagedFields>>;

/**
 * Append-only audit trail for security-relevant and operational mutations.
 *
 * The table is never updated or deleted from the application; retention
 * cleanup is handled by the worker/retention job infrastructure.
 */
@Table({
  tableName: 'audit_logs',
  timestamps: true,
  updatedAt: false,
  deletedAt: false,
  paranoid: false,
})
export class AuditLog extends BaseModel<AuditLogAttributes, AuditLogCreationAttributes> {
  @AllowNull(true)
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, field: 'school_id' })
  declare school_id: string | null;

  @AllowNull(true)
  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, field: 'actor_user_id' })
  declare actor_user_id: string | null;

  @AllowNull(false)
  @Column({ type: DataType.STRING(120), field: 'action' })
  declare action: string;

  @AllowNull(false)
  @Column({ type: DataType.STRING(80), field: 'entity_type' })
  declare entity_type: string;

  @AllowNull(true)
  @Column({ type: DataType.UUID, field: 'entity_id' })
  declare entity_id: string | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(64), field: 'request_id' })
  declare request_id: string | null;

  @AllowNull(true)
  @Column({ type: DataType.JSONB, field: 'metadata' })
  declare metadata: Record<string, unknown> | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(45), field: 'ip_address' })
  declare ip_address: string | null;

  @BelongsTo(() => School, { foreignKey: 'school_id', constraints: false })
  declare school?: School;

  @BelongsTo(() => User, { foreignKey: 'actor_user_id', constraints: false })
  declare actor?: User;
}
