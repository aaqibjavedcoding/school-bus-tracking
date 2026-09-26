import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import type { TripStopArrivalSource } from '@school-bus-tracking/shared-types';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { Trip } from './trip.model';
import { Stop } from './stop.model';
import { User } from './user.model';

export interface TripStopArrivalAttributes extends BaseModelAttributes {
  school_id: string;
  trip_id: string;
  stop_id: string;
  /** Server clock at which the bus entered the stop's geofence. */
  arrived_at: Date;
  /**
   * WGS-84 position of the bus at the moment of the arrival event. `null`
   * for a crew-marked stop: nothing was measured, and a stand-in coordinate
   * would be indistinguishable from a real fix downstream.
   */
  latitude: number | null;
  longitude: number | null;
  /** Straight-line (Haversine) metres to the stop; `null` when crew-marked. */
  distance_meters: number | null;
  /** `geofence` (the GPS pipeline) or `crew` (a driver/conductor tap). */
  source: TripStopArrivalSource;
  /**
   * The crew's own words for why the stop was skipped — non-null **only** on
   * a skip, which is what makes `skip_reason !== null` the single test for
   * "the run passed this stop without serving it".
   */
  skip_reason: string | null;
  /** The crew member who marked it; `null` for a geofence arrival. */
  recorded_by: string | null;
}

export type TripStopArrivalCreationAttributes = Optional<
  TripStopArrivalAttributes,
  | BaseModelManagedFields
  | 'arrived_at'
  | 'latitude'
  | 'longitude'
  | 'distance_meters'
  | 'source'
  | 'skip_reason'
  | 'recorded_by'
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

  @Column({ type: DataType.DOUBLE, allowNull: true })
  declare latitude: number | null;

  @Column({ type: DataType.DOUBLE, allowNull: true })
  declare longitude: number | null;

  @Column({ type: DataType.DOUBLE, allowNull: true })
  declare distance_meters: number | null;

  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'geofence' })
  declare source: TripStopArrivalSource;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare skip_reason: string | null;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: true })
  declare recorded_by: string | null;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => Trip, { foreignKey: 'trip_id', as: 'trip' })
  declare trip?: Trip;

  @BelongsTo(() => Stop, { foreignKey: 'stop_id', as: 'stop' })
  declare stop?: Stop;

  @BelongsTo(() => User, { foreignKey: 'recorded_by', as: 'recorder' })
  declare recorder?: User;
}
