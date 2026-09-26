import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { User } from './user.model';

export interface PasswordResetTokenAttributes extends BaseModelAttributes {
  /** The SCHOOL_ADMIN account the token resets. */
  user_id: string;
  /**
   * SHA-256 digest of the raw reset token (`hashToken()`), the same
   * construction `refresh_tokens` and `crew_pairing_tokens` use. The plaintext
   * only ever exists inside the emailed link; it is never persisted, logged or
   * returned, so a database read — or a leaked backup — cannot resurrect a
   * live reset link. Excluded from the default scope and from `toJSON()`.
   */
  token_hash: string;
  /** UTC instant after which the link cannot be redeemed. */
  expires_at: Date;
  /**
   * Set when the token is spent **or superseded**.
   *
   * Two things write it, and both mean "this link is dead": redeeming it at
   * `POST /auth/reset-password`, and issuing a newer token for the same user
   * (one active link at a time — see `password-reset-tokens.ts`). Keeping the
   * row instead of deleting it is what makes a replay of an old link a
   * *recognisable* no-op rather than an indistinguishable "unknown token".
   */
  used_at: Date | null;
  /**
   * Client IP of the `forgot-password` request that minted the token.
   *
   * **Audit-only, and never returned by any endpoint.** It exists so an
   * administrator investigating a suspicious reset can see where the request
   * came from; it is not read by any application logic, is not part of any
   * response contract, and is stripped by `toJSON()` along with the digest.
   */
  requested_ip: string | null;
}

export type PasswordResetTokenCreationAttributes = Omit<
  PasswordResetTokenAttributes,
  BaseModelManagedFields | 'created_at'
> &
  Partial<Pick<PasswordResetTokenAttributes, BaseModelManagedFields | 'created_at'>>;

/**
 * A single-use, short-lived password-reset link for a **SCHOOL_ADMIN**
 * account.
 *
 * Lifecycle: `POST /auth/forgot-password` mints one (superseding any previous
 * unused one for that user) → the raw token travels only inside the emailed
 * `{APP_URL}/reset-password?token=…` link → `POST /auth/reset-password`
 * redeems it, sets the new `password_hash` and revokes every live refresh
 * token of that account.
 *
 * ### Why there is no `school_id` column
 *
 * `refresh_tokens` and `crew_pairing_tokens` are tenant-pinned because they
 * are looked up *inside* a tenant context (a session belongs to a school, a
 * pairing code is minted by a school admin for one of their crew). A reset
 * token is looked up by nothing but its 256-bit digest, from an
 * unauthenticated request that carries no tenant at all — a `school_id`
 * column would be a denormalised copy of `users.school_id` that no query
 * filters on, and a second place for the two to disagree. The tenant is read
 * from the user row the token points at, which is the only authority there
 * is. (`audit_logs` and `idempotency_keys` reference `users(id)` the same
 * way.)
 *
 * ### Not soft-deleted, not `updated_at`-tracked
 *
 * `used_at` already records the only state transition a row has, and
 * `created_at` records its birth; a paranoid `deleted_at` would just be a
 * third way to say "dead" for a row whose whole life is measured in minutes.
 * Expired and spent rows are purged when the same user requests another
 * reset (see `PasswordResetService`), so the table never accumulates.
 */
@Table({
  tableName: 'password_reset_tokens',
  modelName: 'PasswordResetToken',
  underscored: true,
  timestamps: true,
  updatedAt: false,
  deletedAt: false,
  paranoid: false,
  defaultScope: {
    attributes: { exclude: ['token_hash', 'requested_ip'] },
  },
  indexes: [
    { name: 'uq_password_reset_tokens_token_hash', unique: true, fields: ['token_hash'] },
    { name: 'idx_password_reset_tokens_user_used', fields: ['user_id', 'used_at'] },
    { name: 'idx_password_reset_tokens_expires_at', fields: ['expires_at'] },
  ],
})
export class PasswordResetToken extends BaseModel<
  PasswordResetTokenAttributes,
  PasswordResetTokenCreationAttributes
> {
  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare user_id: string;

  @Column({ type: DataType.STRING(255), allowNull: false })
  declare token_hash: string;

  @Column({ type: DataType.DATE, allowNull: false })
  declare expires_at: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  declare used_at: Date | null;

  @Column({ type: DataType.STRING(45), allowNull: true })
  declare requested_ip: string | null;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: User;

  /**
   * Strips the digest **and** the audit-only IP even if a query opted out of
   * the default scope, so neither can reach a response body or a log line by
   * accident.
   */
  override toJSON(): object {
    const values = { ...this.get() } as Record<string, unknown>;
    delete values.token_hash;
    delete values.requested_ip;
    return values;
  }
}
