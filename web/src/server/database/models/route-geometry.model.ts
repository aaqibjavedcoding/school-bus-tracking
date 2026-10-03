import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import type {
  RouteGeometryLeg,
  RouteGeometryLineString,
} from '@school-bus-tracking/shared-types';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { Route } from './route.model';

export interface RouteGeometryAttributes extends BaseModelAttributes {
  /** Route this geometry belongs to; cascades with it. */
  route_id: string;
  /**
   * Cache key: sha256 hex of the ordered located (stop_id, lat, lng)
   * tuples. Any stop-list change computes a new row under a new hash; rows
   * are never mutated.
   */
  stops_hash: string;
  /** GeoJSON LineString (WGS-84 [lng, lat] pairs) — the served wire shape. */
  geometry: RouteGeometryLineString;
  /** Total road distance of the route, metres. */
  distance_meters: number;
  /** Total driving duration of the route, seconds. */
  duration_seconds: number;
  /** Stop-to-stop sections with turn-by-turn maneuvers. */
  legs: RouteGeometryLeg[];
  /** Routing engine that produced the geometry (e.g. `osrm`). */
  provider: string;
  /** When the engine computed this row (set once, at insert). */
  computed_at: Date;
}

export type RouteGeometryCreationAttributes = Optional<
  RouteGeometryAttributes,
  BaseModelManagedFields
>;

/**
 * Cached road-following geometry of one route and one stop list.
 *
 * The forever-cache behind "compute once, serve forever": for a given
 * `(route_id, stops_hash)` at most one live row exists (partial unique
 * index), so a geometry read is a point lookup and a school with 20 routes
 * costs its routing engine 20 calls in its lifetime. Lookups always go
 * through the tenant-pinned route, which is why this table carries no
 * `school_id` copy. Failures are deliberately NOT rows — absence means
 * "not computed yet", never "uncomputable".
 */
@Table({
  tableName: 'route_geometries',
  modelName: 'RouteGeometry',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    {
      name: 'uq_route_geometries_route_stops',
      unique: true,
      fields: ['route_id', 'stops_hash'],
      where: { deleted_at: null },
    },
  ],
})
export class RouteGeometry extends BaseModel<
  RouteGeometryAttributes,
  RouteGeometryCreationAttributes
> {
  @ForeignKey(() => Route)
  @Column({ type: DataType.UUID, allowNull: false })
  declare route_id: string;

  @Column({ type: DataType.STRING(64), allowNull: false })
  declare stops_hash: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare geometry: RouteGeometryLineString;

  @Column({ type: DataType.DOUBLE, allowNull: false })
  declare distance_meters: number;

  @Column({ type: DataType.DOUBLE, allowNull: false })
  declare duration_seconds: number;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare legs: RouteGeometryLeg[];

  @Column({ type: DataType.STRING(32), allowNull: false })
  declare provider: string;

  @Column({ type: DataType.DATE, allowNull: false })
  declare computed_at: Date;

  @BelongsTo(() => Route, { foreignKey: 'route_id', as: 'route' })
  declare route?: Route;
}
