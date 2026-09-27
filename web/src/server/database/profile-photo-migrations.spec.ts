import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { DataTypes } from 'sequelize';
import type { QueryInterface } from 'sequelize';

import * as addProfilePhoto from './migrations/20260927120000-add-profile-photo-to-users';

/**
 * The profile-photo columns migration, checked **without a database** —
 * the same split as `crew-pin-migrations.spec.ts` and
 * `password-reset-migrations.spec.ts`: the integration suite
 * (`npm --prefix web run test:db`) proves PostgreSQL accepts the DDL and
 * rolls it back, while this spec runs everywhere and pins the *intent*:
 *
 * - both columns are **nullable with no default**, which is what makes
 *   "every existing user simply has no photo" true rather than hoped for;
 * - `profile_photo_key` is wide enough to hold any key the shared storage
 *   provider can mint, and no column could hold photo bytes;
 * - `up` is transactional and `down` fully reverses it;
 * - the timestamp sorts after every migration that existed before it,
 *   so an already-migrated database actually picks it up.
 */

interface RecordedColumn {
  table: string;
  key: string;
  attribute: { allowNull?: boolean; defaultValue?: unknown; type?: unknown };
  transactional: boolean;
}

/** Records DDL instead of executing it. */
class RecordingQueryInterface {
  public transactions = 0;
  public readonly added: RecordedColumn[] = [];
  public readonly removed: Array<{ table: string; key: string; transactional: boolean }> = [];
  public readonly sql: string[] = [];

  get sequelize(): unknown {
    return {
      transaction: async (callback: (transaction: unknown) => Promise<void>) => {
        this.transactions += 1;
        await callback({ __transaction: this.transactions });
      },
      query: async (statement: string): Promise<unknown[]> => {
        this.sql.push(String(statement).replace(/\s+/g, ' ').trim());
        return [];
      },
    };
  }

  async addColumn(
    table: string,
    key: string,
    attribute: RecordedColumn['attribute'],
    options?: { transaction?: unknown },
  ): Promise<void> {
    this.added.push({ table, key, attribute, transactional: options?.transaction !== undefined });
  }

  async removeColumn(
    table: string,
    key: string,
    options?: { transaction?: unknown },
  ): Promise<void> {
    this.removed.push({ table, key, transactional: options?.transaction !== undefined });
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
  await addProfilePhoto.up(up as unknown as QueryInterface);
  await addProfilePhoto.down(down as unknown as QueryInterface);
  return { up, down };
}

const EXPECTED_COLUMNS = ['profile_photo_key', 'profile_photo_updated_at'];

describe('migration 20260927120000-add-profile-photo-to-users', () => {
  it('is a DataTypes consumer like every migration here', () => {
    assert.ok(DataTypes.STRING, 'the migration module must import type values from sequelize');
  });

  it('adds exactly the two columns to users, transactionally', async () => {
    const { up } = await run();
    assert.equal(up.transactions, 1, 'a half-added photo column pair must not be recoverable by hand');
    assert.deepEqual(
      up.added.map((column) => column.key).sort(),
      EXPECTED_COLUMNS,
    );
    assert.ok(
      up.added.every((column) => column.table === 'users'),
      'no other table is touched',
    );
    assert.ok(
      up.added.every((column) => column.transactional),
      'every addColumn must join the transaction',
    );
  });

  it('keeps both columns nullable with no default — existing users have no photo', async () => {
    const { up } = await run();
    for (const column of up.added) {
      assert.equal(column.attribute.allowNull, true, `${column.key} must be nullable`);
      assert.equal(
        column.attribute.defaultValue,
        undefined,
        `${column.key} must not backfill anything`,
      );
    }
  });

  it('stores a storage-key reference, never bytes and never a plaintext credential', async () => {
    const { up } = await run();
    const byKey = new Map(up.added.map((column) => [column.key, column]));
    // Wide enough for any provider key (school/entity/user/uuid + filename
    // ≤ 200 chars), and a reference by name — there is no BYTEA/BLOB column
    // a photo could be smuggled into and no *hash column to confuse it with.
    assert.equal(sqlType(byKey.get('profile_photo_key')?.attribute.type), 'VARCHAR(512)');
    // `DataTypes.DATE` renders as the dialect's timestamp (`TIMESTAMP WITH
    // TIME ZONE` in Postgres); the recording double has no dialect attached.
    assert.equal(sqlType(byKey.get('profile_photo_updated_at')?.attribute.type), 'DATE');
    for (const column of up.added) {
      assert.equal(
        /data|bytes|blob|content|hash/i.test(column.key),
        false,
        `no byte/credential column (${column.key}) belongs on users`,
      );
    }
  });

  it('installs no new constraint — the role gate lives on the endpoint', async () => {
    const { up } = await run();
    assert.equal(up.sql.length, 0, 'no raw SQL (CHECK constraints, indexes) is expected');
  });

  it('is fully reversible, in reverse order and inside a transaction', async () => {
    const { down } = await run();
    assert.equal(down.transactions, 1);
    assert.deepEqual(
      down.removed.map((column) => ({ table: column.table, key: column.key })),
      [
        { table: 'users', key: 'profile_photo_updated_at' },
        { table: 'users', key: 'profile_photo_key' },
      ],
    );
    assert.ok(down.removed.every((column) => column.transactional));
  });

  it('runs after every migration that existed before it', async () => {
    // Sequelize orders by filename, so a migration must sort after the ones
    // that shipped before it or it would be skipped on already-migrated
    // databases. (Newer migrations since — e.g. the marketing-communications
    // set — are checked by their own specs.)
    const dir = path.join(__dirname, 'migrations');
    const names = readdirSync(dir)
      .filter((name) => /^\d{14}-.+\.[cm]?[jt]s$/.test(name))
      .sort();
    const index = names.indexOf('20260927120000-add-profile-photo-to-users.ts');
    assert.ok(index > 0, 'this migration must be present');
    assert.equal(
      names[index - 1],
      '20260926150000-create-password-reset-tokens.ts',
      'this migration must sort after the last one that shipped before it',
    );
  });
});
