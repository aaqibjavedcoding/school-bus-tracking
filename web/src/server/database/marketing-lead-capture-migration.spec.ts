import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { QueryInterface } from 'sequelize';

import * as leadCapture from './migrations/20260928080000-marketing-lead-capture';

/**
 * The Session 4 lead-capture migration, checked without a database.
 *
 * The properties pinned here are the ones the public form's privacy and
 * idempotency guarantees rest on:
 *
 * - the three new columns exist with the right nullability (a lead whose
 *   admin notification never ran is still a valid lead);
 * - the consent channel is backfilled to `public-form` — the only capture
 *   channel that has ever existed — so no historical row loses its record;
 * - the idempotency probe (`submission_fingerprint` + `created_at`) is one
 *   indexed lookup;
 * - **no IP column** and no token column appears: the endpoint's rate
 *   limiting is hashed and in-memory, and the fingerprint is a digest of
 *   data the row already stores;
 * - everything runs in one transaction and reverses cleanly.
 */

interface ColumnSpec {
  type?: unknown;
  allowNull?: boolean;
  defaultValue?: unknown;
}

class RecordingQueryInterface {
  public transactions = 0;
  public readonly addedColumns: Array<{ table: string; name: string; spec: ColumnSpec }> = [];
  public readonly removedColumns: Array<{ table: string; name: string }> = [];
  public readonly addedIndexes: Array<{
    table: string;
    fields: unknown;
    options: Record<string, unknown>;
  }> = [];
  public readonly removedIndexes: Array<{ table: string; name: string }> = [];
  public readonly transactional: boolean[] = [];

  get sequelize(): unknown {
    return {
      transaction: async (callback: (transaction: unknown) => Promise<void>) => {
        this.transactions += 1;
        await callback({ __transaction: this.transactions });
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

  async addIndex(table: string, fields: unknown, options: Record<string, unknown>): Promise<void> {
    this.note(options);
    this.addedIndexes.push({ table, fields, options });
  }

  async removeIndex(table: string, name: string, options?: unknown): Promise<void> {
    this.note(options);
    this.removedIndexes.push({ table, name });
  }
}

async function run() {
  const up = new RecordingQueryInterface();
  const down = new RecordingQueryInterface();
  await leadCapture.up(up as unknown as QueryInterface);
  await leadCapture.down(down as unknown as QueryInterface);
  return { up, down };
}

describe('migration 20260928080000-marketing-lead-capture', () => {
  it('applies inside exactly one transaction, with every statement enrolled', async () => {
    const { up } = await run();
    assert.equal(up.transactions, 1);
    assert.equal(up.transactional.every(Boolean), true);
  });

  it('adds exactly the three lead-capture columns to marketing_leads', async () => {
    const { up } = await run();
    assert.ok(up.addedColumns.every((column) => column.table === 'marketing_leads'));
    assert.deepEqual(
      up.addedColumns.map((column) => column.name).sort(),
      ['admin_notified_at', 'consent_source', 'submission_fingerprint'],
    );
  });

  it('backfills consent_source to public-form and keeps it mandatory', async () => {
    const { up } = await run();
    const consent = up.addedColumns.find((column) => column.name === 'consent_source');
    assert.equal(consent?.spec.allowNull, false);
    assert.equal(consent?.spec.defaultValue, 'public-form');
  });

  it('keeps the notification stamp and fingerprint nullable — neither gates a lead', async () => {
    const { up } = await run();
    const notified = up.addedColumns.find((column) => column.name === 'admin_notified_at');
    const fingerprint = up.addedColumns.find(
      (column) => column.name === 'submission_fingerprint',
    );
    assert.equal(notified?.spec.allowNull, true);
    assert.equal(fingerprint?.spec.allowNull, true);
  });

  it('indexes the idempotency probe on (submission_fingerprint, created_at)', async () => {
    const { up } = await run();
    assert.equal(up.addedIndexes.length, 1);
    assert.equal(up.addedIndexes[0].table, 'marketing_leads');
    assert.deepEqual(up.addedIndexes[0].fields, ['submission_fingerprint', 'created_at']);
    assert.equal(
      up.addedIndexes[0].options.name,
      'idx_marketing_leads_fingerprint_created',
    );
  });

  it('adds no IP, token or raw-content column', async () => {
    const { up } = await run();
    for (const column of up.addedColumns) {
      assert.equal(/ip|token|body|password/i.test(column.name), false, column.name);
    }
  });

  it('reverses cleanly: the index and all three columns are removed', async () => {
    const { down } = await run();
    assert.equal(down.transactions, 1);
    assert.deepEqual(down.removedIndexes, [
      { table: 'marketing_leads', name: 'idx_marketing_leads_fingerprint_created' },
    ]);
    assert.deepEqual(
      down.removedColumns.map((column) => column.name).sort(),
      ['admin_notified_at', 'consent_source', 'submission_fingerprint'],
    );
    assert.equal(down.transactional.every(Boolean), true);
  });
});
