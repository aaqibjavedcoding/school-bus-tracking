import '../support/env';
import { before, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import {
  MarketingCampaignStatus,
  MarketingLeadEventType,
  MarketingLeadSource,
  MarketingLeadStatus,
  MarketingNotificationJobStatus,
  MarketingNotificationJobType,
  MarketingRecipientSource,
  MarketingRecipientStatus,
  MarketingSuppressionReason,
  MarketingSuppressionSource,
} from '@school-bus-tracking/shared-types';
import { prepareDatabase, truncateAll } from '../support/database';
import { ConfigService } from '../../src/server/framework';
import {
  EmailCampaign,
  EmailCampaignRecipient,
  EmailEvent,
  EmailTemplate,
  EmailTemplateVersion,
  MarketingAttribution,
  MarketingLead,
  MarketingLeadEvent,
  MarketingNotificationJob,
  MarketingSuppression,
} from '../../src/server/database/models';
import { MarketingNotificationWorker } from '../../src/server/modules/marketing/marketing-notification.worker';
import { MarketingAttributionService } from '../../src/server/modules/marketing/marketing-attribution.service';
import { MarketingSuppressionsService } from '../../src/server/modules/marketing/marketing-suppressions.service';
import { MarketingErasureService } from '../../src/server/modules/marketing/marketing-erasure.service';
import { RetentionWorker } from '../../src/server/workers/retention.worker';

/**
 * Hardening 5B against the real PostgreSQL engine.
 *
 * The unit specs prove the orchestration against an in-memory stand-in. This
 * suite proves the parts only a real database can: `FOR UPDATE SKIP LOCKED`
 * really hands two concurrent workers disjoint jobs, the partial unique index
 * really refuses a second notification for one lead, the attribution nonce is
 * really resolvable by unique-index probe, and the retention statements
 * really anonymize the rows they claim to (and leave the rest alone).
 */

const ATTRIBUTION_SECRET = 'integration-attribution-secret-32!!';

async function seedCampaign(): Promise<{ campaignId: string; recipientId: string }> {
  const template = await EmailTemplate.create({
    name: 'Hardening 5B template',
    slug: `hardening-5b-${Date.now()}`,
    status: 'PUBLISHED',
  } as never);
  const version = await EmailTemplateVersion.create({
    template_id: template.id,
    version: 1,
    subject: 'Hello {{school_name}}',
    html_body: '<p>Hello</p>',
    text_body: 'Hello',
    allowed_variables: [],
    published_at: new Date(),
  } as never);
  const campaign = await EmailCampaign.create({
    name: 'Hardening 5B campaign',
    template_id: template.id,
    template_version_id: version.id,
    status: MarketingCampaignStatus.SENDING,
    audience_filter: {},
  } as never);
  const recipient = await EmailCampaignRecipient.create({
    campaign_id: campaign.id,
    school_id: null,
    normalized_email: 'principal@school.test',
    recipient_source: MarketingRecipientSource.SCHOOL_EMAIL,
    status: MarketingRecipientStatus.SENT,
    attempts: 1,
    sent_at: new Date(),
  } as never);
  return { campaignId: campaign.id, recipientId: recipient.id };
}

async function seedLead(overrides: Record<string, unknown> = {}): Promise<MarketingLead> {
  return MarketingLead.create({
    full_name: 'Asha Verma',
    normalized_email: `asha-${Math.random().toString(36).slice(2, 10)}@greenfield.example`,
    institution_name: 'Greenfield Public School',
    phone: '+91 90000 00000',
    message: 'We have 14 buses',
    status: MarketingLeadStatus.NEW,
    source: MarketingLeadSource.LANDING_PAGE,
    consent_at: new Date(),
    consent_source: 'public-form',
    ...overrides,
  } as never);
}

describe('marketing hardening 5B (real PostgreSQL)', () => {
  let sequelize: Sequelize;

  before(async () => {
    sequelize = await prepareDatabase();
    await truncateAll(sequelize);
  });

  describe('durable notification queue', () => {
    it('refuses a second notification job for the same lead', async () => {
      const lead = await seedLead();
      await MarketingNotificationJob.create({
        job_type: MarketingNotificationJobType.LEAD_ADMIN_NOTIFICATION,
        lead_id: lead.id,
      } as never);

      await assert.rejects(
        MarketingNotificationJob.create({
          job_type: MarketingNotificationJobType.LEAD_ADMIN_NOTIFICATION,
          lead_id: lead.id,
        } as never),
        'the partial unique index, not the application, is the duplicate guard',
      );
    });

    it('two concurrent workers claim disjoint jobs and send each exactly once', async () => {
      await truncateAll(sequelize);
      const leads = await Promise.all([seedLead(), seedLead(), seedLead(), seedLead()]);
      for (const lead of leads) {
        await MarketingNotificationJob.create({
          job_type: MarketingNotificationJobType.LEAD_ADMIN_NOTIFICATION,
          lead_id: lead.id,
          next_attempt_at: new Date(Date.now() - 1000),
        } as never);
      }

      const sent: string[] = [];
      const makeWorker = () =>
        new MarketingNotificationWorker({
          jobs: MarketingNotificationJob,
          leads: MarketingLead,
          leadEvents: MarketingLeadEvent,
          notifications: {
            async sendOnce(lead: { id: string }) {
              sent.push(lead.id);
              return { sent: true, retryable: false, category: null, providerMessageId: 'mid' };
            },
          } as never,
          sequelize,
          policy: { batchSize: 10, maxAttempts: 3, retryBaseMs: 1000, expiryMs: 3_600_000, leaseMs: 60_000 },
        });

      const [a, b] = await Promise.all([makeWorker().runOnce(), makeWorker().runOnce()]);

      assert.equal(a.claimed + b.claimed, 4, 'every job is claimed exactly once');
      assert.equal(sent.length, 4);
      assert.equal(new Set(sent).size, 4, 'no lead is notified twice');

      const rows = await MarketingNotificationJob.findAll();
      for (const row of rows) {
        assert.equal(row.status, MarketingNotificationJobStatus.SENT);
        assert.equal(row.locked_by, null, 'the lease is released');
        assert.ok(row.sent_at instanceof Date);
      }
      const events = await MarketingLeadEvent.findAll({
        where: { event_type: MarketingLeadEventType.ADMIN_NOTIFIED } as never,
      });
      assert.equal(events.length, 4);
    });

    it('recovers a job abandoned by a crashed worker once its lease expires', async () => {
      await truncateAll(sequelize);
      const lead = await seedLead();
      await MarketingNotificationJob.create({
        job_type: MarketingNotificationJobType.LEAD_ADMIN_NOTIFICATION,
        lead_id: lead.id,
        status: MarketingNotificationJobStatus.PROCESSING,
        locked_by: 'crashed-container',
        lease_expires_at: new Date(Date.now() - 1000),
        attempts: 1,
      } as never);

      let sends = 0;
      const worker = new MarketingNotificationWorker({
        jobs: MarketingNotificationJob,
        leads: MarketingLead,
        leadEvents: MarketingLeadEvent,
        notifications: {
          async sendOnce() {
            sends += 1;
            return { sent: true, retryable: false, category: null, providerMessageId: 'mid' };
          },
        } as never,
        sequelize,
      });

      const summary = await worker.runOnce();

      assert.equal(summary.claimed, 1, 'an expired lease is reclaimable');
      assert.equal(sends, 1);
      const row = await MarketingNotificationJob.findOne({ where: { lead_id: lead.id } as never });
      assert.equal(row?.status, MarketingNotificationJobStatus.SENT);
      assert.notEqual(row?.locked_by, 'crashed-container');
    });

    it('does not claim a job whose lease is still live', async () => {
      await truncateAll(sequelize);
      const lead = await seedLead();
      await MarketingNotificationJob.create({
        job_type: MarketingNotificationJobType.LEAD_ADMIN_NOTIFICATION,
        lead_id: lead.id,
        status: MarketingNotificationJobStatus.PROCESSING,
        locked_by: 'busy-container',
        lease_expires_at: new Date(Date.now() + 60_000),
      } as never);

      const worker = new MarketingNotificationWorker({
        jobs: MarketingNotificationJob,
        leads: MarketingLead,
        leadEvents: MarketingLeadEvent,
        notifications: {
          async sendOnce() {
            throw new Error('must not be called');
          },
        } as never,
        sequelize,
      });

      assert.equal((await worker.runOnce()).claimed, 0);
    });
  });

  describe('indexed attribution', () => {
    it('resolves a minted grant through the unique nonce digest', async () => {
      await truncateAll(sequelize);
      const { campaignId, recipientId } = await seedCampaign();
      const service = new MarketingAttributionService({
        attributions: MarketingAttribution,
        campaigns: EmailCampaign,
        recipients: EmailCampaignRecipient,
        secret: () => ATTRIBUTION_SECRET,
      });

      const cookie = (await service.issue(campaignId, recipientId)) as string;
      const resolved = await service.resolve(cookie);

      assert.deepEqual(resolved, {
        campaign_id: campaignId,
        campaign_recipient_id: recipientId,
      });

      const stored = await MarketingAttribution.findAll();
      assert.equal(stored.length, 1);
      const nonce = cookie.split('.')[1];
      assert.ok(!stored[0].nonce_digest.includes(nonce), 'only the digest is stored');
    });

    it('rejects a cookie signed with a different secret without matching a row', async () => {
      const { campaignId, recipientId } = await seedCampaign();
      const minting = new MarketingAttributionService({
        attributions: MarketingAttribution,
        campaigns: EmailCampaign,
        recipients: EmailCampaignRecipient,
        secret: () => 'another-secret-that-is-long-enough',
      });
      const verifying = new MarketingAttributionService({
        attributions: MarketingAttribution,
        campaigns: EmailCampaign,
        recipients: EmailCampaignRecipient,
        secret: () => ATTRIBUTION_SECRET,
      });

      const cookie = (await minting.issue(campaignId, recipientId)) as string;
      assert.equal(await verifying.resolve(cookie), null);
    });

    it('keeps the legacy digest columns resolvable by index', async () => {
      const { campaignId } = await seedCampaign();
      const rows = await sequelize.query<{ attribution_digest: string }>(
        'SELECT attribution_digest FROM email_campaigns WHERE id = $id',
        { bind: { id: campaignId }, type: QueryTypes.SELECT },
      );
      assert.match(rows[0].attribution_digest, /^[a-f0-9]{32}$/);
    });
  });

  describe('suppression', () => {
    it('suppresses queued recipients only, leaving sent history intact', async () => {
      await truncateAll(sequelize);
      const { campaignId } = await seedCampaign();
      const queued = await EmailCampaignRecipient.create({
        campaign_id: campaignId,
        school_id: null,
        normalized_email: 'bounced@school.test',
        recipient_source: MarketingRecipientSource.SCHOOL_EMAIL,
        status: MarketingRecipientStatus.PENDING,
        attempts: 0,
      } as never);

      const service = new MarketingSuppressionsService({
        suppressions: MarketingSuppression,
        recipients: EmailCampaignRecipient,
      });

      const applied = await service.suppress(
        'bounced@school.test',
        MarketingSuppressionReason.HARD_BOUNCE,
        MarketingSuppressionSource.SYSTEM,
      );

      assert.equal(applied.created, true);
      assert.equal(applied.suppressedRecipients, 1);
      await queued.reload();
      assert.equal(queued.status, MarketingRecipientStatus.SUPPRESSED);

      // Idempotent: a second call creates nothing and flips nothing new.
      const again = await service.suppress(
        'bounced@school.test',
        MarketingSuppressionReason.HARD_BOUNCE,
        MarketingSuppressionSource.SYSTEM,
      );
      assert.equal(again.created, false);
      assert.equal(again.suppressedRecipients, 0);
      assert.equal(await MarketingSuppression.count(), 1);
    });
  });

  describe('erasure and retention', () => {
    it('anonymizes a lead in place while keeping the consent record', async () => {
      await truncateAll(sequelize);
      const lead = await seedLead();
      await MarketingLeadEvent.create({
        lead_id: lead.id,
        event_type: MarketingLeadEventType.NOTE_ADDED,
        actor: 'super-admin',
        metadata: { note: 'called them' },
      } as never);
      await MarketingNotificationJob.create({
        job_type: MarketingNotificationJobType.LEAD_ADMIN_NOTIFICATION,
        lead_id: lead.id,
      } as never);

      const service = new MarketingErasureService({
        leads: MarketingLead,
        events: MarketingLeadEvent,
        notificationJobs: MarketingNotificationJob,
      });
      const result = await service.eraseLead(lead.id, true);
      assert.equal(result.erased, true);

      await lead.reload();
      assert.equal(lead.full_name, '[erased]');
      assert.match(lead.normalized_email, /@invalid$/);
      assert.equal(lead.phone, null);
      assert.equal(lead.message, null);
      assert.ok(lead.consent_at instanceof Date, 'the consent record survives');
      assert.ok(lead.erased_at instanceof Date);

      const job = await MarketingNotificationJob.findOne({ where: { lead_id: lead.id } as never });
      assert.equal(job?.status, MarketingNotificationJobStatus.EXPIRED);

      // Idempotent on a real database too.
      const second = await service.eraseLead(lead.id, true);
      assert.equal(second.events_anonymized, 0);
    });

    it('applies the marketing retention policies without touching protected rows', async () => {
      await truncateAll(sequelize);
      const { campaignId, recipientId } = await seedCampaign();
      const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

      // An old delivered recipient (anonymizable) and an old *pending* one
      // (must keep its address — it is still owed a message).
      await sequelize.query(
        'UPDATE email_campaign_recipients SET created_at = $old WHERE id = $id',
        { bind: { old, id: recipientId }, type: QueryTypes.UPDATE },
      );
      const pending = await EmailCampaignRecipient.create({
        campaign_id: campaignId,
        school_id: null,
        normalized_email: 'still.queued@school.test',
        recipient_source: MarketingRecipientSource.SCHOOL_EMAIL,
        status: MarketingRecipientStatus.PENDING,
        attempts: 0,
      } as never);
      await sequelize.query(
        'UPDATE email_campaign_recipients SET created_at = $old WHERE id = $id',
        { bind: { old, id: pending.id }, type: QueryTypes.UPDATE },
      );

      // A suppression must survive any retention pass, whatever its age.
      const suppression = await MarketingSuppression.create({
        normalized_email: 'left.alone@school.test',
        reason: MarketingSuppressionReason.UNSUBSCRIBED,
        source: MarketingSuppressionSource.RECIPIENT_LINK,
      } as never);
      await sequelize.query('UPDATE marketing_suppressions SET created_at = $old WHERE id = $id', {
        bind: { old, id: suppression.id },
        type: QueryTypes.UPDATE,
      });

      // An outstanding notification job must survive too.
      const lead = await seedLead();
      const owed = await MarketingNotificationJob.create({
        job_type: MarketingNotificationJobType.LEAD_ADMIN_NOTIFICATION,
        lead_id: lead.id,
      } as never);
      await sequelize.query(
        'UPDATE marketing_notification_jobs SET created_at = $old WHERE id = $id',
        { bind: { old, id: owed.id }, type: QueryTypes.UPDATE },
      );

      const worker = new RetentionWorker(
        new ConfigService({
          retention: {
            marketingEventDays: 1,
            marketingLeadDays: 1,
            marketingRecipientPiiDays: 1,
            marketingNotificationJobDays: 1,
            marketingProviderEventDays: 1,
          },
        }),
        sequelize,
      );

      const results = await worker.runAll();
      assert.equal(results.skipped, false);

      const delivered = await EmailCampaignRecipient.findOne({ where: { id: recipientId } as never });
      assert.match(String(delivered?.normalized_email), /@invalid$/, 'terminal PII is anonymized');
      await pending.reload();
      assert.equal(
        pending.normalized_email,
        'still.queued@school.test',
        'an unsent recipient keeps the address it is about to receive',
      );
      assert.equal(await MarketingSuppression.count(), 1, 'suppressions are never aged out');
      await owed.reload();
      assert.equal(
        owed.status,
        MarketingNotificationJobStatus.PENDING,
        'work still owed is never deleted by retention',
      );

      // A second pass is a no-op: the markers make it idempotent.
      const second = await worker.runAll();
      assert.equal(second.marketingRecipientPii, 0);
      assert.equal(second.marketingLeads, 0);

      // Campaign counters were never rewritten by retention.
      const campaign = await EmailCampaign.findOne({ where: { id: campaignId } as never });
      assert.ok(campaign, 'the campaign row survives its per-event rows');
      assert.equal(await EmailEvent.count({ where: { campaign_id: campaignId } as never }), 0);
    });
  });
});
