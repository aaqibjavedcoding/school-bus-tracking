import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { User } from './user.model';

export interface RefreshTokenAttributes extends BaseModelAttributes {
  school_id: string;
  user_id: string;
  /**
   * SHA-256 hash of the random refresh token. Plaintext tokens are never
   * persisted to the database. Excluded from default scopes and `toJSON()` so
   * it cannot leak into API responses or logs.
   */
  token_hash: string;
  /** UTC timestamp after which this token cannot be used. */
  expires_at: Date;
  /** Timestamp when the token was invalidated (via rotation or logout). */
  revoked_at: Date | null;
  /** Token that succeeded this one during rotation (lineage tracking). */
  replaced_by_token_id: string | null;
}

export type RefreshTokenCreationAttributes = Optional<
  RefreshTokenAttributes,
  BaseModelManagedFields | 'revoked_at' | 'replaced_by_token_id'
>;

/**
 * Persisted refresh token session.
 *
 * Refresh tokens are stored strictly in hashed form (SHA-256).
 * Every token is tenant-scoped via `school_id` and pinned to a user via
 * composite foreign key `(school_id, user_id) -> users(school_id, id)`.
 *
 * Lifecycle:
 * - Created at login or during rotation.
 * - Rotated on `/refresh`: the presented token is revoked (`revoked_at`), and
 *   a newly issued token is linked via `replaced_by_token_id`.
 * - Revoked on `/logout` or if reuse of a revoked token is detected.
 */
@Table({
  tableName: 'refresh_tokens',
  modelName: 'RefreshToken',
  underscored: true,
  timestamps: true,
  paranoid: true,
  defaultScope: {
    attributes: { exclude: ['token_hash'] },
  },
  indexes: [
    {
      name: 'uq_refresh_tokens_token_hash',
      unique: true,
      fields: ['token_hash'],
      where: { deleted_at: null },
    },
    { name: 'idx_refresh_tokens_school_user', fields: ['school_id', 'user_id'] },
    { name: 'idx_refresh_tokens_expires_at', fields: ['expires_at'] },
    { name: 'idx_refresh_tokens_user_revoked', fields: ['user_id', 'revoked_at'] },
  ],
})
export class RefreshToken extends BaseModel<
  RefreshTokenAttributes,
  RefreshTokenCreationAttributes
> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare user_id: string;

  @Column({ type: DataType.STRING(255), allowNull: false })
  declare token_hash: string;

  @Column({ type: DataType.DATE, allowNull: false })
  declare expires_at: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  declare revoked_at: Date | null;

  @ForeignKey(() => RefreshToken)
  @Column({ type: DataType.UUID, allowNull: true })
  declare replaced_by_token_id: string | null;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: User;

  @BelongsTo(() => RefreshToken, { foreignKey: 'replaced_by_token_id', as: 'replacedBy' })
  declare replacedBy?: RefreshToken;

  /**
   * Strip the token hash column even if a query opted out of the default scope.
   */
  override toJSON(): object {
    const values = { ...this.get() } as Record<string, unknown>;
    delete values.token_hash;
    return values;
  }
}
