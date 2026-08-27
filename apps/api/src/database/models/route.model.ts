import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { Stop } from './stop.model';
import { RouteAssignment } from './route-assignment.model';
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
 * A route is the *plan* (ordered stops + crew + vehicle through
 * {@link RouteAssignment}); a {@link Trip} is one concrete execution of that
 * plan on a given day.
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

  @HasMany(() => Trip, { foreignKey: 'route_id', as: 'trips' })
  declare trips?: Trip[];
}
