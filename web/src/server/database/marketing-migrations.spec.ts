import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import type { QueryInterface } from 'sequelize';

import * as createEmailTemplates from './migrations/20260927130000-create-email-templates';
import * as createEmailCampaigns from './migrations/20260927130100-create-email-campaigns';
import * as createEmailCampaignRecipients from './migrations/20260927130200-create-email-campaign-recipients';
import * as createEmailEvents from './migrations/20260927130300-create-email-events';
import * as createMarketingSuppressions from './migrations/20260927130400-create-marketing-suppressions';
import * as createMarketingLeads from './migrations/20260927130500-create-marketing-leads';

/**
 * The marketing-communications migrations, checked **without a database**.
 *
 * Same split as `password-reset-migrations.spec.ts`: the integration suite
 * (`npm --prefix web run test:db`) proves PostgreSQL accepts the DDL, but it
 * only runs where a database exists. This spec runs everywhere and pins the
 * *intent* of the schema — the properties that make the marketing system safe
 * are properties of these columns and indexes, not of the service code that
 * will be written in later sessions:
 *
 * - tracking/unsubscribe tokens are stored as **digests** (VARCHAR(64) hex),
 *   and no column could hold a plaintext token;
 * - no marketing table stores an email **body** or a raw provider error;
 * - the audience snapshot is deduplicated by `(campaign_id, normalized_email)`
 *   and both digests are unique, so link resolution lands on exactly one row;
 * - campaign → template-version references are `RESTRICT` (sent history stays
 *   reproducible), lead attribution is `SET NULL` (leads survive purges);
 * - `marketing_leads.consent_at` is NOT NULL — a lead without a consent
 *   record must not exist;
 * - every migration is transactional and fully reversible.
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

  async addIndex(table: string, fields: string[], options: Record<string, unknown>): Promise<void> {
    this.noteTransaction(options);
    this.indexes.push({ table, fields, options });
  }

  async dropTable(table: string, options?: unknown): Promise<void> {
    this.noteTransaction(options);
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

interface MigrationModule {
  up(queryInterface: QueryInterface): Promise<void>;
  down(queryInterface: QueryInterface): Promise<void>;
}

async function run(migration: MigrationModule) {
  const up = new RecordingQueryInterface();
  const down = new RecordingQueryInterface();
  await migration.up(up as unknown as QueryInterface);
  await migration.down(down as unknown as QueryInterface);
  return { up, down };
}

function byName(recording: RecordingQueryInterface, name: string): RecordedIndex | undefined {
  return recording.indexes.find((index) => index.options.name === name);
}

/** No column may exist that could hold a plaintext token or an email body. */
function assertNoForbiddenColumns(table: Record<string, ColumnSpec>, forbidden: string[]): void {
  for (const name of forbidden) {
    assert.equal(name in table, false, `${name} must not exist on this table`);
  }
}

describe('marketing migrations — shared guarantees', () => {
  const migrations: Array<[string, MigrationModule]> = [
    ['20260927130000-create-email-templates', createEmailTemplates],
    ['20260927130100-create-email-campaigns', createEmailCampaigns],
    ['20260927130200-create-email-campaign-recipients', createEmailCampaignRecipients],
    ['20260927130300-create-email-events', createEmailEvents],
    ['20260927130400-create-marketing-suppressions', createMarketingSuppressions],
    ['20260927130500-create-marketing-leads', createMarketingLeads],
  ];

  for (const [name, migration] of migrations) {
    it(`${name}: applies inside one transaction`, async () => {
      const { up } = await run(migration);
      assert.equal(up.transactions, 1, 'a half-applied marketing table is not recoverable by hand');
      assert.equal(
        up.transactional.every(Boolean),
        true,
        'every statement must join the transaction',
      );
    });

    it(`${name}: is fully reversible (down drops exactly what up created)`, async () => {
      const { up, down } = await run(migration);
      assert.deepEqual(
        [...down.dropped].sort(),
        Object.keys(up.created).sort(),
        'down must drop every table up created',
      );
    });

    it(`${name}: uses UUID primary keys like every other table`, async () => {
      const { up } = await run(migration);
      for (const [table, columns] of Object.entries(up.created)) {
        assert.ok(columns.id, `${table} must have an id`);
        assert.equal(sqlType(columns.id.type), 'UUID', `${table}.id must be a UUID`);
        assert.equal(columns.id.primaryKey, true);
        assert.equal(columns.id.allowNull, false);
      }
    });
  }

  it('sorts after every migration that existed before it', () => {
    const dir = path.join(__dirname, 'migrations');
    const names = readdirSync(dir)
      .filter((name) => /^\d{14}-.+\.[cm]?[jt]s$/.test(name))
      .sort();
    // The last pre-marketing migration; the marketing set must follow it.
    const anchor = names.indexOf('20260927120000-add-profile-photo-to-users.ts');
    assert.ok(anchor > 0, 'the anchor migration must be present');
    assert.equal(names[anchor + 1], '20260927130000-create-email-templates.ts');
    assert.equal(names[anchor + 6], '20260927130500-create-marketing-leads.ts');
  });
});

describe('migration 20260927130000-create-email-templates', () => {
  it('creates exactly the template container and its versions', async () => {
    const { up } = await run(createEmailTemplates);
    assert.deepEqual(Object.keys(up.created).sort(), [
      'email_template_versions',
      'email_templates',
    ]);
  });

  it('keeps the slug unique among live templates only (partial index)', async () => {
    const { up } = await run(createEmailTemplates);
    const slug = byName(up, 'uq_email_templates_slug');
    assert.ok(slug, 'the slug index must exist');
    assert.deepEqual(slug.fields, ['slug']);
    assert.equal(slug.options.unique, true);
    assert.deepEqual(slug.options.where, { deleted_at: null });
  });

  it('makes (template_id, version) unique — the reproducibility guarantee', async () => {
    const { up } = await run(createEmailTemplates);
    const unique = byName(up, 'uq_email_template_versions_template_version');
    assert.ok(unique, 'the (template_id, version) index must exist');
    assert.deepEqual(unique.fields, ['template_id', 'version']);
    assert.equal(unique.options.unique, true);
  });

  it('marks published versions with a nullable published_at and no default', async () => {
    const { up } = await run(createEmailTemplates);
    const publishedAt = up.created.email_template_versions.published_at;
    assert.equal(publishedAt.allowNull, true);
    assert.equal(publishedAt.defaultValue, undefined);
  });

  it('keeps authorship nullable user references that survive account removal', async () => {
    const { up } = await run(createEmailTemplates);
    for (const column of ['created_by', 'updated_by']) {
      const spec = up.created.email_templates[column];
      assert.equal(spec.allowNull, true);
      assert.deepEqual(spec.references, { model: 'users', key: 'id' });
      assert.equal(spec.onDelete, 'SET NULL');
    }
  });
});

describe('migration 20260927130100-create-email-campaigns', () => {
  it('pins the immutable template version with RESTRICT, never CASCADE', async () => {
    const { up } = await run(createEmailCampaigns);
    const versionRef = up.created.email_campaigns.template_version_id;
    assert.deepEqual(versionRef.references, { model: 'email_template_versions', key: 'id' });
    assert.equal(versionRef.onDelete, 'RESTRICT', 'sent history must stay reproducible');
  });

  it('stores the audience filter as required JSONB and the snapshot hash as VARCHAR(64)', async () => {
    const { up } = await run(createEmailCampaigns);
    assert.equal(sqlType(up.created.email_campaigns.audience_filter.type), 'JSONB');
    assert.equal(up.created.email_campaigns.audience_filter.allowNull, false);
    // Exactly one SHA-256 hex digest — not enough room for a raw token or a
    // copied address list.
    assert.equal(sqlType(up.created.email_campaigns.audience_snapshot_hash.type), 'VARCHAR(64)');
  });

  it('defaults every aggregate counter to zero', async () => {
    const { up } = await run(createEmailCampaigns);
    for (const column of [
      'recipient_count',
      'sent_count',
      'failed_count',
      'clicked_count',
      'unsubscribed_count',
    ]) {
      const spec = up.created.email_campaigns[column];
      assert.equal(spec.allowNull, false, `${column} must be NOT NULL`);
      assert.equal(spec.defaultValue, 0, `${column} must default to 0`);
      assert.equal(sqlType(spec.type), 'INTEGER');
    }
  });

  it('indexes the scheduler scan, the console list and template usage', async () => {
    const { up } = await run(createEmailCampaigns);
    assert.deepEqual(byName(up, 'idx_email_campaigns_status_scheduled')?.fields, [
      'status',
      'scheduled_at',
    ]);
    assert.deepEqual(byName(up, 'idx_email_campaigns_status_created')?.fields, [
      'status',
      'created_at',
    ]);
    assert.deepEqual(byName(up, 'idx_email_campaigns_template')?.fields, ['template_id']);
  });
});

describe('migration 20260927130200-create-email-campaign-recipients', () => {
  it('stores digests only — no column could hold a plaintext token', async () => {
    const { up } = await run(createEmailCampaignRecipients);
    const table = up.created.email_campaign_recipients;
    assertNoForbiddenColumns(table, [
      'click_token',
      'unsubscribe_token',
      'token',
      'raw_token',
      'tracking_token',
    ]);
    // Exactly a SHA-256 hex digest (64 chars), the password_reset_tokens
    // construction.
    assert.equal(sqlType(table.click_token_hash.type), 'VARCHAR(64)');
    assert.equal(sqlType(table.unsubscribe_token_hash.type), 'VARCHAR(64)');
  });

  it('makes both digests unique — link resolution lands on exactly one row', async () => {
    const { up } = await run(createEmailCampaignRecipients);
    assert.equal(byName(up, 'uq_email_campaign_recipients_click_token')?.options.unique, true);
    assert.deepEqual(byName(up, 'uq_email_campaign_recipients_click_token')?.fields, [
      'click_token_hash',
    ]);
    assert.equal(
      byName(up, 'uq_email_campaign_recipients_unsubscribe_token')?.options.unique,
      true,
    );
    assert.deepEqual(byName(up, 'uq_email_campaign_recipients_unsubscribe_token')?.fields, [
      'unsubscribe_token_hash',
    ]);
  });

  it('deduplicates the snapshot by (campaign_id, normalized_email)', async () => {
    const { up } = await run(createEmailCampaignRecipients);
    const unique = byName(up, 'uq_email_campaign_recipients_campaign_email');
    assert.ok(unique);
    assert.deepEqual(unique.fields, ['campaign_id', 'normalized_email']);
    assert.equal(unique.options.unique, true);
  });

  it('stores only a safe error category — never a raw provider error', async () => {
    const { up } = await run(createEmailCampaignRecipients);
    const table = up.created.email_campaign_recipients;
    assertNoForbiddenColumns(table, ['last_error', 'error', 'error_message', 'failure_reason']);
    assert.equal(sqlType(table.last_error_category.type), 'VARCHAR(32)');
    assert.equal(table.last_error_category.allowNull, true);
  });

  it('indexes the worker claim scan and per-campaign progress', async () => {
    const { up } = await run(createEmailCampaignRecipients);
    assert.deepEqual(byName(up, 'idx_email_campaign_recipients_status_next')?.fields, [
      'status',
      'next_attempt_at',
    ]);
    assert.deepEqual(byName(up, 'idx_email_campaign_recipients_campaign_status')?.fields, [
      'campaign_id',
      'status',
    ]);
    assert.deepEqual(byName(up, 'idx_email_campaign_recipients_email')?.fields, [
      'normalized_email',
    ]);
  });

  it('keeps the school reference nullable (SET NULL) so rows outlive schools', async () => {
    const { up } = await run(createEmailCampaignRecipients);
    const schoolRef = up.created.email_campaign_recipients.school_id;
    assert.deepEqual(schoolRef.references, { model: 'schools', key: 'id' });
    assert.equal(schoolRef.onDelete, 'SET NULL');
    assert.equal(schoolRef.allowNull, true);
  });
});

describe('migration 20260927130300-create-email-events', () => {
  it('never stores a raw token, an email body or a subject', async () => {
    const { up } = await run(createEmailEvents);
    assertNoForbiddenColumns(up.created.email_events, [
      'token',
      'raw_token',
      'click_token',
      'unsubscribe_token',
      'body',
      'html_body',
      'text_body',
      'subject',
      'email_body',
    ]);
  });

  it('is append-only: occurred_at required, no updated_at/deleted_at columns', async () => {
    const { up } = await run(createEmailEvents);
    const table = up.created.email_events;
    assert.equal(table.occurred_at.allowNull, false);
    assert.equal('updated_at' in table, false);
    assert.equal('deleted_at' in table, false);
  });

  it('indexes campaign funnels, recipient timelines and platform trends', async () => {
    const { up } = await run(createEmailEvents);
    assert.deepEqual(byName(up, 'idx_email_events_campaign_type_occurred')?.fields, [
      'campaign_id',
      'event_type',
      'occurred_at',
    ]);
    assert.deepEqual(byName(up, 'idx_email_events_recipient_occurred')?.fields, [
      'campaign_recipient_id',
      'occurred_at',
    ]);
    assert.deepEqual(byName(up, 'idx_email_events_type_occurred')?.fields, [
      'event_type',
      'occurred_at',
    ]);
  });
});

describe('migration 20260927130400-create-marketing-suppressions', () => {
  it('makes the do-not-send key unique per normalized address', async () => {
    const { up } = await run(createMarketingSuppressions);
    const unique = byName(up, 'uq_marketing_suppressions_email');
    assert.ok(unique);
    assert.deepEqual(unique.fields, ['normalized_email']);
    assert.equal(unique.options.unique, true);
  });

  it('is a small, honest table: no soft delete, no tenant column', async () => {
    const { up } = await run(createMarketingSuppressions);
    const table = up.created.marketing_suppressions;
    assert.deepEqual(Object.keys(table).sort(), [
      'created_at',
      'id',
      'normalized_email',
      'reason',
      'source',
      'updated_at',
    ]);
  });
});

describe('migration 20260927130500-create-marketing-leads', () => {
  it('creates exactly the lead and lead-event tables', async () => {
    const { up } = await run(createMarketingLeads);
    assert.deepEqual(Object.keys(up.created).sort(), ['marketing_lead_events', 'marketing_leads']);
  });

  it('requires a consent timestamp — a lead without consent must not exist', async () => {
    const { up } = await run(createMarketingLeads);
    const consentAt = up.created.marketing_leads.consent_at;
    assert.equal(consentAt.allowNull, false);
    assert.equal(consentAt.defaultValue, undefined);
  });

  it('keeps attribution nullable with SET NULL — leads survive campaign purges', async () => {
    const { up } = await run(createMarketingLeads);
    for (const column of ['campaign_id', 'campaign_recipient_id']) {
      const spec = up.created.marketing_leads[column];
      assert.equal(spec.allowNull, true);
      assert.equal(spec.onDelete, 'SET NULL');
    }
  });

  it('does not make the lead email unique — fresh submissions are never dropped', async () => {
    const { up } = await run(createMarketingLeads);
    const email = up.created.marketing_leads.normalized_email;
    const uniqueOnEmail = up.indexes.some(
      (index) =>
        index.table === 'marketing_leads' &&
        index.options.unique &&
        index.fields.length === 1 &&
        index.fields[0] === 'normalized_email',
    );
    assert.equal(uniqueOnEmail, false, 'dedup is a service-layer merge, not a silent drop');
    assert.equal(email.allowNull, false);
  });

  it('stores the actor as a bounded safe label on append-only lead events', async () => {
    const { up } = await run(createMarketingLeads);
    const events = up.created.marketing_lead_events;
    assert.equal(sqlType(events.actor.type), 'VARCHAR(120)');
    assert.equal(events.actor.allowNull, false);
    assert.equal('updated_at' in events, false, 'lead events are append-only');
    assert.equal('deleted_at' in events, false);
  });

  it('indexes the pipeline, intake research, attribution and channel views', async () => {
    const { up } = await run(createMarketingLeads);
    assert.deepEqual(byName(up, 'idx_marketing_leads_status_created')?.fields, [
      'status',
      'created_at',
    ]);
    assert.deepEqual(byName(up, 'idx_marketing_leads_email')?.fields, ['normalized_email']);
    assert.deepEqual(byName(up, 'idx_marketing_leads_campaign')?.fields, ['campaign_id']);
    assert.deepEqual(byName(up, 'idx_marketing_lead_events_lead_created')?.fields, [
      'lead_id',
      'created_at',
    ]);
  });
});
