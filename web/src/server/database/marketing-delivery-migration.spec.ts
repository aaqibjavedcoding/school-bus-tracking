import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import type { QueryInterface } from 'sequelize';

import * as deliveryMigration from './migrations/20260927140000-marketing-delivery-worker';

/**
 * The Session 3 delivery migration, checked without a database.
 *
 * What is pinned here are the schema properties the worker's correctness
 * rests on — the ones that are cheap to assert now and expensive to discover
 * in production:
 *
 * - a **lease** (`locked_by` + `lease_expires_at`) exists and is indexed with
 *   the status, because lease recovery is the query that turns a killed
 *   container back into a delivering worker;
 * - the snapshot keeps its own `school_name`, so rendering never has to join
 *   live school data;
 * - no column is added that could hold a token, a body, or a provider error
 *   string;
 * - `idempotency_keys.school_id` becomes nullable **and** gains two partial
 *   unique indexes, because a single unique index over a nullable column does
 *   not deduplicate the platform rows (`NULL != NULL` in PostgreSQL);
 * - everything runs in one transaction and reverses cleanly.
 */

interface ColumnSpec {
  type?: unknown;
  allowNull?: boolean;
  defaultValue?: unknown;
  comment?: string;
  references?: { model?: string; key?: string };
}

interface RecordedIndex {
  table: string;
  options: Record<string, unknown>;
}

class RecordingQueryInterface {
  public transactions = 0;
  public readonly addedColumns: Array<{ table: string; name: string; spec: ColumnSpec }> = [];
  public readonly removedColumns: Array<{ table: string; name: string }> = [];
  public readonly changedColumns: Array<{ table: string; name: string; spec: ColumnSpec }> = [];
  public readonly addedIndexes: RecordedIndex[] = [];
  public readonly removedIndexes: Array<{ table: string; name: string }> = [];
  public readonly statements: string[] = [];
  public readonly transactional: boolean[] = [];

  get sequelize(): unknown {
    return {
      transaction: async (callback: (transaction: unknown) => Promise<void>) => {
        this.transactions += 1;
        await callback({ __transaction: this.transactions });
      },
      query: async (sql: string, options?: unknown) => {
        this.note(options);
        this.statements.push(sql.replace(/\s+/g, ' ').trim());
      },
    };
  }

  private note(options: unknown): void {
    this.transactional.push(
      (options as { transaction?: unknown } | undefined)?.transaction !== undefined,
    );
  }

  async addColumn(table: string, name: string, spec: ColumnSpec, options?: unknown): Promise<void> {
    this.note(options);
    this.addedColumns.push({ table, name, spec });
  }

  async removeColumn(table: string, name: string, options?: unknown): Promise<void> {
    this.note(options);
    this.removedColumns.push({ table, name });
  }

  async changeColumn(
    table: string,
    name: string,
    spec: ColumnSpec,
    options?: unknown,
  ): Promise<void> {
    this.note(options);
    this.changedColumns.push({ table, name, spec });
  }

  async addIndex(table: string, options: Record<string, unknown>): Promise<void> {
    this.note(options);
    this.addedIndexes.push({ table, options });
  }

  async removeIndex(table: string, name: string, options?: unknown): Promise<void> {
    this.note(options);
    this.removedIndexes.push({ table, name });
  }
}

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
  await deliveryMigration.up(up as unknown as QueryInterface);
  await deliveryMigration.down(down as unknown as QueryInterface);
  return { up, down };
}

describe('migration 20260927140000-marketing-delivery-worker', () => {
  it('applies inside exactly one transaction, with every statement enrolled', async () => {
    const { up } = await run();
    assert.equal(up.transactions, 1, 'a half-applied queue schema is not recoverable by hand');
    assert.equal(up.transactional.every(Boolean), true);
  });

  it('gives recipients a lease so a crashed worker cannot strand them', async () => {
    const { up } = await run();
    const columns = new Map(
      up.addedColumns
        .filter((column) => column.table === 'email_campaign_recipients')
        .map((column) => [column.name, column.spec]),
    );

    assert.ok(columns.has('locked_by'), 'the claim owner must be recorded');
    assert.ok(columns.has('lease_expires_at'), 'without a deadline a claim is permanent');
    assert.ok(columns.has('last_attempt_at'));
    assert.equal(columns.get('locked_by')?.allowNull, true, 'an unclaimed row has no owner');
    assert.equal(sqlType(columns.get('locked_by')?.type), 'VARCHAR(64)');
  });

  it('indexes the lease-recovery scan', async () => {
    const { up } = await run();
    const index = up.addedIndexes.find(
      (entry) => entry.options.name === 'idx_email_campaign_recipients_lease',
    );
    assert.ok(index, 'recovering expired claims must not be a sequential scan');
    assert.deepEqual(index?.options.fields, ['status', 'lease_expires_at']);
  });

  it('freezes the school name into the snapshot row', async () => {
    const { up } = await run();
    const column = up.addedColumns.find((entry) => entry.name === 'school_name');
    assert.ok(column, 'rendering must not depend on live school data');
    assert.equal(column?.table, 'email_campaign_recipients');
    assert.equal(column?.spec.allowNull, true);
  });

  it('counts engagement on the recipient row so unique clicks are answerable', async () => {
    const { up } = await run();
    const names = up.addedColumns.map((column) => column.name);
    assert.ok(names.includes('click_count'));
    assert.ok(names.includes('first_clicked_at'), 'the unique-click guard is a NULL check');
    assert.ok(names.includes('unsubscribed_at'));
    const clickCount = up.addedColumns.find((column) => column.name === 'click_count');
    assert.equal(clickCount?.spec.allowNull, false);
    assert.equal(clickCount?.spec.defaultValue, 0, 'counters start at zero, never NULL');
  });

  it('adds every campaign progress counter with a zero default', async () => {
    const { up } = await run();
    const counters = up.addedColumns.filter((column) => column.table === 'email_campaigns');
    const names = counters.map((column) => column.name).sort();
    assert.deepEqual(names, [
      'cancelled_count',
      'expired_count',
      'processing_count',
      'queued_count',
      'retrying_count',
      'skipped_count',
      'suppressed_count',
      'total_click_count',
    ]);
    for (const counter of counters) {
      assert.equal(counter.spec.allowNull, false, `${counter.name} must never be NULL`);
      assert.equal(counter.spec.defaultValue, 0);
    }
  });

  it('backfills existing campaigns without letting a counter go negative', async () => {
    const { up } = await run();
    const backfill = up.statements.find((sql) => sql.startsWith('UPDATE email_campaigns'));
    assert.ok(backfill);
    assert.match(String(backfill), /GREATEST\(/, 'the backfill is clamped at zero');
  });

  it('adds no column that could hold a token, a body or a provider error', async () => {
    const { up } = await run();
    const forbidden = [
      'click_token',
      'unsubscribe_token',
      'token',
      'html_body',
      'text_body',
      'body',
      'subject',
      'last_error',
      'error_message',
      'smtp_response',
    ];
    for (const column of up.addedColumns) {
      assert.equal(
        forbidden.includes(column.name),
        false,
        `${column.name} must not exist on a marketing table`,
      );
    }
  });

  it('makes the idempotency tenant column nullable as the platform scope', async () => {
    const { up } = await run();
    const change = up.changedColumns.find(
      (entry) => entry.table === 'idempotency_keys' && entry.name === 'school_id',
    );
    assert.ok(change);
    assert.equal(change?.spec.allowNull, true, 'NULL is the explicit platform scope');
    assert.equal(change?.spec.references?.model, 'schools', 'the foreign key is kept');
  });

  it('replaces the unique lookup with one partial index per scope', async () => {
    const { up } = await run();
    assert.ok(
      up.removedIndexes.some((entry) => entry.name === 'idempotency_keys_unique_lookup'),
      'the old index cannot deduplicate platform rows',
    );

    const tenant = up.statements.find((sql) => sql.includes('idempotency_keys_unique_lookup'));
    const platform = up.statements.find((sql) =>
      sql.includes('idempotency_keys_unique_platform_lookup'),
    );

    assert.match(String(tenant), /CREATE UNIQUE INDEX/);
    assert.match(String(tenant), /\(school_id, user_id, endpoint, idempotency_key\)/);
    assert.match(String(tenant), /WHERE school_id IS NOT NULL/);

    assert.match(String(platform), /CREATE UNIQUE INDEX/);
    assert.match(
      String(platform),
      /\(user_id, endpoint, idempotency_key\)/,
      'platform rows have no tenant column to isolate by',
    );
    assert.match(String(platform), /WHERE school_id IS NULL/);
  });

  it('reverses everything it added', async () => {
    const { up, down } = await run();

    assert.deepEqual(
      down.removedColumns.map((column) => `${column.table}.${column.name}`).sort(),
      up.addedColumns.map((column) => `${column.table}.${column.name}`).sort(),
      'down must remove exactly the columns up added',
    );
    assert.deepEqual(
      down.removedIndexes.map((index) => index.name),
      ['idx_email_campaign_recipients_lease'],
    );
    assert.ok(
      down.statements.some((sql) => sql.includes('DROP INDEX IF EXISTS')),
      'the partial indexes are dropped by name',
    );
    assert.ok(
      down.statements.some((sql) => sql.includes('DELETE FROM idempotency_keys')),
      'platform rows cannot survive a NOT NULL column, so down removes them explicitly',
    );
    assert.equal(down.transactions, 1);
  });

  it('sorts after the Session 1 marketing migrations', async () => {
    const dir = path.join(__dirname, 'migrations');
    const names = readdirSync(dir)
      .filter((name) => /^\d{14}-.+\.[cm]?[jt]s$/.test(name))
      .sort();
    const index = names.indexOf('20260927140000-marketing-delivery-worker.ts');
    assert.ok(index > 0);
    assert.equal(names[index - 1], '20260927130500-create-marketing-leads.ts');
  });
});
