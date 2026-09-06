import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { Stop } from './stop.model';
import { RouteAssignment } from './route-assignment.model';
import { Run } from './run.model';
import { Trip } from './trip.model';

export interface RouteAttributes extends BaseModelAttributes {
  school_id: string;
  /** Human readable route label, e.g. "North Loop — Morning". */
  name: string;
  /** Short stable code shown on the bus sign and in parent messages. */
  code: string;
  description: string | null;
  is_active: boolean;
}

export type RouteCreationAttributes = Optional<
  RouteAttributes,
  BaseModelManagedFields | 'description' | 'is_active'
>;

/**
 * Named bus route inside a school.
 *
 * A route is the *path*: ordered stops, and nothing else that is time- or
 * vehicle-bound. Which bus drives it, when, and with which crew lives on
 * {@link Run} (one route may have several runs — that is tiering); the crew is
 * rostered per run in `RunCrew`. {@link RouteAssignment} is the pre-refactor
 * route-level roster, still readable but no longer authoritative.
 *
 * A {@link Trip} is one concrete execution of a run on a given day.
 */
@Table({
  tableName: 'routes',
  modelName: 'Route',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // Referenced as (school_id, id) by stops / route_assignments / trips.
    { name: 'uq_routes_school_id', unique: true, fields: ['school_id', 'id'] },
    {
      name: 'uq_routes_school_code',
      unique: true,
      fields: ['school_id', 'code'],
      where: { deleted_at: null },
    },
    // No standalone (school_id) index: `uq_routes_school_id` covers it.
    { name: 'idx_routes_school_active', fields: ['school_id', 'is_active'] },
  ],
})
export class Route extends BaseModel<RouteAttributes, RouteCreationAttributes> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @Column({ type: DataType.STRING(150), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(32), allowNull: false })
  declare code: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare description: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare is_active: boolean;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @HasMany(() => Stop, { foreignKey: 'route_id', as: 'stops' })
  declare stops?: Stop[];

  @HasMany(() => RouteAssignment, { foreignKey: 'route_id', as: 'routeAssignments' })
  declare routeAssignments?: RouteAssignment[];

  // The operating model splits the path (this route) from the vehicle passes
  // over it (`runs`); a route may have several. See
  // `docs/operating-model.md` §2.
  @HasMany(() => Run, { foreignKey: 'route_id', as: 'runs' })
  declare runs?: Run[];

  @HasMany(() => Trip, { foreignKey: 'route_id', as: 'trips' })
  declare trips?: Trip[];
}
