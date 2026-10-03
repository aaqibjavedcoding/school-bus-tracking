'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes, Op } from 'sequelize';

/**
 * Creates `route_geometries` — the forever-cache for road-following route
 * geometry.
 *
 * A route's road shape almost never changes (school stops are surveyed once
 * per term), so the geometry a routing engine produces is computed ONCE and
 * cached here "forever", keyed by `(route_id, stops_hash)` where
 * `stops_hash` is a sha256 of the ordered (stop_id, lat, lng) tuples. Any
 * change to the stop list — reorder, add, remove, move — yields a different
 * hash and therefore a NEW row; the old row stays behind (harmless,
 * unreachable) rather than being mutated, so a cached row's contents never
 * have to be trusted to be re-validated. A school with 20 routes costs 20
 * engine calls in its lifetime — that is what makes the whole feature zero
 * running cost.
 *
 * Design notes:
 *
 *  - `route_id` cascades from `routes`: deleting the route deletes its
 *    cached geometries with it. (No `school_id` copy: the cache is only
 *    ever read through the tenant-pinned route lookup, so a denormalised
 *    tenant key could only ever disagree.)
 *  - `geometry` / `legs` are JSONB in OUR response vocabulary (snake_case,
 *    GeoJSON LineString) — the payload served to clients is the stored
 *    payload, verbatim, so a cache hit costs zero reshaping.
 *  - The unique index is partial (`deleted_at IS NULL`) like every other
 *    soft-delete-aware uniqueness rule in this codebase: a soft-deleted row
 *    must never block a recomputation for the same stop list.
 *  - Absence of a row NEVER means "could not compute" — a failure is not
 *    cached, by design, so the next read simply tries the engine again.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'route_geometries',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        route_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'routes', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        stops_hash: {
          // sha256 hex digest of the ordered located-stop tuples.
          type: DataTypes.STRING(64),
          allowNull: false,
        },
        geometry: {
          // GeoJSON LineString (WGS-84 [lng, lat] pairs), our wire shape.
          type: DataTypes.JSONB,
          allowNull: false,
        },
        distance_meters: {
          type: DataTypes.DOUBLE,
          allowNull: false,
        },
        duration_seconds: {
          type: DataTypes.DOUBLE,
          allowNull: false,
        },
        legs: {
          // [{ distance_meters, duration_seconds, maneuvers: [...] }]
          type: DataTypes.JSONB,
          allowNull: false,
        },
        provider: {
          // engine label, e.g. 'osrm' — kept so a future engine swap can
          // tell its rows apart without a migration.
          type: DataTypes.STRING(32),
          allowNull: false,
        },
        computed_at: {
          // When the engine produced this geometry (set once, at insert).
          type: DataTypes.DATE,
          allowNull: false,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        deleted_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await queryInterface.addConstraint('route_geometries', {
      type: 'check',
      name: 'ck_route_geometries_distance_non_negative',
      fields: ['distance_meters'],
      where: { distance_meters: { [Op.gte]: 0 } },
      transaction,
    });

    await queryInterface.addConstraint('route_geometries', {
      type: 'check',
      name: 'ck_route_geometries_duration_non_negative',
      fields: ['duration_seconds'],
      where: { duration_seconds: { [Op.gte]: 0 } },
      transaction,
    });

    // The cache key. Partial like every soft-delete-unique rule in this
    // codebase: a soft-deleted row must not block a recomputation.
    await queryInterface.addIndex('route_geometries', ['route_id', 'stops_hash'], {
      name: 'uq_route_geometries_route_stops',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('route_geometries');
}
