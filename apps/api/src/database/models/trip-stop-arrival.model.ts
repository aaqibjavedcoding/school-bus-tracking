import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { Trip } from './trip.model';
import { Stop } from './stop.model';

export interface TripStopArrivalAttributes extends BaseModelAttributes {
  school_id: string;
  trip_id: string;
  stop_id: string;
  /** Server clock at which the bus entered the stop's geofence. */
  arrived_at: Date;
  /** WGS-84 position of the bus at the moment of the arrival event. */
  latitude: number;
  longitude: number;
  /** Straight-line (Haversine) metres between the bus and the stop at arrival. */
  distance_meters: number;
}

export type TripStopArrivalCreationAttributes = Optional<
  TripStopArrivalAttributes,
  BaseModelManagedFields | 'arrived_at'
>;

/**
 * One recorded stop-arrival event of one trip (Task 22).
 *
 * Created only when the bus's GPS fix enters a route stop's
 * `geofence_radius_meters` — evaluated by the stop-arrivals pipeline on every
 * accepted *latest* fix. The unique index `uq_trip_stop_arrivals_trip_stop`
 * on `(school_id, trip_id, stop_id)` is the database-level backstop of the
 * duplicate protection: one trip-stop can produce exactly one arrival event,
 * no matter how many fixes arrive inside the geofence afterwards (or how many
 * pipeline instances race to insert it).
 *
 * Both references are tenant-pinned composite foreign keys
 * (`(school_id, trip_id)` → `trips (school_id, id)`,
 * `(school_id, stop_id)` → `stops (school_id, id)`), so an arrival can never
 * mix a trip or stop of another school. The stop is additionally resolved
 * through the trip's own route at evaluation time, so a stop of another
 * route can never be matched either.
 */
@Table({
  tableName: 'trip_stop_arrivals',
  modelName: 'TripStopArrival',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // Duplicate protection: one arrival event per (trip, stop) visit. The
    // tenant is pinned on the key so two schools can never collide.
    {
      name: 'uq_trip_stop_arrivals_trip_stop',
      unique: true,
      fields: ['school_id', 'trip_id', 'stop_id'],
    },
    // Progress reads: "arrivals of this trip, in arrival order".
    {
      name: 'idx_trip_stop_arrivals_school_trip_arrived',
      fields: ['school_id', 'trip_id', 'arrived_at'],
    },
    // Tenant/stop lookups and the tenant-pinned composite foreign key.
    { name: 'idx_trip_stop_arrivals_school_stop', fields: ['school_id', 'stop_id'] },
  ],
})
export class TripStopArrival extends BaseModel<
  TripStopArrivalAttributes,
  TripStopArrivalCreationAttributes
> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => Trip)
  @Column({ type: DataType.UUID, allowNull: false })
  declare trip_id: string;

  @ForeignKey(() => Stop)
  @Column({ type: DataType.UUID, allowNull: false })
  declare stop_id: string;

  @Column({ type: DataType.DATE, allowNull: false })
  declare arrived_at: Date;

  @Column({ type: DataType.DOUBLE, allowNull: false })
  declare latitude: number;

  @Column({ type: DataType.DOUBLE, allowNull: false })
  declare longitude: number;

  @Column({ type: DataType.DOUBLE, allowNull: false })
  declare distance_meters: number;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => Trip, { foreignKey: 'trip_id', as: 'trip' })
  declare trip?: Trip;

  @BelongsTo(() => Stop, { foreignKey: 'stop_id', as: 'stop' })
  declare stop?: Stop;
}
