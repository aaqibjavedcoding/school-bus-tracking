import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { Route } from './route.model';
import { Student } from './student.model';

export interface StopAttributes extends BaseModelAttributes {
  school_id: string;
  route_id: string;
  /** Stop label shown to drivers and parents, e.g. "Maple St & 5th Ave". */
  name: string;
  address: string | null;
  /**
   * WGS-84 position of the stop. Nullable until surveyed; populated by the
   * admin UI or by the driver app when the stop is created in the field.
   */
  latitude: number | null;
  longitude: number | null;
  /**
   * Proximity radius (metres) around the stop that counts as "arrived".
   * Geofence evaluation itself arrives with the telemetry pipeline; the
   * per-stop configuration lives here so the data model is already complete.
   */
  geofence_radius_meters: number;
  /**
   * 1-based position of the stop on its route. Unique per route so an ordered
   * manifest can always be rendered deterministically.
   */
  sequence_number: number;
  /** Local wall-clock arrival used for published timetables and ETA baselines. */
  estimated_arrival_time: string | null;
  is_active: boolean;
}

export type StopCreationAttributes = Optional<
  StopAttributes,
  | BaseModelManagedFields
  | 'address'
  | 'latitude'
  | 'longitude'
  | 'geofence_radius_meters'
  | 'estimated_arrival_time'
  | 'is_active'
>;

/**
 * A boarding point on a route.
 *
 * `school_id` is denormalised from the parent route and pinned with the
 * composite foreign key `(school_id, route_id) → routes(school_id, id)`, so a
 * stop can never be attached to a route that belongs to another tenant.
 */
@Table({
  tableName: 'stops',
  modelName: 'Stop',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // Referenced as (school_id, id) by students.home_stop_id.
    { name: 'uq_stops_school_id', unique: true, fields: ['school_id', 'id'] },
    {
      name: 'uq_stops_route_sequence',
      unique: true,
      fields: ['route_id', 'sequence_number'],
      where: { deleted_at: null },
    },
    // Ordered manifest lookup (WHERE route_id = ? AND deleted_at IS NULL
    // ORDER BY sequence_number) is served by the partial unique index above.
    // (school_id, route_id) backs the tenant-pinned composite foreign key.
    { name: 'idx_stops_school_route', fields: ['school_id', 'route_id'] },
  ],
})
export class Stop extends BaseModel<StopAttributes, StopCreationAttributes> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => Route)
  @Column({ type: DataType.UUID, allowNull: false })
  declare route_id: string;

  @Column({ type: DataType.STRING(150), allowNull: false })
  declare name: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare address: string | null;

  @Column({ type: DataType.DOUBLE, allowNull: true })
  declare latitude: number | null;

  @Column({ type: DataType.DOUBLE, allowNull: true })
  declare longitude: number | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 100 })
  declare geofence_radius_meters: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare sequence_number: number;

  @Column({ type: DataType.TIME, allowNull: true })
  declare estimated_arrival_time: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare is_active: boolean;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => Route, { foreignKey: 'route_id', as: 'route' })
  declare route?: Route;

  @HasMany(() => Student, { foreignKey: 'home_stop_id', as: 'students' })
  declare students?: Student[];
}
