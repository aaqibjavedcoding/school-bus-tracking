import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { USER_ROLE_VALUES, UserRole } from './enums';
import { School } from './school.model';
import { RouteAssignment } from './route-assignment.model';
import { RunCrew } from './run-crew.model';
import { Trip } from './trip.model';
import { RefreshToken } from './refresh-token.model';
import { CrewPairingToken } from './crew-pairing-token.model';
import { StudentGuardian } from './student-guardian.model';

export interface UserAttributes extends BaseModelAttributes {
  /**
   * Tenant anchor. Non-null for every school-scoped role. A platform
   * `SUPER_ADMIN` is explicitly not a member of any tenant, so this is
   * `null` for platform accounts — the platform-wide unique partial index
   * `uq_users_super_admin_email` guards their login email instead.
   */
  school_id: string | null;
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
  /**
   * bcrypt hash of the crew mobile-login PIN (Mobile-UX Phase 4).
   *
   * Only DRIVER and CONDUCTOR rows may hold one — the database enforces that
   * with the CHECK constraint `ck_users_pin_hash_crew_only`, so the role gate on
   * the login endpoint is backed by a data invariant rather than being
   * application-only. `null` for every other role and for any crew account
   * whose PIN an administrator has not set (or has cleared), which is the state
   * every pre-existing user is in after the migration.
   *
   * Treated exactly like `password_hash`: the same bcrypt cost factor, excluded
   * from the default scope, stripped in `toJSON()`, never logged and never
   * returned by any endpoint. The plaintext PIN is unrecoverable — an
   * administrator who loses one sets a new one.
   */
  pin_hash: string | null;
  /**
   * When `pin_hash` was last written (set, reset or cleared). Kept apart from
   * `updated_at`, which moves on any profile edit, so the admin console can say
   * "PIN set 3 days ago" truthfully.
   */
  pin_updated_at: Date | null;
  /** Set when the email address has been verified. Null until then. */
  email_verified_at: Date | null;
  phone: string | null;
  is_active: boolean;
}

export type UserCreationAttributes = Optional<
  UserAttributes,
  | BaseModelManagedFields
  | 'school_id'
  | 'email'
  | 'phone'
  | 'is_active'
  | 'password_hash'
  | 'pin_hash'
  | 'pin_updated_at'
  | 'email_verified_at'
>;

/**
 * Person that interacts with the platform on behalf of a school.
 *
 * Credentials: `password_hash` holds a bcrypt digest (see `auth/password.util`).
 * Crew accounts (DRIVER / CONDUCTOR) additionally carry `pin_hash`, a bcrypt
 * digest of the 4-digit mobile login PIN introduced in Mobile-UX Phase 4; the
 * database CHECK constraint `ck_users_pin_hash_crew_only` refuses to store a PIN
 * for any other role, so the role gate on `POST /auth/crew-login` is a data
 * invariant and not only an application rule.
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
    // Both credential columns are hidden by default; the login paths opt out
    // with `unscoped()` when they need to compare a digest.
    attributes: { exclude: ['password_hash', 'pin_hash'] },
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
    // Platform accounts (SUPER_ADMIN) have a NULL school_id, so the
    // tenant-scoped unique index above cannot constrain their login email —
    // each NULL is distinct in Postgres. This partial index enforces exactly
    // one platform login per email.
    {
      name: 'uq_users_super_admin_email',
      unique: true,
      fields: ['email'],
      where: { role: 'SUPER_ADMIN', deleted_at: null },
    },
    // No standalone (school_id) index: the unique index above already covers
    // tenant-scoped lookups as its leftmost prefix.
    { name: 'idx_users_school_role', fields: ['school_id', 'role'] },
  ],
})
export class User extends BaseModel<UserAttributes, UserCreationAttributes> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: true })
  declare school_id: string | null;

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

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare pin_hash: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare pin_updated_at: Date | null;

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

  // Per-run roster — the crew day view ("which runs am I on?").
  @HasMany(() => RunCrew, { foreignKey: 'user_id', as: 'runCrew' })
  declare runCrew?: RunCrew[];

  @HasMany(() => Trip, { foreignKey: 'driver_id', as: 'drivenTrips' })
  declare drivenTrips?: Trip[];

  @HasMany(() => Trip, { foreignKey: 'conductor_id', as: 'conductedTrips' })
  declare conductedTrips?: Trip[];

  @HasMany(() => RefreshToken, { foreignKey: 'user_id', as: 'refreshTokens' })
  declare refreshTokens?: RefreshToken[];

  @HasMany(() => CrewPairingToken, { foreignKey: 'user_id', as: 'crewPairingTokens' })
  declare crewPairingTokens?: CrewPairingToken[];

  @HasMany(() => StudentGuardian, { foreignKey: 'user_id', as: 'studentGuardians' })
  declare studentGuardians?: StudentGuardian[];

  /**
   * Strip **both** credential columns even if a query opted out of the default
   * scope. `pin_hash` is a bcrypt digest of a 4-digit secret, so leaking it is
   * worse than leaking a password hash — the space it came from is only
   * 10,000 values wide.
   */
  override toJSON(): object {
    const values = { ...this.get() } as Record<string, unknown>;
    delete values.password_hash;
    delete values.pin_hash;
    return values;
  }
}
