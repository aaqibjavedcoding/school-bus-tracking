import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { TRIP_STATUS_VALUES, TripStatus } from './enums';
import { School } from './school.model';
import { Route } from './route.model';
import { Bus } from './bus.model';
import { User } from './user.model';

export interface TripAttributes extends BaseModelAttributes {
  school_id: string;
  route_id: string;
  /** Vehicle that runs the trip; null until dispatch assigns one. */
  bus_id: string | null;
  /**
   * Crew snapshots taken from the roster at dispatch time. Stored directly on
   * the trip (instead of only referencing a `route_assignments` row) so a
   * mid-route crew swap and ad-hoc trips stay auditable.
   */
  driver_id: string | null;
  conductor_id: string | null;
  status: TripStatus;
  /** Planned departure (timestamptz — always stored in UTC). */
  scheduled_start_at: Date;
  /** Planned completion; null for open ended runs. */
  scheduled_end_at: Date | null;
  /** Recorded when the crew starts boarding at the first stop. */
  actual_start_at: Date | null;
  /** Recorded when the final stop is reached. */
  actual_end_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
}

export type TripCreationAttributes = Optional<
  TripAttributes,
  | BaseModelManagedFields
  | 'bus_id'
  | 'driver_id'
  | 'conductor_id'
  | 'status'
  | 'scheduled_end_at'
  | 'actual_start_at'
  | 'actual_end_at'
  | 'cancelled_at'
  | 'cancellation_reason'
>;

/**
 * One concrete execution of a route on a specific day.
 *
 * The trip keeps both the *plan* (`scheduled_*`) and the *reality*
 * (`actual_*`, `status`) so delay reporting and attendance audits never depend
 * on mutable route data. Live positions, stop events and notifications attach
 * to a trip in later phases; this table is the anchor they will reference.
 *
 * Uniqueness: a route may only have one open (non-deleted) trip per scheduled
 * departure — see `uq_trips_route_scheduled_start`.
 */
@Table({
  tableName: 'trips',
  modelName: 'Trip',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    {
      name: 'uq_trips_route_scheduled_start',
      unique: true,
      fields: ['route_id', 'scheduled_start_at'],
      where: { deleted_at: null },
    },
    // Dispatcher views: "today's trips for this tenant, newest first".
    { name: 'idx_trips_school_scheduled_start', fields: ['school_id', 'scheduled_start_at'] },
    // Operations views: "everything still running".
    { name: 'idx_trips_school_status', fields: ['school_id', 'status'] },
    // (school_id, <entity>_id) indexes back the tenant-pinned composite
    // foreign keys (bus / driver / conductor) and their per-tenant lookups.
    { name: 'idx_trips_school_bus', fields: ['school_id', 'bus_id'] },
    { name: 'idx_trips_school_driver', fields: ['school_id', 'driver_id'] },
    { name: 'idx_trips_school_conductor', fields: ['school_id', 'conductor_id'] },
  ],
})
export class Trip extends BaseModel<TripAttributes, TripCreationAttributes> {
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
  @Column({ type: DataType.UUID, allowNull: true })
  declare driver_id: string | null;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: true })
  declare conductor_id: string | null;

  @Column({
    type: DataType.ENUM(...TRIP_STATUS_VALUES),
    allowNull: false,
    defaultValue: TripStatus.SCHEDULED,
  })
  declare status: TripStatus;

  @Column({ type: DataType.DATE, allowNull: false })
  declare scheduled_start_at: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  declare scheduled_end_at: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare actual_start_at: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare actual_end_at: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare cancelled_at: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare cancellation_reason: string | null;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => Route, { foreignKey: 'route_id', as: 'route' })
  declare route?: Route;

  @BelongsTo(() => Bus, { foreignKey: 'bus_id', as: 'bus' })
  declare bus?: Bus;

  @BelongsTo(() => User, { foreignKey: 'driver_id', as: 'driver' })
  declare driver?: User;

  @BelongsTo(() => User, { foreignKey: 'conductor_id', as: 'conductor' })
  declare conductor?: User;
}
