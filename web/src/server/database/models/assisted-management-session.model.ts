import { AllowNull, BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, type BaseModelAttributes, type BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { User } from './user.model';

/** Why an assisted-management session was closed. */
export const ASSISTED_SESSION_END_REASONS = {
  EXIT: 'exit',
  SUPERSEDED: 'superseded',
} as const;

export type AssistedSessionEndReasonValue =
  (typeof ASSISTED_SESSION_END_REASONS)[keyof typeof ASSISTED_SESSION_END_REASONS];

/**
 * Attributes exposed to the application layer.
 */
export interface AssistedManagementSessionAttributes extends BaseModelAttributes {
  school_id: string;
  /** The platform SUPER_ADMIN who entered the school (nullable so history survives account removal). */
  actor_user_id: string | null;
  started_at: Date;
  ended_at: Date | null;
  end_reason: AssistedSessionEndReasonValue | null;
  ip_address: string | null;
}

/** Fields auto-managed by the ORM or generated on insert. */
export type AssistedManagementSessionManagedFields =
  BaseModelManagedFields | 'started_at' | 'ended_at' | 'end_reason' | 'ip_address';

export type AssistedManagementSessionCreationAttributes = Optional<
  AssistedManagementSessionAttributes,
  AssistedManagementSessionManagedFields
>;

/**
 * One assisted-management session: a platform SUPER_ADMIN working on the
 * operational data of a specific school without impersonating anyone.
 *
 * The row is the audit/session anchor for the whole feature:
 *
 * - `actor_user_id` is always the Super Admin (never a school account).
 * - `school_id` is always the managed tenant (route-derived, never claimed).
 * - `started_at` / `ended_at` / `end_reason` answer "when and how it ended".
 *
 * Every audit row written while the session is open references the session id
 * in its metadata, so the existing audit trail can answer:
 * **Actor:** Platform/Super Admin · **School:** ABC · **Context:** Assisted Management.
 *
 * Sessions are facts, not mutable state: only `ended_at` / `end_reason` are
 * ever written after creation, and only once (when the session closes).
 */
@Table({
  tableName: 'assisted_management_sessions',
  timestamps: true,
  deletedAt: false,
  paranoid: false,
})
export class AssistedManagementSession extends BaseModel<
  AssistedManagementSessionAttributes,
  AssistedManagementSessionCreationAttributes
> {
  @AllowNull(false)
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, field: 'school_id' })
  declare school_id: string;

  @AllowNull(true)
  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, field: 'actor_user_id' })
  declare actor_user_id: string | null;

  @AllowNull(false)
  @Column({ type: DataType.DATE, field: 'started_at' })
  declare started_at: Date;

  @AllowNull(true)
  @Column({ type: DataType.DATE, field: 'ended_at' })
  declare ended_at: Date | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(40), field: 'end_reason' })
  declare end_reason: AssistedSessionEndReasonValue | null;

  @AllowNull(true)
  @Column({ type: DataType.STRING(45), field: 'ip_address' })
  declare ip_address: string | null;

  @BelongsTo(() => School, { foreignKey: 'school_id', constraints: false })
  declare school?: School;

  @BelongsTo(() => User, { foreignKey: 'actor_user_id', constraints: false })
  declare actor?: User;
}
