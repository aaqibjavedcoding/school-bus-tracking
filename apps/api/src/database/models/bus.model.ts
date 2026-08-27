import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { RouteAssignment } from './route-assignment.model';
import { Trip } from './trip.model';

export interface BusAttributes extends BaseModelAttributes {
  school_id: string;
  /** Licence plate / government registration — unique inside a tenant. */
  registration_number: string;
  /** Optional operator fleet number painted on the vehicle. */
  bus_number: string | null;
  /** Seated capacity including the conductor. Enforced > 0 by a CHECK. */
  capacity: number;
  /**
   * Fleet availability flag. A deactivated bus stays in the database (history
   * keeps referencing it) but is excluded from new assignments and trips.
   */
  is_active: boolean;
}

export type BusCreationAttributes = Optional<
  BusAttributes,
  BaseModelManagedFields | 'bus_number' | 'is_active'
>;

/**
 * Physical vehicle owned by a school.
 *
 * Operational state (en route / at stop / delayed / emergency) is modelled by
 * the shared `VehicleStatus` enum once live telemetry lands; the table only
 * carries the fleet facts plus the active/inactive lifecycle flag here.
 */
@Table({
  tableName: 'buses',
  modelName: 'Bus',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // Referenced as (school_id, id) by route_assignments.bus_id / trips.bus_id.
    { name: 'uq_buses_school_id', unique: true, fields: ['school_id', 'id'] },
    {
      name: 'uq_buses_school_registration',
      unique: true,
      fields: ['school_id', 'registration_number'],
      where: { deleted_at: null },
    },
    {
      name: 'uq_buses_school_bus_number',
      unique: true,
      fields: ['school_id', 'bus_number'],
      where: { deleted_at: null },
    },
    // No standalone (school_id) index: `uq_buses_school_id` covers it.
    { name: 'idx_buses_school_active', fields: ['school_id', 'is_active'] },
  ],
})
export class Bus extends BaseModel<BusAttributes, BusCreationAttributes> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @Column({ type: DataType.STRING(32), allowNull: false })
  declare registration_number: string;

  @Column({ type: DataType.STRING(32), allowNull: true })
  declare bus_number: string | null;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare capacity: number;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare is_active: boolean;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @HasMany(() => RouteAssignment, { foreignKey: 'bus_id', as: 'routeAssignments' })
  declare routeAssignments?: RouteAssignment[];

  @HasMany(() => Trip, { foreignKey: 'bus_id', as: 'trips' })
  declare trips?: Trip[];
}
