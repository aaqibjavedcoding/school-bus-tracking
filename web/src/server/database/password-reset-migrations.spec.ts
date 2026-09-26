import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import type { QueryInterface } from 'sequelize';

import * as createPasswordResetTokens from './migrations/20260926150000-create-password-reset-tokens';

/**
 * The `password_reset_tokens` migration, checked **without a database**.
 *
 * Same split as `crew-pin-migrations.spec.ts`: the integration suite
 * (`npm --prefix web run test:db`) proves PostgreSQL accepts the DDL and
 * rolls it back, but it only runs where a database exists. This spec runs
 * everywhere and pins the *intent* of the schema — the properties that make
 * the reset flow safe are properties of these columns and indexes, not of the
 * service code alone:
 *
 * - the table stores a **digest**, and no column could hold a plaintext
 *   token or password;
 * - `used_at` is nullable with no default, because `used_at IS NULL` is the
 *   definition of "the current link";
 * - the digest is **unique**, which is what makes single-use redemption
 *   resolve to at most one row when a user double-clicks the emailed link;
 * - `up` is transactional and `down` fully reverses it.
 */

interface RecordedIndex {
  table: string;
  fields: string[];
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
  await createPasswordResetTokens.up(up as unknown as QueryInterface);
  await createPasswordResetTokens.down(down as unknown as QueryInterface);
  return { up, down, table: up.created.password_reset_tokens };
}

describe('migration 20260926150000-create-password-reset-tokens', () => {
  it('creates the table inside a transaction', async () => {
    const { up } = await run();
    assert.equal(up.transactions, 1, 'a half-applied credential table is not recoverable by hand');
    assert.equal(
      up.transactional.every(Boolean),
      true,
      'every statement must join the transaction',
    );
  });

  it('is fully reversible', async () => {
    const { up, down } = await run();
    assert.deepEqual(Object.keys(up.created), ['password_reset_tokens']);
    assert.deepEqual(down.dropped, ['password_reset_tokens']);
  });

  it('defines exactly the seven intended columns', async () => {
    const { table } = await run();
    assert.deepEqual(Object.keys(table).sort(), [
      'created_at',
      'expires_at',
      'id',
      'requested_ip',
      'token_hash',
      'used_at',
      'user_id',
    ]);
  });

  it('stores a digest and nothing that could hold a plaintext secret', async () => {
    const { table } = await run();
    // The column is named for what it holds, which is the thing a reviewer
    // greps for; and there is no `token`, `password` or `secret` column to be
    // confused with it.
    assert.ok('token_hash' in table);
    for (const forbidden of ['token', 'password', 'password_hash', 'secret', 'raw_token']) {
      assert.equal(forbidden in table, false, `${forbidden} must not exist on this table`);
    }
    assert.equal(sqlType(table.token_hash.type), 'VARCHAR(255)');
    assert.equal(table.token_hash.allowNull, false);
  });

  it('keeps `used_at` nullable with no default, so NULL means "the current link"', async () => {
    const { table } = await run();
    assert.equal(table.used_at.allowNull, true);
    assert.equal(table.used_at.defaultValue, undefined);
  });

  it('requires an expiry: a link with no clock would never die', async () => {
    const { table } = await run();
    assert.equal(table.expires_at.allowNull, false);
    assert.equal(table.expires_at.defaultValue, undefined);
  });

  it('keeps `requested_ip` optional — it is audit-only and never required', async () => {
    const { table } = await run();
    assert.equal(table.requested_ip.allowNull, true);
    // Wide enough for an IPv6 address; the model and its `toJSON()` strip it
    // from every response.
    assert.equal(sqlType(table.requested_ip.type), 'VARCHAR(45)');
  });

  it('cascades from users, and carries no denormalised school_id', async () => {
    const { table } = await run();
    assert.equal(table.user_id.allowNull, false);
    assert.deepEqual(table.user_id.references, { model: 'users', key: 'id' });
    // Deleting the admin must take their outstanding links with them.
    assert.equal(table.user_id.onDelete, 'CASCADE');
    assert.equal(table.user_id.onUpdate, 'CASCADE');
    // The lookup is by digest from an unauthenticated request; the tenant is
    // read from the user row, so a copy here could only ever disagree.
    assert.equal('school_id' in table, false);
  });

  it('uses a UUID primary key like every other table', async () => {
    const { table } = await run();
    assert.equal(table.id.primaryKey, true);
    assert.equal(table.id.allowNull, false);
    assert.equal(sqlType(table.id.type), 'UUID');
  });

  it('makes the digest unique — the concurrency guard behind single use', async () => {
    const { up } = await run();
    const digest = up.indexes.find((index) => index.options.name === 'uq_password_reset_tokens_token_hash');
    assert.ok(digest, 'the token_hash index must exist');
    assert.deepEqual(digest.fields, ['token_hash']);
    assert.equal(digest.options.unique, true);
  });

  it('indexes the two queries the flow actually runs', async () => {
    const { up } = await run();
    const byName = new Map(up.indexes.map((index) => [index.options.name as string, index]));

    // Supersede-on-reissue: "this user's outstanding links".
    assert.deepEqual(byName.get('idx_password_reset_tokens_user_used')?.fields, [
      'user_id',
      'used_at',
    ]);
    // Purge: a range scan on the clock.
    assert.deepEqual(byName.get('idx_password_reset_tokens_expires_at')?.fields, ['expires_at']);
    assert.equal(up.indexes.length, 3, 'no index without a query behind it');
  });

  it('runs after every migration that existed before it', async () => {
    // Sequelize orders by filename, so a new migration must sort last or it
    // will be skipped on an already-migrated database.
    const dir = path.join(__dirname, 'migrations');
    const names = readdirSync(dir)
      .filter((name) => /^\d{14}-.+\.[cm]?[jt]s$/.test(name))
      .sort();
    assert.equal(
      names[names.length - 1],
      '20260926150000-create-password-reset-tokens.ts',
      'this migration must be the newest one',
    );
  });
});
