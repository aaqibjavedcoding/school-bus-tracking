import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import { BASE_MODEL_TIMESTAMP_COLUMNS, baseModelTableNames } from './base-model-tables';
import { ADDED_TIMESTAMP_COLUMNS } from './migrations/20260928170000-align-base-model-timestamp-columns';

/**
 * The BaseModel timestamp contract, checked against the migrations without a
 * database.
 *
 * Every model extends `BaseModel`, which **maps** `created_at`, `updated_at`
 * and `deleted_at` as attributes. `updatedAt: false` / `deletedAt: false` on
 * the `@Table` decorator stop Sequelize *writing* them; they do not remove
 * the attributes. On PostgreSQL, Sequelize appends a `RETURNING` clause that
 * names every mapped attribute, so a table missing one of those columns makes
 * `Model.create()` fail outright:
 *
 *   column "updated_at" does not exist
 *
 * That is invisible to stubbed unit tests and has already cost this project
 * two incidents (`audit_logs`, then the marketing tables). The DB-backed
 * guard lives in `test/integration/migrations.integration.spec.ts`; this one
 * runs in the fast suite so the mistake is caught in the same minute it is
 * written.
 */

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Replays the migration sources to work out which columns each table ends up
 * with. Deliberately textual: it needs no database, and it understands the
 * three shapes this repository uses — `createTable('x', { col: { … } })`,
 * `addColumn('x', 'col', …)` and raw `CREATE TABLE x ( … )` SQL.
 *
 * `removeColumn` is ignored on purpose: in this repository it only appears in
 * `down()` bodies, which would undo what `up()` just added.
 */
function columnsByTable(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const add = (table: string, column: string): void => {
    const columns = tables.get(table) ?? new Set<string>();
    columns.add(column);
    tables.set(table, columns);
  };

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .sort();

  for (const file of files) {
    const source = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    // queryInterface.createTable('x', { column: { … } })
    for (const match of source.matchAll(/createTable\(\s*'([a-zA-Z_]+)'/g)) {
      const block = source.slice(match.index ?? 0, (match.index ?? 0) + 12_000);
      for (const column of block.matchAll(/\n\s+([a-z_]+):\s*\{/g)) {
        add(match[1], column[1]);
      }
    }

    // Raw `CREATE TABLE x ( col TYPE …, … )` inside a template literal.
    for (const match of source.matchAll(
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z_]+)\s*\(([\s\S]*?)\n\s*\)/g,
    )) {
      for (const column of match[2].matchAll(/\n\s+([a-z_]+)\s+[A-Z]/g)) {
        add(match[1], column[1]);
      }
    }

    // queryInterface.addColumn('x', 'column', …)
    for (const match of source.matchAll(/addColumn\(\s*'([a-zA-Z_]+)',\s*'([a-z_]+)'/g)) {
      add(match[1], match[2]);
    }
  }

  // The alignment migration adds its columns through an exported table, which
  // the textual scan cannot see (the calls are a loop, not literals).
  for (const [table, column] of ADDED_TIMESTAMP_COLUMNS) {
    add(table, column);
  }

  return tables;
}

describe('BaseModel timestamp columns', () => {
  const tables = columnsByTable();
  const baseModelTables = baseModelTableNames();

  it('parses the migration sources it is about to reason over', () => {
    // Guards the parser itself: without this, a broken regex would make every
    // check below pass vacuously.
    assert.ok(tables.size > 20, `expected to parse many tables, got ${tables.size}`);
    for (const table of [
      'schools',
      'audit_logs',
      'marketing_leads',
      'marketing_lead_events',
      // raw-SQL tables — the shape that hid the Hardening 5B omission
      'marketing_notification_jobs',
      'marketing_attributions',
    ]) {
      assert.ok(tables.has(table), `parser missed ${table}`);
    }
    assert.ok(baseModelTables.length > 20, 'expected many BaseModel-backed tables');
  });

  it('gives every BaseModel-backed table the three mapped timestamp columns', () => {
    const offenders: string[] = [];
    for (const table of baseModelTables) {
      const columns = tables.get(table);
      if (!columns) {
        offenders.push(`${table} (no migration creates it)`);
        continue;
      }
      const missing = BASE_MODEL_TIMESTAMP_COLUMNS.filter((column) => !columns.has(column));
      if (missing.length > 0) {
        offenders.push(`${table} (missing ${missing.join(', ')})`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      'BaseModel maps created_at/updated_at/deleted_at on every model; a table without them breaks Model.create() through the RETURNING clause. Add nullable columns in a migration.',
    );
  });

  it('adds the repair columns as nullable, so append-only tables stay append-only', () => {
    const source = readFileSync(
      path.join(MIGRATIONS_DIR, '20260928170000-align-base-model-timestamp-columns.ts'),
      'utf8',
    );

    assert.match(source, /allowNull:\s*true/, 'the added columns must be nullable');
    assert.ok(
      !/updatedAt:\s*true/.test(source),
      'the models keep updatedAt:false — the migration only adds storage',
    );

    for (const table of [
      'marketing_lead_events',
      'email_events',
      'email_template_versions',
      'email_campaign_recipients',
      'marketing_suppressions',
      'password_reset_tokens',
    ]) {
      assert.ok(
        ADDED_TIMESTAMP_COLUMNS.some(([candidate]) => candidate === table),
        `${table} must be repaired by the alignment migration`,
      );
    }
  });
});
