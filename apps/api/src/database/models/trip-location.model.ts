import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { Trip } from './trip.model';

export interface TripLocationAttributes extends BaseModelAttributes {
  school_id: string;
  trip_id: string;
  /** WGS-84 latitude in degrees (-90..90). */
  latitude: number;
  /** WGS-84 longitude in degrees (-180..180). */
  longitude: number;
  /** Horizontal accuracy in metres, as reported by the crew device. */
  accuracy: number | null;
  /** Ground speed in km/h, as reported by the crew device. */
  speed: number | null;
  /** Compass heading in degrees (0..360), as reported by the crew device. */
  heading: number | null;
  /**
   * Device clock at which the fix was taken. Always in the past (or within a
   * small, configurable skew window of) `received_at`; the service layer
   * rejects anything further in the future.
   */
  recorded_at: Date;
  /**
   * Server clock at which the update was received. This is the authoritative
   * receipt time — a client can supply `recorded_at`, never `received_at`.
   */
  received_at: Date;
}

export type TripLocationCreationAttributes = Optional<
  TripLocationAttributes,
  BaseModelManagedFields | 'accuracy' | 'speed' | 'heading' | 'received_at'
>;

/**
 * One accepted GPS fix of one trip, appended as it arrives.
 *
 * The row is an immutable observation: nothing about it is ever updated or
 * edited (the table is append-only in practice — the paranoid soft-delete
 * column exists for parity with every other domain model and for the
 * `deleted_at`-aware partial indexes, not because fixes get deleted).
 *
 * Both references are tenant-pinned through composite foreign keys
 * (`(school_id, trip_id)` → `trips (school_id, id)`), so a fix can never mix
 * a trip from another school. The three supporting indexes back, in order:
 * the chronological history scan, the latest-location lookup and the plain
 * tenant/trip lookup.
 */
@Table({
  tableName: 'trip_locations',
  modelName: 'TripLocation',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // History scan: "the fixes of this trip, in time order".
    {
      name: 'idx_trip_locations_school_trip_recorded',
      fields: ['school_id', 'trip_id', 'recorded_at'],
    },
    // Latest-location lookup: "newest fix of this trip first".
    {
      name: 'idx_trip_locations_school_trip_received',
      fields: ['school_id', 'trip_id', 'received_at'],
    },
    // Tenant/trip lookup: "does this trip have any fix at all?".
    { name: 'idx_trip_locations_school_trip', fields: ['school_id', 'trip_id'] },
  ],
})
export class TripLocation extends BaseModel<
  TripLocationAttributes,
  TripLocationCreationAttributes
> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => Trip)
  @Column({ type: DataType.UUID, allowNull: false })
  declare trip_id: string;

  @Column({ type: DataType.DOUBLE, allowNull: false })
  declare latitude: number;

  @Column({ type: DataType.DOUBLE, allowNull: false })
  declare longitude: number;

  @Column({ type: DataType.DOUBLE, allowNull: true })
  declare accuracy: number | null;

  @Column({ type: DataType.DOUBLE, allowNull: true })
  declare speed: number | null;

  @Column({ type: DataType.DOUBLE, allowNull: true })
  declare heading: number | null;

  @Column({ type: DataType.DATE, allowNull: false })
  declare recorded_at: Date;

  @Column({ type: DataType.DATE, allowNull: false })
  declare received_at: Date;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => Trip, { foreignKey: 'trip_id', as: 'trip' })
  declare trip?: Trip;
}
