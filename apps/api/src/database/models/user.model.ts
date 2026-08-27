import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { USER_ROLE_VALUES, UserRole } from './enums';
import { School } from './school.model';
import { RouteAssignment } from './route-assignment.model';
import { Trip } from './trip.model';
import { RefreshToken } from './refresh-token.model';
import { StudentGuardian } from './student-guardian.model';

export interface UserAttributes extends BaseModelAttributes {
  school_id: string;
  /**
   * Platform role of the account. Stored as the PostgreSQL enum
   * `enum_users_role`; values come from the shared `UserRole` enum so the API,
   * web and mobile clients cannot drift from the database.
   */
  role: UserRole;
  first_name: string;
  last_name: string;
  /**
   * Contact address. Unique per school — two tenants may both employ a
   * `admin@school.org`, but a school may not hold the same address twice.
   * Always stored trimmed and lowercased.
   */
  email: string | null;
  /**
   * bcrypt hash of the user's password. Never store plaintext. Excluded from
   * the default query scope and from `toJSON()` so it is not leaked in API
   * responses.
   */
  password_hash: string | null;
  /** Set when the email address has been verified. Null until then. */
  email_verified_at: Date | null;
  phone: string | null;
  is_active: boolean;
}

export type UserCreationAttributes = Optional<
  UserAttributes,
  BaseModelManagedFields | 'email' | 'phone' | 'is_active' | 'password_hash' | 'email_verified_at'
>;

/**
 * Person that interacts with the platform on behalf of a school.
 *
 * Credentials: `password_hash` holds a bcrypt digest (see `auth/password.util`).
 * JWT, sessions and login/register endpoints are later tasks.
 *
 * Tenant scoping: `school_id` is NOT NULL, so a user can never exist outside a
 * tenant, and every child row references `(school_id, id)` — see
 * {@link RouteAssignment} and {@link Trip} — so an assignment or trip cannot
 * point at a user from another school. Email uniqueness is likewise
 * tenant-scoped (`uq_users_school_email`).
 */
@Table({
  tableName: 'users',
  modelName: 'User',
  underscored: true,
  timestamps: true,
  paranoid: true,
  defaultScope: {
    attributes: { exclude: ['password_hash'] },
  },
  indexes: [
    // Referenced as (school_id, id) by route_assignments.driver/conductor and
    // trips.driver_id / trips.conductor_id.
    { name: 'uq_users_school_id', unique: true, fields: ['school_id', 'id'] },
    {
      name: 'uq_users_school_email',
      unique: true,
      fields: ['school_id', 'email'],
      where: { deleted_at: null },
    },
    // No standalone (school_id) index: the unique index above already covers
    // tenant-scoped lookups as its leftmost prefix.
    { name: 'idx_users_school_role', fields: ['school_id', 'role'] },
  ],
})
export class User extends BaseModel<UserAttributes, UserCreationAttributes> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @Column({ type: DataType.ENUM(...USER_ROLE_VALUES), allowNull: false })
  declare role: UserRole;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare first_name: string;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare last_name: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
    set(this: User, value: string | null | undefined) {
      if (value == null || value === '') {
        this.setDataValue('email', null);
        return;
      }
      this.setDataValue('email', value.trim().toLowerCase());
    },
  })
  declare email: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare password_hash: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare email_verified_at: Date | null;

  @Column({ type: DataType.STRING(32), allowNull: true })
  declare phone: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare is_active: boolean;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @HasMany(() => RouteAssignment, { foreignKey: 'user_id', as: 'routeAssignments' })
  declare routeAssignments?: RouteAssignment[];

  @HasMany(() => Trip, { foreignKey: 'driver_id', as: 'drivenTrips' })
  declare drivenTrips?: Trip[];

  @HasMany(() => Trip, { foreignKey: 'conductor_id', as: 'conductedTrips' })
  declare conductedTrips?: Trip[];

  @HasMany(() => RefreshToken, { foreignKey: 'user_id', as: 'refreshTokens' })
  declare refreshTokens?: RefreshToken[];

  @HasMany(() => StudentGuardian, { foreignKey: 'user_id', as: 'studentGuardians' })
  declare studentGuardians?: StudentGuardian[];

  /**
   * Strip the credential column even if a query opted out of the default scope.
   */
  override toJSON(): object {
    const values = { ...this.get() } as Record<string, unknown>;
    delete values.password_hash;
    return values;
  }
}
