import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { ROUTE_ASSIGNMENT_ROLE_VALUES, RouteAssignmentRole } from './enums';
import { School } from './school.model';
import { Route } from './route.model';
import { Bus } from './bus.model';
import { User } from './user.model';

export interface RouteAssignmentAttributes extends BaseModelAttributes {
  school_id: string;
  route_id: string;
  /** Vehicle used for this assignment; null while the fleet is undecided. */
  bus_id: string | null;
  /** Crew member (driver or conductor) being assigned. */
  user_id: string;
  /** Role the user plays on the route for the duration of the assignment. */
  role: RouteAssignmentRole;
  /** First day (inclusive, tenant local date) the assignment applies. */
  effective_from: string;
  /** Last day (inclusive). Null means "open ended". */
  effective_to: string | null;
  is_active: boolean;
}

export type RouteAssignmentCreationAttributes = Optional<
  RouteAssignmentAttributes,
  BaseModelManagedFields | 'bus_id' | 'effective_to' | 'is_active'
>;

/**
 * Crew (and optionally vehicle) rostered onto a route for a period of time.
 *
 * One row per person per role, which keeps the design flexible:
 * - a route can carry a driver *and* a conductor (two rows),
 * - a route can rotate crews across terms by closing `effective_to` and
 *   opening a new row,
 * - the same driver can serve several routes.
 *
 * Trips snapshot the crew they actually ran with (`trips.driver_id` /
 * `trips.conductor_id`), so editing or closing an assignment never rewrites
 * history.
 *
 * Every reference is tenant pinned through a composite foreign key on
 * `(school_id, <entity>_id)`, so a roster entry can never mix a user, bus or
 * route from another school.
 */
@Table({
  tableName: 'route_assignments',
  modelName: 'RouteAssignment',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    {
      // The same person cannot be rostered twice for the same role on the
      // same route starting on the same day.
      name: 'uq_route_assignments_route_user_role',
      unique: true,
      fields: ['route_id', 'user_id', 'role', 'effective_from'],
      where: { deleted_at: null },
    },
    // "Who drives route X today?"
    { name: 'idx_route_assignments_route_role', fields: ['route_id', 'role'] },
    // The three (school_id, <entity>_id) indexes back the tenant-pinned
    // composite foreign keys and the tenant-scoped lookups.
    { name: 'idx_route_assignments_school_route', fields: ['school_id', 'route_id'] },
    // "Which routes is this driver rostered on?"
    { name: 'idx_route_assignments_school_user', fields: ['school_id', 'user_id'] },
    { name: 'idx_route_assignments_school_bus', fields: ['school_id', 'bus_id'] },
  ],
})
export class RouteAssignment extends BaseModel<
  RouteAssignmentAttributes,
  RouteAssignmentCreationAttributes
> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => Route)
  @Column({ type: DataType.UUID, allowNull: false })
  declare route_id: string;

  @ForeignKey(() => Bus)
  @Column({ type: DataType.UUID, allowNull: true })
  declare bus_id: string | null;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare user_id: string;

  @Column({ type: DataType.ENUM(...ROUTE_ASSIGNMENT_ROLE_VALUES), allowNull: false })
  declare role: RouteAssignmentRole;

  @Column({ type: DataType.DATEONLY, allowNull: false })
  declare effective_from: string;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare effective_to: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare is_active: boolean;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => Route, { foreignKey: 'route_id', as: 'route' })
  declare route?: Route;

  @BelongsTo(() => Bus, { foreignKey: 'bus_id', as: 'bus' })
  declare bus?: Bus;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: User;
}
