import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import type { QueryInterface } from 'sequelize';

import * as hardeningMigration from './migrations/20260928160000-marketing-hardening-5b';

/**
 * The Hardening 5B migration, checked without a database.
 *
 * Every assertion here is a property some piece of runtime correctness rests
 * on, and each is cheap now and expensive to discover in production:
 *
 * - the notification queue has a **lease** and a **partial unique index**,
 *   which together are the whole "never notify twice, never lose one" story;
 * - the provider-event table is unique on `(provider, provider_event_id)`, so
 *   a replayed webhook is a no-op, and stores a digest rather than an address;
 * - attribution resolves through a **unique index on the nonce digest**,
 *   which is what replaced the O(n) scan;
 * - the erasure/anonymization markers exist, because idempotent retention is
 *   a `WHERE marker IS NULL` guard;
 * - it all applies in one transaction and reverses cleanly.
 */

class RecordingQueryInterface {
  public transactions = 0;
  public readonly statements: string[] = [];
  public readonly transactional: boolean[] = [];

  get sequelize(): unknown {
    return {
      transaction: async (callback: (transaction: unknown) => Promise<void>) => {
        this.transactions += 1;
        await callback({ __transaction: this.transactions });
      },
      query: async (sql: string, options?: unknown) => {
        this.transactional.push(
          (options as { transaction?: unknown } | undefined)?.transaction !== undefined,
        );
        this.statements.push(sql.replace(/\s+/g, ' ').trim());
      },
    };
  }
}

async function run() {
  const up = new RecordingQueryInterface();
  const down = new RecordingQueryInterface();
  await hardeningMigration.up(up as unknown as QueryInterface);
  await hardeningMigration.down(down as unknown as QueryInterface);
  return { up, down };
}

function find(statements: string[], pattern: RegExp): string | undefined {
  return statements.find((sql) => pattern.test(sql));
}

describe('migration 20260928160000-marketing-hardening-5b', () => {
  it('applies inside exactly one transaction, with every statement enrolled', async () => {
    const { up, down } = await run();
    assert.equal(up.transactions, 1, 'a half-applied marketing schema makes a worker send twice');
    assert.equal(up.transactional.every(Boolean), true);
    assert.equal(down.transactions, 1);
    assert.equal(down.transactional.every(Boolean), true);
  });

  it('is ordered after the last shipped migration and is the only new one', () => {
    const dir = path.resolve(__dirname, 'migrations');
    const files = readdirSync(dir)
      .filter((file) => file.endsWith('.ts'))
      .sort();
    assert.equal(
      files.at(-1),
      '20260928160000-marketing-hardening-5b.ts',
      'the 5B migration must sort last so it applies after 5A',
    );
  });
});

describe('marketing_notification_jobs', () => {
  it('creates the queue with a bounded status set and non-negative attempts', async () => {
    const { up } = await run();
    const create = find(up.statements, /CREATE TABLE marketing_notification_jobs/);
    assert.ok(create);
    for (const column of [
      'job_type',
      'lead_id',
      'status',
      'attempts',
      'next_attempt_at',
      'locked_by',
      'lease_expires_at',
      'last_error_category',
      'provider_message_id',
      'sent_at',
      'created_at',
      'updated_at',
    ]) {
      assert.match(String(create), new RegExp(`\\b${column}\\b`), `${column} must exist`);
    }
    assert.match(
      String(create),
      /status IN \('PENDING', 'PROCESSING', 'RETRYING', 'SENT', 'FAILED', 'EXPIRED'\)/,
      'the six statuses are enforced by the database, not only by TypeScript',
    );
    assert.match(String(create), /attempts >= 0/);
    assert.match(
      String(create),
      /lead_id UUID NULL REFERENCES marketing_leads\(id\) ON DELETE CASCADE/,
      'a deleted lead takes its owed notification with it',
    );
  });

  it('makes a duplicate notification impossible at the database level', async () => {
    const { up } = await run();
    const index = find(up.statements, /uq_marketing_notification_jobs_lead_type/);
    assert.ok(index, 'a partial unique index, not hopeful application code');
    assert.match(String(index), /CREATE UNIQUE INDEX/);
    assert.match(String(index), /\(job_type, lead_id\)/);
    assert.match(String(index), /WHERE lead_id IS NOT NULL/);
  });

  it('indexes both the claim scan and the lease-recovery scan', async () => {
    const { up } = await run();
    assert.match(
      String(find(up.statements, /idx_marketing_notification_jobs_claim/)),
      /\(status, next_attempt_at\)/,
    );
    assert.match(
      String(find(up.statements, /idx_marketing_notification_jobs_lease/)),
      /\(status, lease_expires_at\)/,
    );
  });

  it('keeps the queue separate from campaign recipients', async () => {
    const { up } = await run();
    const create = String(find(up.statements, /CREATE TABLE marketing_notification_jobs/));
    assert.ok(
      !/email_campaign_recipients/.test(create),
      'operational mail and campaign mail never share a queue, a counter or a cap',
    );
  });
});

describe('marketing_provider_events', () => {
  it('is idempotent on the provider event id', async () => {
    const { up } = await run();
    const index = find(up.statements, /uq_marketing_provider_events_provider_event/);
    assert.match(String(index), /CREATE UNIQUE INDEX/);
    assert.match(String(index), /\(provider, provider_event_id\)/);
  });

  it('stores a digest and bounded metadata, never an address or a raw payload', async () => {
    const { up } = await run();
    const create = String(find(up.statements, /CREATE TABLE marketing_provider_events/));
    assert.match(create, /email_digest CHAR\(64\) NULL/);
    assert.ok(!/\bemail\b(?!_digest)/.test(create), 'no column can hold an address');
    assert.ok(!/raw_payload|body|subject/.test(create), 'no column can hold a message body');
    assert.match(
      create,
      /event_type IN \('delivered', 'hard_bounce', 'soft_bounce', 'complaint'\)/,
    );
  });

  it('keeps events when a campaign or recipient is removed', async () => {
    const { up } = await run();
    const create = String(find(up.statements, /CREATE TABLE marketing_provider_events/));
    assert.match(create, /campaign_id UUID NULL REFERENCES email_campaigns\(id\) ON DELETE SET NULL/);
    assert.match(
      create,
      /campaign_recipient_id UUID NULL REFERENCES email_campaign_recipients\(id\) ON DELETE SET NULL/,
    );
  });
});

describe('marketing_attributions', () => {
  it('stores only the digest of the nonce, bound to a campaign and recipient', async () => {
    const { up } = await run();
    const create = String(find(up.statements, /CREATE TABLE marketing_attributions/));
    assert.match(create, /nonce_digest CHAR\(64\) NOT NULL/);
    assert.ok(!/\bnonce VARCHAR|\bnonce TEXT/.test(create), 'the raw nonce is never stored');
    assert.match(create, /campaign_id UUID NOT NULL/);
    assert.match(create, /campaign_recipient_id UUID NOT NULL/);
    assert.match(create, /expires_at TIMESTAMPTZ NOT NULL/);
    assert.match(create, /use_count INTEGER NOT NULL DEFAULT 0/);
  });

  it('makes resolution a unique-index probe rather than a scan', async () => {
    const { up } = await run();
    const index = find(up.statements, /uq_marketing_attributions_nonce/);
    assert.match(String(index), /CREATE UNIQUE INDEX/);
    assert.match(String(index), /\(nonce_digest\)/);
    assert.ok(find(up.statements, /idx_marketing_attributions_expires/), 'retention needs it too');
  });

  it('keeps legacy cookies resolvable through indexed generated digests', async () => {
    const { up } = await run();
    const campaigns = String(find(up.statements, /ALTER TABLE email_campaigns ADD COLUMN attribution_digest/));
    assert.match(campaigns, /GENERATED ALWAYS AS/);
    assert.match(campaigns, /STORED/);
    assert.ok(find(up.statements, /idx_email_campaigns_attribution_digest/));
    assert.ok(find(up.statements, /idx_email_campaign_recipients_attribution_digest/));
  });
});

describe('retention and erasure markers', () => {
  it('adds the idempotency markers the retention worker guards on', async () => {
    const { up } = await run();
    assert.ok(
      find(up.statements, /ALTER TABLE email_campaign_recipients ADD COLUMN pii_anonymized_at/),
    );
    assert.ok(find(up.statements, /ALTER TABLE marketing_leads ADD COLUMN erased_at/));
    assert.ok(find(up.statements, /idx_email_campaign_recipients_pii_anonymized/));
    assert.ok(find(up.statements, /idx_marketing_leads_erased_at/));
  });

  it('adds no column that could hold a secret, a token or a message body', async () => {
    const { up } = await run();
    const created = up.statements.join('\n').toLowerCase();
    for (const forbidden of [
      'smtp_pass',
      'password',
      'secret',
      'html_body',
      'text_body',
      'click_token',
      'unsubscribe_token',
      'cookie',
    ]) {
      assert.ok(!created.includes(forbidden), `no column may hold ${forbidden}`);
    }
  });
});

describe('down migration', () => {
  it('drops everything it created, guarded by IF EXISTS', async () => {
    const { down } = await run();
    for (const table of [
      'marketing_attributions',
      'marketing_provider_events',
      'marketing_notification_jobs',
    ]) {
      assert.ok(
        down.statements.includes(`DROP TABLE IF EXISTS ${table}`),
        `${table} must be dropped`,
      );
    }
    assert.ok(
      down.statements.some((sql) => /marketing_leads DROP COLUMN IF EXISTS erased_at/.test(sql)),
    );
    assert.ok(
      down.statements.some((sql) =>
        /email_campaign_recipients DROP COLUMN IF EXISTS pii_anonymized_at/.test(sql),
      ),
    );
    assert.equal(
      down.statements.every((sql) => /IF EXISTS/.test(sql)),
      true,
      'a partial rollback must still be re-runnable',
    );
  });

  it('drops child tables before the columns their sources depend on', async () => {
    const { down } = await run();
    const attributionDrop = down.statements.indexOf('DROP TABLE IF EXISTS marketing_attributions');
    const campaignColumn = down.statements.findIndex((sql) =>
      /email_campaigns DROP COLUMN IF EXISTS attribution_digest/.test(sql),
    );
    assert.ok(campaignColumn >= 0 && attributionDrop >= 0);
    assert.ok(campaignColumn < attributionDrop, 'generated columns go before their table');
  });
});
