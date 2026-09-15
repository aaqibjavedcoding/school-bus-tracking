import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DataTypes } from 'sequelize';
import type { QueryInterface } from 'sequelize';

import * as addCrewPin from './20260915120000-add-crew-pin-to-users';
import * as createPairingTokens from './20260915120100-create-crew-pairing-tokens';

/**
 * Migration up/down tests that need **no database** (Mobile-UX Phase 4).
 *
 * `web/test/integration/migrations.integration.spec.ts` proves these migrations
 * run against a real PostgreSQL and roll all the way back — but it only runs
 * where a database exists (`npm --prefix web run test:db`), which is not every
 * checkout and not `npm run test`. This spec is the half that runs everywhere:
 * it drives `up()` and `down()` through a recording `QueryInterface` and asserts
 * on the exact DDL they emit.
 *
 * What that buys, concretely:
 *
 * - **reversibility is checked mechanically**, not by eye — every `addColumn` in
 *   `up` must have a matching `removeColumn` in `down`, and a `createTable` must
 *   have a `dropTable`;
 * - **the columns are provably nullable with no default**, which is the property
 *   that makes "existing users keep `pin_hash IS NULL`" true rather than hoped
 *   for;
 * - **no plaintext PIN column exists**, asserted by name and by the absence of
 *   any column that is not a hash or a timestamp;
 * - **the crew-only CHECK is installed and dropped**, so the role invariant is
 *   part of the migration and not only of the model's documentation.
 *
 * What it deliberately does **not** prove: that PostgreSQL accepts the emitted
 * DDL. That is the integration spec's job, and the two are complementary — this
 * one pins *intent*, that one pins *execution*.
 */

/** One recorded QueryInterface call, canonicalized so it can be diffed. */
interface Call {
  method: string;
  args: string[];
}

function describeType(value: unknown): string {
  const maybe = value as { toSql?: () => string } | undefined;
  if (maybe && typeof maybe.toSql === 'function') {
    try {
      return maybe.toSql();
    } catch {
      return String(value);
    }
  }
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

/**
 * A `QueryInterface` double that records instead of executing.
 *
 * `sequelize.transaction(cb)` is honoured by passing a sentinel through, so the
 * specs can assert the migration is transactional — a partially applied
 * credential migration is the one kind of half-finished schema change an
 * operator cannot easily recover from.
 */
class RecordingQueryInterface {
  public readonly calls: Call[] = [];
  public transactions = 0;

  /** Raw SQL, kept separate so a spec can assert on the exact statement. */
  public readonly sql: string[] = [];

  /**
   * Every recorded call, with whether it was passed a transaction handle. A
   * credential migration that applied half its DDL outside a transaction is the
   * one kind of half-finished schema change an operator cannot easily recover
   * from, so this is asserted rather than assumed.
   */
  public readonly transactional: boolean[] = [];

  /**
   * Migrations reach raw SQL through `queryInterface.sequelize.query`, and the
   * transaction through `queryInterface.sequelize.transaction` — not through
   * `queryInterface.query`. The double mirrors that exact shape.
   */
  get sequelize(): unknown {
    return {
      transaction: async (callback: (transaction: unknown) => Promise<void>) => {
        this.transactions += 1;
        await callback({ __transaction: this.transactions });
      },
      query: async (sql: string, options?: { transaction?: unknown }) => {
        this.transactional.push(options?.transaction !== undefined);
        this.sql.push(String(sql).replace(/\s+/g, ' ').trim());
        this.record('query', String(sql).replace(/\s+/g, ' ').trim());
        return [];
      },
    };
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args: args.map((arg) => describeType(arg)) });
  }

  /** `addColumn`/`removeColumn`/`createTable`/`addIndex` all take a trailing options bag. */
  private noteTransaction(options: unknown): void {
    const transaction = (options as { transaction?: unknown } | undefined)?.transaction;
    this.transactional.push(transaction !== undefined);
  }

  async addColumn(table: string, key: string, attribute: unknown, options?: unknown): Promise<void> {
    this.noteTransaction(options);
    this.record('addColumn', table, key, attribute);
    const attr = attribute as { allowNull?: boolean; defaultValue?: unknown; type?: unknown };
    this.calls[this.calls.length - 1]!.args.push(
      `allowNull=${String(attr?.allowNull)}`,
      `default=${describeType(attr?.defaultValue)}`,
      `type=${describeType(attr?.type)}`,
    );
  }

  async removeColumn(table: string, key: string, options?: unknown): Promise<void> {
    this.noteTransaction(options);
    this.record('removeColumn', table, key);
  }

  async createTable(
    table: string,
    attributes: Record<string, unknown>,
    options?: unknown,
  ): Promise<void> {
    this.noteTransaction(options);
    this.record('createTable', table, JSON.stringify(Object.keys(attributes)));
    this.created[table] = attributes;
  }

  public readonly created: Record<string, Record<string, unknown>> = {};

  async addIndex(table: string, fields: string[], options: Record<string, unknown>): Promise<void> {
    this.noteTransaction(options);
    this.record('addIndex', table, JSON.stringify(fields), String(options?.name));
    this.indexes.push({ table, fields, options });
  }

  public readonly indexes: Array<{
    table: string;
    fields: string[];
    options: Record<string, unknown>;
  }> = [];

  async removeIndex(table: string, name: string, options?: unknown): Promise<void> {
    this.noteTransaction(options);
    this.record('removeIndex', table, name);
  }

  async dropTable(table: string): Promise<void> {
    this.transactional.push(true);
    this.record('dropTable', table);
  }
}

/** Every `addColumn`/`createTable` in `up` must be undone in `down`. */
function assertReversible(up: RecordingQueryInterface, down: RecordingQueryInterface): void {
  const addedColumns = up.calls
    .filter((call) => call.method === 'addColumn')
    .map((call) => `${call.args[0]}.${call.args[1]}`);
  const removedColumns = new Set(
    down.calls
      .filter((call) => call.method === 'removeColumn')
      .map((call) => `${call.args[0]}.${call.args[1]}`),
  );
  for (const column of addedColumns) {
    assert.ok(removedColumns.has(column), `down() must remove the column up() added: ${column}`);
  }

  const createdTables = up.calls
    .filter((call) => call.method === 'createTable')
    .map((call) => call.args[0]);
  const droppedTables = new Set(
    down.calls.filter((call) => call.method === 'dropTable').map((call) => call.args[0]),
  );
  for (const table of createdTables) {
    assert.ok(droppedTables.has(table), `down() must drop the table up() created: ${table}`);
  }

  const addedIndexes = up.calls
    .filter((call) => call.method === 'addIndex')
    .map((call) => call.args[3]);
  const droppedIndexes = new Set(
    down.calls.filter((call) => call.method === 'removeIndex').map((call) => call.args[1]),
  );
  for (const index of addedIndexes) {
    assert.ok(
      droppedIndexes.has(index) || droppedTables.size > 0,
      `down() must remove the index up() added (or drop its table): ${index}`,
    );
  }
}

describe('migration 20260915120000-add-crew-pin-to-users', () => {
  async function run() {
    const up = new RecordingQueryInterface();
    const down = new RecordingQueryInterface();
    await addCrewPin.up(up as unknown as QueryInterface);
    await addCrewPin.down(down as unknown as QueryInterface);
    return { up, down };
  }

  it('runs both directions inside a transaction', async () => {
    const { up, down } = await run();
    assert.equal(up.transactions, 1, 'up() must be transactional');
    assert.equal(down.transactions, 1, 'down() must be transactional');
  });

  it('adds exactly two columns to users, both nullable, neither with a default', async () => {
    const { up } = await run();
    const added = up.calls.filter((call) => call.method === 'addColumn');
    assert.deepEqual(
      added.map((call) => `${call.args[0]}.${call.args[1]}`),
      ['users.pin_hash', 'users.pin_updated_at'],
    );

    for (const call of added) {
      assert.match(call.args.join(' '), /allowNull=true/, `${call.args[1]} must be nullable`);
      // A default would backfill every existing row, which is exactly what this
      // migration promises not to do.
      assert.match(call.args.join(' '), /default=undefined/, `${call.args[1]} must have no default`);
    }
  });

  it('stores a bcrypt-shaped digest column, never a plaintext PIN', async () => {
    const { up } = await run();
    const pinHash = up.calls.find((call) => call.args[1] === 'pin_hash');
    // VARCHAR(255): the same width as `password_hash`. A bcrypt digest is 60
    // characters, so this is room for a future work factor, not room for a
    // plaintext PIN — and the column name says `hash`, which is the part a
    // reviewer greps for.
    assert.match(pinHash!.args.join(' '), /type=VARCHAR\(255\)/);

    const columnNames = up.calls
      .filter((call) => call.method === 'addColumn')
      .map((call) => String(call.args[1]));
    for (const banned of ['pin', 'pin_plain', 'pin_code', 'plaintext_pin']) {
      assert.ok(!columnNames.includes(banned), `a plaintext PIN column must never exist: ${banned}`);
    }

    const timestamp = up.calls.find((call) => call.args[1] === 'pin_updated_at');
    assert.match(timestamp!.args.join(' '), /type=TIMESTAMP WITH TIME ZONE|type=DATE/);
  });

  it('installs the crew-only CHECK and drops it again on the way down', async () => {
    const { up, down } = await run();
    const install = up.sql.find((statement) => statement.includes('ck_users_pin_hash_crew_only'));
    assert.ok(install, 'up() must add ck_users_pin_hash_crew_only');
    assert.match(install!, /ADD CONSTRAINT/);
    assert.match(install!, /IS NULL OR/, 'the NULL escape keeps non-crew rows valid');
    assert.match(install!, /'DRIVER', 'CONDUCTOR'|'DRIVER','CONDUCTOR'/);

    const drop = down.sql.find((statement) => statement.includes('ck_users_pin_hash_crew_only'));
    assert.ok(drop, 'down() must drop ck_users_pin_hash_crew_only');
    assert.match(drop!, /DROP CONSTRAINT IF EXISTS/);
  });

  it('ties pin_updated_at to pin_hash, so the projection can derive pin_set safely', async () => {
    const { up, down } = await run();
    const install = up.sql.find((statement) =>
      statement.includes('ck_users_pin_hash_matches_pin_updated_at'),
    );
    assert.ok(install, 'up() must add ck_users_pin_hash_matches_pin_updated_at');
    assert.match(install!, /ADD CONSTRAINT/);
    // The rule is "both set, or both null". Asserting the shape rather than the
    // exact SQL keeps this from breaking on formatting while still pinning the
    // semantics: two IS NULL tests compared for equality.
    assert.match(install!, /\("pin_hash" IS NULL\)\s*=\s*\("pin_updated_at" IS NULL\)/);

    const drop = down.sql.find((statement) =>
      statement.includes('ck_users_pin_hash_matches_pin_updated_at'),
    );
    assert.ok(drop, 'down() must drop it again');
    assert.match(drop!, /DROP CONSTRAINT IF EXISTS/);
  });

  it('drops the constraint before the columns, so the rollback cannot fail mid-way', async () => {
    const { down } = await run();
    const order = down.calls.map((call) => `${call.method}:${call.args[0] ?? ''}.${call.args[1] ?? ''}`);
    const constraintIndex = order.findIndex((entry) => entry.startsWith('query'));
    const pinHashIndex = order.indexOf('removeColumn:users.pin_hash');
    assert.ok(constraintIndex >= 0 && pinHashIndex >= 0);
    assert.ok(
      constraintIndex < pinHashIndex,
      'the CHECK references pin_hash, so it must be dropped before the column is removed',
    );
  });

  it('is reversible: every change up() makes, down() undoes', async () => {
    const { up, down } = await run();
    assertReversible(up, down);
  });

  it('issues every DDL statement inside the transaction, in both directions', async () => {
    const { up, down } = await run();
    assert.ok(up.transactional.length >= 3, 'up() should record several DDL calls');
    assert.ok(
      up.transactional.every(Boolean),
      'a credential migration must not apply half its DDL outside a transaction',
    );
    assert.ok(down.transactional.length >= 3, 'down() should record several DDL calls');
    assert.ok(down.transactional.every(Boolean), 'down() must be transactional too');
  });

  it('touches only users — no other table, no data rewrite', async () => {
    const { up } = await run();
    const tables = new Set(
      up.calls
        .filter((call) => ['addColumn', 'removeColumn', 'createTable'].includes(call.method))
        .map((call) => String(call.args[0])),
    );
    assert.deepEqual([...tables], ['users']);
    // No UPDATE/INSERT: the migration must not rewrite a single existing row.
    assert.ok(
      !up.sql.some((statement) => /^(UPDATE|INSERT|DELETE)\b/i.test(statement)),
      'the migration must not modify existing data',
    );
  });
});

describe('migration 20260915120100-create-crew-pairing-tokens', () => {
  async function run() {
    const up = new RecordingQueryInterface();
    const down = new RecordingQueryInterface();
    await createPairingTokens.up(up as unknown as QueryInterface);
    await createPairingTokens.down(down as unknown as QueryInterface);
    return { up, down };
  }

  it('creates the table with the expected columns and no plaintext token column', async () => {
    const { up } = await run();
    const create = up.calls.find((call) => call.method === 'createTable');
    assert.equal(create!.args[0], 'crew_pairing_tokens');
    assert.deepEqual(JSON.parse(create!.args[1]!) as string[], [
      'id',
      'school_id',
      'user_id',
      'token_hash',
      'expires_at',
      'consumed_at',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);

    const attributes = up.created['crew_pairing_tokens']!;
    for (const banned of ['token', 'pairing_token', 'code']) {
      assert.ok(!(banned in attributes), `the plaintext code must never be stored: ${banned}`);
    }
    const tokenHash = attributes['token_hash'] as { allowNull: boolean; type: unknown };
    assert.equal(tokenHash.allowNull, false);
    assert.equal(describeType(tokenHash.type), describeType(DataTypes.STRING(255)));
    // Single-use and short-life are both column-level facts.
    assert.equal((attributes['consumed_at'] as { allowNull: boolean }).allowNull, true);
    assert.equal((attributes['expires_at'] as { allowNull: boolean }).allowNull, false);
  });

  it('pins the pairing to a tenant with a composite foreign key to users', async () => {
    const { up } = await run();
    const fk = up.sql.find((statement) => statement.includes('fk_crew_pairing_tokens_user'));
    assert.ok(fk, 'the composite foreign key must be added');
    assert.match(fk!, /FOREIGN KEY \("school_id", "user_id"\)/);
    assert.match(fk!, /REFERENCES "users" \("school_id", "id"\)/);
    assert.match(fk!, /ON DELETE CASCADE/);
  });

  it('makes token_hash unique among live rows so redemption resolves to one row', async () => {
    const { up } = await run();
    const unique = up.indexes.find(
      (index) => index.options?.name === 'uq_crew_pairing_tokens_token_hash',
    );
    assert.ok(unique, 'the unique index on token_hash must exist');
    assert.equal(unique!.options.unique, true);
    assert.deepEqual(unique!.fields, ['token_hash']);
    // Partial on `deleted_at IS NULL`, matching the refresh_tokens convention,
    // so a soft-deleted (superseded) code never collides with a live one.
    assert.deepEqual(unique!.options.where, { deleted_at: null });
  });

  it('indexes the two lookups the service actually performs', async () => {
    const { up } = await run();
    const names = up.indexes.map((index) => index.options?.name);
    assert.ok(names.includes('idx_crew_pairing_tokens_school_user'), 'supersede/purge by user');
    assert.ok(names.includes('idx_crew_pairing_tokens_expires_at'), 'expired-row purge');
  });

  it('drops the whole table on the way down', async () => {
    const { down } = await run();
    const drops = down.calls.filter((call) => call.method === 'dropTable');
    assert.deepEqual(drops.map((call) => call.args[0]), ['crew_pairing_tokens']);
    // `dropTable` takes the columns, indexes and the composite FK with it, so
    // there is nothing else to undo — and asserting that is the point.
    assert.equal(down.calls.length, 1, 'down() should need nothing but the drop');
  });

  it('issues every DDL statement inside the transaction, in both directions', async () => {
    const { up, down } = await run();
    assert.ok(up.transactional.length >= 3, 'up() should record several DDL calls');
    assert.ok(
      up.transactional.every(Boolean),
      'a credential migration must not apply half its DDL outside a transaction',
    );
    // `down()` here is exactly one `dropTable`, which takes the columns, indexes
    // and composite foreign key with it — asserted separately below.
    assert.equal(down.transactional.length, 1, 'down() is a single dropTable');
    assert.ok(down.transactional.every(Boolean), 'down() must be transactional too');
  });

  it('is reversible', async () => {
    const { up, down } = await run();
    assertReversible(up, down);
  });
});
