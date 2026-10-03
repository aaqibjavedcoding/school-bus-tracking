import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import type { QueryInterface } from 'sequelize';

import * as createRouteGeometries from './migrations/20261003090000-create-route-geometries';

/**
 * The `route_geometries` migration, checked **without a database** — the
 * same split as `crew-pin-migrations.spec.ts` and
 * `password-reset-migrations.spec.ts`: the integration suite
 * (`npm --prefix web run test:db`) proves PostgreSQL accepts the DDL and
 * rolls it back, but it only runs where a database exists. This spec runs
 * everywhere and pins the *intent* of the schema — the properties the
 * forever-cache depends on:
 *
 * - `(route_id, stops_hash)` is UNIQUE among live rows: at most one cached
 *   geometry per stop list, which is what makes compute-on-miss safe under
 *   concurrency;
 * - the unique index is PARTIAL (`deleted_at IS NULL`), matching every
 *   soft-delete-unique rule in this codebase, so a soft-deleted row can
 *   never block a recomputation;
 * - `route_id` cascades from `routes` and there is no denormalised
 *   `school_id` — the cache is only read through the tenant-pinned route;
 * - the pay load columns are JSONB in our own wire vocabulary, and the
 *   numeric totals are CHECK-constrained non-negative;
 * - `up` is transactional and `down` fully reverses it.
 */

interface RecordedIndex {
  table: string;
  fields: string[];
  options: Record<string, unknown>;
}

interface RecordedConstraint {
  table: string;
  options: Record<string, unknown>;
}

interface ColumnSpec {
  type?: unknown;
  allowNull?: boolean;
  primaryKey?: boolean;
  defaultValue?: unknown;
  references?: { model?: string; key?: string };
  onDelete?: string;
  onUpdate?: string;
}

/** Records DDL instead of executing it. */
class RecordingQueryInterface {
  public transactions = 0;
  public readonly created: Record<string, Record<string, ColumnSpec>> = {};
  public readonly dropped: string[] = [];
  public readonly indexes: RecordedIndex[] = [];
  public readonly constraints: RecordedConstraint[] = [];
  /** Whether each recorded call carried a transaction handle. */
  public readonly transactional: boolean[] = [];

  get sequelize(): unknown {
    return {
      transaction: async (callback: (transaction: unknown) => Promise<void>) => {
        this.transactions += 1;
        await callback({ __transaction: this.transactions });
      },
    };
  }

  private noteTransaction(options: unknown): void {
    this.transactional.push(
      (options as { transaction?: unknown } | undefined)?.transaction !== undefined,
    );
  }

  async createTable(
    table: string,
    attributes: Record<string, ColumnSpec>,
    options?: unknown,
  ): Promise<void> {
    this.noteTransaction(options);
    this.created[table] = attributes;
  }

  async addIndex(
    table: string,
    fields: string[],
    options: Record<string, unknown>,
  ): Promise<void> {
    this.noteTransaction(options);
    this.indexes.push({ table, fields, options });
  }

  async addConstraint(table: string, options: Record<string, unknown>): Promise<void> {
    this.constraints.push({ table, options });
  }

  async dropTable(table: string): Promise<void> {
    this.dropped.push(table);
  }
}

/** Renders a Sequelize type to the SQL it would emit. */
function sqlType(value: unknown): string {
  const maybe = value as { toSql?: () => string } | undefined;
  if (maybe && typeof maybe.toSql === 'function') {
    try {
      return maybe.toSql();
    } catch {
      return String(value);
    }
  }
  return String(value);
}

async function run() {
  const up = new RecordingQueryInterface();
  const down = new RecordingQueryInterface();
  await createRouteGeometries.up(up as unknown as QueryInterface);
  await createRouteGeometries.down(down as unknown as QueryInterface);
  return { up, down, table: up.created.route_geometries };
}

describe('migration 20261003090000-create-route-geometries', () => {
  it('creates the table inside a transaction', async () => {
    const { up } = await run();
    assert.equal(up.transactions, 1, 'a half-applied cache table is not recoverable by hand');
    assert.equal(
      up.transactional.every(Boolean),
      true,
      'every statement must join the transaction',
    );
  });

  it('is fully reversible', async () => {
    const { up, down } = await run();
    assert.deepEqual(Object.keys(up.created), ['route_geometries']);
    assert.deepEqual(down.dropped, ['route_geometries']);
  });

  it('defines exactly the intended columns — nothing more to trust', async () => {
    const { table } = await run();
    assert.deepEqual(Object.keys(table).sort(), [
      'computed_at',
      'created_at',
      'deleted_at',
      'distance_meters',
      'duration_seconds',
      'geometry',
      'id',
      'legs',
      'provider',
      'route_id',
      'stops_hash',
      'updated_at',
    ]);
  });

  it('uses a UUID primary key like every other table', async () => {
    const { table } = await run();
    assert.equal(table.id.primaryKey, true);
    assert.equal(table.id.allowNull, false);
    assert.equal(sqlType(table.id.type), 'UUID');
  });

  it('cascades from routes, and carries no denormalised school_id', async () => {
    const { table } = await run();
    assert.equal(table.route_id.allowNull, false);
    assert.deepEqual(table.route_id.references, { model: 'routes', key: 'id' });
    // Deleting the route takes its cached geometries along.
    assert.equal(table.route_id.onDelete, 'CASCADE');
    assert.equal(table.route_id.onUpdate, 'CASCADE');
    // The cache is only ever read through the tenant-pinned route lookup, so
    // a school_id copy here could only ever disagree with it.
    assert.equal('school_id' in table, false);
  });

  it('gives stops_hash exactly the width of a sha256 hex digest', async () => {
    const { table } = await run();
    assert.equal(sqlType(table.stops_hash.type), 'VARCHAR(64)');
    assert.equal(table.stops_hash.allowNull, false);
  });

  it('stores the served payload as JSONB, the totals as doubles', async () => {
    const { table } = await run();
    assert.equal(sqlType(table.geometry.type), 'JSONB');
    assert.equal(table.geometry.allowNull, false);
    assert.equal(sqlType(table.legs.type), 'JSONB');
    assert.equal(table.legs.allowNull, false);
    assert.equal(sqlType(table.distance_meters.type), 'DOUBLE');
    assert.equal(sqlType(table.duration_seconds.type), 'DOUBLE');
  });

  it('records who computed the row and when — both required', async () => {
    const { table } = await run();
    assert.equal(sqlType(table.provider.type), 'VARCHAR(32)');
    assert.equal(table.provider.allowNull, false);
    assert.match(sqlType(table.computed_at.type), /^(TIMESTAMP|DATE)/);
    assert.equal(table.computed_at.allowNull, false);
    assert.equal(table.computed_at.defaultValue, undefined);
  });

  it('carries the standard BaseModel timestamp columns', async () => {
    const { table } = await run();
    assert.equal(table.created_at.allowNull, false);
    assert.equal(table.updated_at.allowNull, false);
    assert.equal(table.deleted_at.allowNull, true);
  });

  it('guards the totals against negative nonsense', async () => {
    const { up } = await run();
    const names = up.constraints.map((constraint) => String(constraint.options.name)).sort();
    assert.deepEqual(names, [
      'ck_route_geometries_distance_non_negative',
      'ck_route_geometries_duration_non_negative',
    ]);
    for (const constraint of up.constraints) {
      assert.equal(constraint.table, 'route_geometries');
      assert.equal(constraint.options.type, 'check');
    }
  });

  it('makes (route_id, stops_hash) unique among live rows — the cache key', async () => {
    const { up } = await run();
    const index = up.indexes.find((i) => i.options.name === 'uq_route_geometries_route_stops');
    assert.ok(index, 'the cache-key index must exist');
    assert.deepEqual(index.fields, ['route_id', 'stops_hash']);
    assert.equal(index.table, 'route_geometries');
    assert.equal(index.options.unique, true);
    // Partial, like every soft-delete-unique rule in this codebase: a
    // soft-deleted row must never block a recomputation of the same stops.
    assert.deepEqual(index.options.where, { deleted_at: null });
  });

  it('runs after every migration that existed before it', async () => {
    // Sequelize orders by filename, so a migration must sort after the ones
    // that shipped before it or it would be skipped on already-migrated
    // databases.
    const dir = path.join(__dirname, 'migrations');
    const names = readdirSync(dir)
      .filter((name) => /^\d{14}-.+\.[cm]?[jt]s$/.test(name))
      .sort();
    const index = names.indexOf('20261003090000-create-route-geometries.ts');
    assert.ok(index > 0, 'this migration must be present');
    assert.equal(names[index - 1], '20261001100000-shrink-stop-geofence-radii.ts');
  });
});
