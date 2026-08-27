import { Column, DataType, HasMany, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { Bus } from './bus.model';
import { Route } from './route.model';
import { RouteAssignment } from './route-assignment.model';
import { Stop } from './stop.model';
import { Student } from './student.model';
import { Trip } from './trip.model';
import { User } from './user.model';
import { RefreshToken } from './refresh-token.model';
import { StudentGuardian } from './student-guardian.model';

export interface SchoolAttributes extends BaseModelAttributes {
  /** Display name of the institution. */
  name: string;
  /**
   * Tenant code — short, stable, human readable identifier used in URLs,
   * reports and integrations (e.g. `lincoln-high`). Unique platform-wide.
   */
  code: string;
  /** Subdomain used for tenant resolution (nullable until assigned). */
  subdomain: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  /** ISO 3166-1 alpha-2 country code. */
  country: string | null;
  /** IANA timezone the school operates in — drives trip scheduling. */
  timezone: string;
  /** Campus position, used later for map centring and geofence baselines. */
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
}

export type SchoolCreationAttributes = Optional<
  SchoolAttributes,
  | BaseModelManagedFields
  | 'subdomain'
  | 'email'
  | 'phone'
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'state'
  | 'postal_code'
  | 'country'
  | 'latitude'
  | 'longitude'
  | 'timezone'
  | 'is_active'
>;

/**
 * Tenant root entity.
 *
 * Every other table in the system carries a `school_id` that points here, so
 * `School` is the anchor of all tenant-scoped queries. It owns no
 * `school_id` column of its own — it *is* the tenant.
 *
 * Tenant integrity is enforced below this row: child tables declare a
 * composite unique index on `(school_id, id)` so their children can reference
 * them with a `(school_id, <entity>_id)` foreign key, which makes it
 * impossible at the database level to attach a resource to a parent that
 * belongs to a different school.
 */
@Table({
  tableName: 'schools',
  modelName: 'School',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    {
      // Soft-deleted tenants must not keep their code/subdomain hostage.
      name: 'uq_schools_code',
      unique: true,
      fields: ['code'],
      where: { deleted_at: null },
    },
    {
      name: 'uq_schools_subdomain',
      unique: true,
      fields: ['subdomain'],
      where: { deleted_at: null },
    },
  ],
})
export class School extends BaseModel<SchoolAttributes, SchoolCreationAttributes> {
  @Column({ type: DataType.STRING(150), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(32), allowNull: false })
  declare code: string;

  @Column({ type: DataType.STRING(63), allowNull: true })
  declare subdomain: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare email: string | null;

  @Column({ type: DataType.STRING(32), allowNull: true })
  declare phone: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare address_line1: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare address_line2: string | null;

  @Column({ type: DataType.STRING(100), allowNull: true })
  declare city: string | null;

  @Column({ type: DataType.STRING(100), allowNull: true })
  declare state: string | null;

  @Column({ type: DataType.STRING(20), allowNull: true })
  declare postal_code: string | null;

  @Column({ type: DataType.STRING(2), allowNull: true })
  declare country: string | null;

  @Column({ type: DataType.STRING(64), allowNull: false, defaultValue: 'UTC' })
  declare timezone: string;

  @Column({ type: DataType.DOUBLE, allowNull: true })
  declare latitude: number | null;

  @Column({ type: DataType.DOUBLE, allowNull: true })
  declare longitude: number | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare is_active: boolean;

  @HasMany(() => User, { foreignKey: 'school_id', as: 'users' })
  declare users?: User[];

  @HasMany(() => Student, { foreignKey: 'school_id', as: 'students' })
  declare students?: Student[];

  @HasMany(() => Bus, { foreignKey: 'school_id', as: 'buses' })
  declare buses?: Bus[];

  @HasMany(() => Route, { foreignKey: 'school_id', as: 'routes' })
  declare routes?: Route[];

  @HasMany(() => Stop, { foreignKey: 'school_id', as: 'stops' })
  declare stops?: Stop[];

  @HasMany(() => RouteAssignment, { foreignKey: 'school_id', as: 'routeAssignments' })
  declare routeAssignments?: RouteAssignment[];

  @HasMany(() => Trip, { foreignKey: 'school_id', as: 'trips' })
  declare trips?: Trip[];

  @HasMany(() => RefreshToken, { foreignKey: 'school_id', as: 'refreshTokens' })
  declare refreshTokens?: RefreshToken[];

  @HasMany(() => StudentGuardian, { foreignKey: 'school_id', as: 'studentGuardians' })
  declare studentGuardians?: StudentGuardian[];
}
