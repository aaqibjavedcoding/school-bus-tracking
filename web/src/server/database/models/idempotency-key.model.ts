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

export interface IdempotencyKeyAttributes extends BaseModelAttributes {
  /**
   * Owning tenant, or `NULL` for the **platform scope**: SUPER_ADMIN records
   * (marketing templates, campaigns, delivery jobs) belong to no school, and
   * a platform key must never collide with a tenant key that happens to use
   * the same client-generated string. See `idempotency.service.ts`.
   */
  school_id: string | null;
  user_id: string;
  endpoint: string;
  idempotency_key: string;
  response_status: number;
  response_body: Record<string, unknown>;
  expires_at: Date;
}

export type IdempotencyKeyManagedFields = BaseModelManagedFields | 'created_at';

export type IdempotencyKeyCreationAttributes = Omit<
  IdempotencyKeyAttributes,
  IdempotencyKeyManagedFields
> &
  Partial<Pick<IdempotencyKeyAttributes, IdempotencyKeyManagedFields>>;

/**
 * Stores the result of an idempotent operation so that duplicate requests
 * with the same key return the original logical result.
 *
 * Scoped to (school_id, user_id, endpoint, idempotency_key) so keys are
 * tenant- and user-isolated. `school_id IS NULL` is the explicit **platform**
 * scope used by SUPER_ADMIN records; the `endpoint` value additionally names
 * the resource type (`platform:marketing.campaign_schedule`), so the same
 * client key used for two different platform resources stays two operations.
 */
@Table({
  tableName: 'idempotency_keys',
  timestamps: true,
  updatedAt: false,
  deletedAt: false,
  paranoid: false,
})
export class IdempotencyKey extends BaseModel<IdempotencyKeyAttributes, IdempotencyKeyCreationAttributes> {
  @AllowNull(true)
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, field: 'school_id' })
  declare school_id: string | null;

  @AllowNull(false)
  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, field: 'user_id' })
  declare user_id: string;

  @AllowNull(false)
  @Column({ type: DataType.STRING(255), field: 'endpoint' })
  declare endpoint: string;

  @AllowNull(false)
  @Column({ type: DataType.STRING(255), field: 'idempotency_key' })
  declare idempotency_key: string;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, field: 'response_status' })
  declare response_status: number;

  @AllowNull(false)
  @Column({ type: DataType.JSONB, field: 'response_body' })
  declare response_body: Record<string, unknown>;

  @AllowNull(false)
  @Column({ type: DataType.DATE, field: 'expires_at' })
  declare expires_at: Date;

  @BelongsTo(() => School, { foreignKey: 'school_id', constraints: false })
  declare school?: School;

  @BelongsTo(() => User, { foreignKey: 'user_id', constraints: false })
  declare user?: User;
}
