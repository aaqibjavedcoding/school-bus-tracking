import type { QueryInterface } from 'sequelize';

/**
 * Hardening 5B schema: durable lead notifications, provider feedback events,
 * indexed click attribution and the retention/erasure markers.
 *
 * Four independent concerns, one transaction — a half-applied marketing
 * schema is the kind of state that makes a worker send twice.
 *
 * 1. **`marketing_notification_jobs`** turns the "new demo lead" email from a
 *    fire-and-forget promise into a PostgreSQL queue: the job row is written
 *    in the *same transaction* as the lead, so a process that dies one
 *    millisecond later still owes the notification. Lease columns
 *    (`locked_by`, `lease_expires_at`) mirror `email_campaign_recipients`,
 *    which is what makes crash recovery identical for both rails — while the
 *    tables stay strictly separate, because operational mail and campaign
 *    mail must never share a queue, a counter or a cap.
 *    The partial unique index on `(job_type, lead_id)` is the duplicate
 *    guard: two workers, two API instances or a retried submission can never
 *    produce two notifications for the same lead.
 *
 * 2. **`marketing_provider_events`** is the idempotent landing table of the
 *    signed provider webhook. `(provider, provider_event_id)` is unique, so a
 *    replayed delivery receipt is a no-op. It stores a **digest** of the
 *    address, never the address itself, and bounded metadata — never the raw
 *    provider payload, which can contain full message bodies.
 *
 * 3. **Attribution.** `marketing_attributions` holds the SHA-256 digest of a
 *    per-click nonce (never the nonce), bound to the campaign and recipient
 *    that minted it. Resolving a cookie is therefore one indexed lookup
 *    instead of a scan over campaigns and recipients. The two generated
 *    `attribution_digest` columns keep the legacy (Session 3/4) cookie format
 *    resolvable — also by index, also without a scan — so existing cookies in
 *    the wild keep attributing.
 *
 * 4. **Retention markers.** `email_campaign_recipients.pii_anonymized_at` and
 *    `marketing_leads.erased_at` make anonymization idempotent: the retention
 *    worker only ever touches rows where the marker is still null, so running
 *    it twice costs nothing and changes nothing.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    const run = (sql: string): Promise<unknown> =>
      queryInterface.sequelize.query(sql, { transaction });

    // --- 1. durable lead notification queue --------------------------------
    await run(`
      CREATE TABLE marketing_notification_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_type VARCHAR(48) NOT NULL,
        lead_id UUID NULL REFERENCES marketing_leads(id) ON DELETE CASCADE,
        status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        locked_by VARCHAR(64) NULL,
        lease_expires_at TIMESTAMPTZ NULL,
        last_error_category VARCHAR(32) NULL,
        provider_message_id VARCHAR(255) NULL,
        sent_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        -- Never written: the models set deletedAt:false. It exists because
        -- BaseModel *maps* the attribute, so Sequelize names it in the
        -- RETURNING clause of every INSERT.
        deleted_at TIMESTAMPTZ NULL,
        CONSTRAINT marketing_notification_jobs_status_check CHECK (
          status IN ('PENDING', 'PROCESSING', 'RETRYING', 'SENT', 'FAILED', 'EXPIRED')
        ),
        CONSTRAINT marketing_notification_jobs_attempts_check CHECK (attempts >= 0)
      )
    `);
    // One notification per lead and job type, enforced by the database rather
    // than by hopeful application code.
    await run(`
      CREATE UNIQUE INDEX uq_marketing_notification_jobs_lead_type
        ON marketing_notification_jobs (job_type, lead_id)
        WHERE lead_id IS NOT NULL
    `);
    // The claim query's index: due work, oldest first.
    await run(`
      CREATE INDEX idx_marketing_notification_jobs_claim
        ON marketing_notification_jobs (status, next_attempt_at)
    `);
    await run(`
      CREATE INDEX idx_marketing_notification_jobs_lease
        ON marketing_notification_jobs (status, lease_expires_at)
    `);

    // --- 2. provider feedback events ---------------------------------------
    await run(`
      CREATE TABLE marketing_provider_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        provider VARCHAR(40) NOT NULL,
        provider_event_id VARCHAR(190) NOT NULL,
        event_type VARCHAR(32) NOT NULL,
        provider_message_id VARCHAR(255) NULL,
        campaign_id UUID NULL REFERENCES email_campaigns(id) ON DELETE SET NULL,
        campaign_recipient_id UUID NULL REFERENCES email_campaign_recipients(id) ON DELETE SET NULL,
        email_digest CHAR(64) NULL,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata JSONB NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        -- Never written: the models set deletedAt:false. It exists because
        -- BaseModel *maps* the attribute, so Sequelize names it in the
        -- RETURNING clause of every INSERT.
        deleted_at TIMESTAMPTZ NULL,
        CONSTRAINT marketing_provider_events_type_check CHECK (
          event_type IN ('delivered', 'hard_bounce', 'soft_bounce', 'complaint')
        )
      )
    `);
    await run(`
      CREATE UNIQUE INDEX uq_marketing_provider_events_provider_event
        ON marketing_provider_events (provider, provider_event_id)
    `);
    await run(`
      CREATE INDEX idx_marketing_provider_events_message
        ON marketing_provider_events (provider_message_id)
    `);
    await run(`
      CREATE INDEX idx_marketing_provider_events_received
        ON marketing_provider_events (received_at)
    `);

    // --- 3. indexed attribution -------------------------------------------
    await run(`
      CREATE TABLE marketing_attributions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nonce_digest CHAR(64) NOT NULL,
        campaign_id UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
        campaign_recipient_id UUID NOT NULL REFERENCES email_campaign_recipients(id) ON DELETE CASCADE,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ NULL,
        use_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        -- See above: mapped by BaseModel, never written.
        deleted_at TIMESTAMPTZ NULL
      )
    `);
    // The whole point of the table: resolution is a unique-index probe.
    await run(`
      CREATE UNIQUE INDEX uq_marketing_attributions_nonce
        ON marketing_attributions (nonce_digest)
    `);
    await run(`
      CREATE INDEX idx_marketing_attributions_expires
        ON marketing_attributions (expires_at)
    `);
    await run(`
      CREATE INDEX idx_marketing_attributions_recipient
        ON marketing_attributions (campaign_recipient_id)
    `);

    // Generated digests keep the legacy cookie format resolvable by index.
    // `sha256()` and `encode()` are immutable, so PostgreSQL accepts them in
    // a STORED generated column and the value can never drift from the id.
    await run(`
      ALTER TABLE email_campaigns
        ADD COLUMN attribution_digest VARCHAR(32)
        GENERATED ALWAYS AS (
          substring(encode(sha256(('attribution:' || id::text)::bytea), 'hex') from 1 for 32)
        ) STORED
    `);
    await run(`
      CREATE INDEX idx_email_campaigns_attribution_digest
        ON email_campaigns (attribution_digest)
    `);
    await run(`
      ALTER TABLE email_campaign_recipients
        ADD COLUMN attribution_digest VARCHAR(32)
        GENERATED ALWAYS AS (
          substring(
            encode(sha256(('attribution:' || campaign_id::text || ':' || id::text)::bytea), 'hex')
            from 1 for 32
          )
        ) STORED
    `);
    await run(`
      CREATE INDEX idx_email_campaign_recipients_attribution_digest
        ON email_campaign_recipients (attribution_digest)
    `);

    // --- 4. retention / erasure markers ------------------------------------
    await run(`
      ALTER TABLE email_campaign_recipients
        ADD COLUMN pii_anonymized_at TIMESTAMPTZ NULL
    `);
    await run(`
      CREATE INDEX idx_email_campaign_recipients_pii_anonymized
        ON email_campaign_recipients (pii_anonymized_at)
    `);
    await run(`
      ALTER TABLE marketing_leads
        ADD COLUMN erased_at TIMESTAMPTZ NULL
    `);
    await run(`
      CREATE INDEX idx_marketing_leads_erased_at
        ON marketing_leads (erased_at)
    `);
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    const run = (sql: string): Promise<unknown> =>
      queryInterface.sequelize.query(sql, { transaction });

    await run('DROP INDEX IF EXISTS idx_marketing_leads_erased_at');
    await run('ALTER TABLE marketing_leads DROP COLUMN IF EXISTS erased_at');
    await run('DROP INDEX IF EXISTS idx_email_campaign_recipients_pii_anonymized');
    await run('ALTER TABLE email_campaign_recipients DROP COLUMN IF EXISTS pii_anonymized_at');
    await run('DROP INDEX IF EXISTS idx_email_campaign_recipients_attribution_digest');
    await run('ALTER TABLE email_campaign_recipients DROP COLUMN IF EXISTS attribution_digest');
    await run('DROP INDEX IF EXISTS idx_email_campaigns_attribution_digest');
    await run('ALTER TABLE email_campaigns DROP COLUMN IF EXISTS attribution_digest');
    await run('DROP TABLE IF EXISTS marketing_attributions');
    await run('DROP TABLE IF EXISTS marketing_provider_events');
    await run('DROP TABLE IF EXISTS marketing_notification_jobs');
  });
}
