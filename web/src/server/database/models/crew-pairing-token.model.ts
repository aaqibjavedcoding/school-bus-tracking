import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { User } from './user.model';

export interface CrewPairingTokenAttributes extends BaseModelAttributes {
  /** Tenant anchor. A pairing code always belongs to a school. */
  school_id: string;
  /** The DRIVER or CONDUCTOR a redeemed code logs a device in as. */
  user_id: string;
  /**
   * SHA-256 digest of the random pairing token. The plaintext is handed to the
   * administrator once, at generation, and is never persisted — so a database
   * read (or a leaked backup) cannot resurrect a live code. Excluded from the
   * default scope and from `toJSON()` so it cannot leak into a response or log.
   */
  token_hash: string;
  /** UTC instant after which the code cannot be redeemed. */
  expires_at: Date;
  /**
   * Set by the atomic redeem statement when the code is used. Single-use is a
   * property of that statement, not of application ordering: it updates
   * `WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > now()`, so
   * of N concurrent scans exactly one matches a row.
   */
  consumed_at: Date | null;
}

export type CrewPairingTokenCreationAttributes = Optional<
  CrewPairingTokenAttributes,
  BaseModelManagedFields | 'consumed_at'
>;

/**
 * A short-lived, single-use QR pairing code for crew mobile login
 * (Mobile-UX Phase 4).
 *
 * Lifecycle: minted by a SCHOOL_ADMIN for one crew account → rendered as a QR
 * in the admin console → scanned by the phone app → redeemed for an ordinary
 * session (the same JWT + refresh-token rotation `POST /auth/login` produces).
 * Minting a new code for a user supersedes any outstanding one, so the table
 * holds at most a handful of rows per crew member.
 *
 * Tenant scoping follows `RefreshToken` exactly: `(school_id, user_id)` is a
 * composite foreign key to `users(school_id, id)`, so a code can never pair a
 * device to a user in another tenant.
 */
@Table({
  tableName: 'crew_pairing_tokens',
  modelName: 'CrewPairingToken',
  underscored: true,
  timestamps: true,
  paranoid: true,
  defaultScope: {
    attributes: { exclude: ['token_hash'] },
  },
  indexes: [
    {
      name: 'uq_crew_pairing_tokens_token_hash',
      unique: true,
      fields: ['token_hash'],
      where: { deleted_at: null },
    },
    { name: 'idx_crew_pairing_tokens_school_user', fields: ['school_id', 'user_id'] },
    { name: 'idx_crew_pairing_tokens_expires_at', fields: ['expires_at'] },
  ],
})
export class CrewPairingToken extends BaseModel<
  CrewPairingTokenAttributes,
  CrewPairingTokenCreationAttributes
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
  declare consumed_at: Date | null;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: User;

  /**
   * Strip the digest even if a query opted out of the default scope.
   */
  override toJSON(): object {
    const values = { ...this.get() } as Record<string, unknown>;
    delete values.token_hash;
    return values;
  }
}
