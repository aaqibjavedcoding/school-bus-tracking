import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Op } from 'sequelize';
import { ConflictException } from '../../framework';
import {
  MarketingCampaignStatus,
  MarketingRecipientSource,
  MarketingRecipientStatus,
  MarketingTemplateStatus,
} from '@school-bus-tracking/shared-types';
import type { MarketingCampaignAudienceFilter } from '@school-bus-tracking/shared-types';
import {
  isMarketingCampaignTransitionAllowed,
  MarketingCampaignsService,
  MARKETING_CAMPAIGN_TRANSITIONS,
} from './marketing-campaigns.service';
import type { MarketingAudienceService } from './marketing-audience.service';
import type { MarketingAudienceComputation } from './marketing-audience.service';

/**
 * Campaign lifecycle against stub repositories: the published-version pin,
 * draft-only editing, the schedule transaction (recipient snapshot + hash +
 * count), scheduling idempotency, and every invalid transition.
 */

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';

const NOW = new Date('2026-09-27T10:00:00.000Z');

interface CampaignRow {
  id: string;
  name: string;
  template_id: string;
  template_version_id: string;
  status: MarketingCampaignStatus;
  audience_filter: MarketingCampaignAudienceFilter;
  audience_snapshot_hash: string | null;
  scheduled_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  recipient_count: number;
  queued_count?: number;
  processing_count?: number;
  sent_count: number;
  retrying_count?: number;
  failed_count: number;
  suppressed_count?: number;
  skipped_count?: number;
  cancelled_count?: number;
  expired_count?: number;
  clicked_count: number;
  total_click_count?: number;
  unsubscribed_count: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

function makeCampaignRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: CAMPAIGN_ID,
    name: 'Autumn outreach',
    template_id: TEMPLATE_ID,
    template_version_id: VERSION_ID,
    status: MarketingCampaignStatus.DRAFT,
    audience_filter: { cities: ['Nagpur'] },
    audience_snapshot_hash: null,
    scheduled_at: null,
    started_at: null,
    completed_at: null,
    recipient_count: 0,
    sent_count: 0,
    failed_count: 0,
    clicked_count: 0,
    unsubscribed_count: 0,
    created_by: ACTOR,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeComputation(
  recipients: Array<{ school_id: string | null; normalized_email: string }>,
): MarketingAudienceComputation {
  return {
    filter: { cities: ['Nagpur'] },
    total_eligible_schools: recipients.length,
    invalid_email_count: 0,
    suppressed_recipient_count: 0,
    duplicate_recipient_count: 0,
    final_recipient_count: recipients.length,
    recipients: recipients.map((recipient) => ({
      school_id: recipient.school_id,
      school_name: 'Test School',
      normalized_email: recipient.normalized_email,
      recipient_name: null,
      recipient_source: MarketingRecipientSource.SCHOOL_EMAIL,
    })),
    snapshot_hash: `hash-${recipients.length}-${recipients.map((r) => r.normalized_email).join('.')}`,
  };
}

function makeService(options: {
  campaign?: CampaignRow;
  versionPublished?: boolean;
  templateStatus?: MarketingTemplateStatus;
  audience?: MarketingAudienceComputation;
  failBulkCreate?: boolean;
}) {
  const campaignRows = options.campaign ? [options.campaign] : [];
  const bulkCreateCalls: Array<{ rows: unknown[]; options: unknown }> = [];

  const campaignsRepo = {
    findOne: async () =>
      campaignRows.length
        ? attachMethods(campaignRows[0] as unknown as Record<string, unknown>)
        : null,
    findAll: async () =>
      campaignRows.map((row) => attachMethods(row as unknown as Record<string, unknown>)),
    count: async () => campaignRows.length,
    create: async (payload: Record<string, unknown>) => {
      const row = { ...makeCampaignRow(), ...payload } as CampaignRow;
      campaignRows.push(row);
      return attachMethods(row as unknown as Record<string, unknown>);
    },
  };

  const recipientUpdates: Array<{ values: unknown; options: unknown }> = [];
  const recipientsRepo = {
    // Cancelling a campaign also cancels its un-sent recipient rows; the stub
    // reports two affected rows so the counter arithmetic is exercised.
    update: async (values: unknown, updateOptions: unknown) => {
      recipientUpdates.push({ values, options: updateOptions });
      return [2];
    },
    bulkCreate: async (rows: unknown[], bulkOptions: unknown) => {
      if (options.failBulkCreate) {
        const { UniqueConstraintError } = await import('sequelize');
        throw new UniqueConstraintError({ errors: [] });
      }
      bulkCreateCalls.push({ rows, options: bulkOptions });
      return rows;
    },
  };

  const versionsRepo = {
    findOne: async () =>
      options.versionPublished === false
        ? attachMethods({
            id: VERSION_ID,
            template_id: TEMPLATE_ID,
            version: 1,
            published_at: null,
            subject: 'Hello',
          })
        : attachMethods({
            id: VERSION_ID,
            template_id: TEMPLATE_ID,
            version: 3,
            published_at: NOW,
            subject: 'Hello',
          }),
    findAll: async () => [
      attachMethods({ id: VERSION_ID, template_id: TEMPLATE_ID, version: 3, subject: 'Hello' }),
    ],
  };

  const templatesRepo = {
    findOne: async () =>
      attachMethods({
        id: TEMPLATE_ID,
        name: 'Welcome email',
        slug: 'welcome-email',
        status: options.templateStatus ?? MarketingTemplateStatus.PUBLISHED,
      }),
    findAll: async () => [
      attachMethods({
        id: TEMPLATE_ID,
        name: 'Welcome email',
        slug: 'welcome-email',
        status: options.templateStatus ?? MarketingTemplateStatus.PUBLISHED,
      }),
    ],
  };

  const audienceStub = {
    computeAudience: async () => options.audience ?? makeComputation([]),
    preview: async (filter: MarketingCampaignAudienceFilter) => ({
      filter,
      total_eligible_schools: 1,
      invalid_email_count: 0,
      suppressed_recipient_count: 0,
      duplicate_recipient_count: 0,
      final_recipient_count: 1,
      sample: [],
      snapshot_hash: 'preview-hash',
    }),
  } as unknown as MarketingAudienceService;

  const transactionStub = {
    LOCK: { UPDATE: 'UPDATE' },
  };
  const transactions: unknown[] = [];
  const sequelizeStub = {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      transactions.push(transactionStub);
      return callback(transactionStub);
    },
  };

  const service = new MarketingCampaignsService(
    campaignsRepo as never,
    recipientsRepo as never,
    templatesRepo as never,
    versionsRepo as never,
    audienceStub,
    sequelizeStub as never,
  );

  return { service, campaignRows, bulkCreateCalls, transactions, recipientUpdates };
}

function attachMethods(row: Record<string, unknown>) {
  const record = row as Record<string, unknown> & {
    update: (patch: Record<string, unknown>) => Promise<void>;
    reload: () => Promise<void>;
  };
  record.update = async (patch: Record<string, unknown>) => {
    Object.assign(record, patch);
  };
  record.reload = async () => undefined;
  return record;
}

const NAGPUR_AUDIENCE = makeComputation([
  { school_id: 'a-school', normalized_email: 'office@alpha.edu' },
  { school_id: 'b-school', normalized_email: 'office@beta.edu' },
  { school_id: 'c-school', normalized_email: 'office@gamma.edu' },
]);

describe('MarketingCampaignsService — creation and the published-version pin', () => {
  it('creates a draft campaign pinned to a published version', async () => {
    const { service, campaignRows } = makeService({
      audience: NAGPUR_AUDIENCE,
    });
    const campaign = await service.create(ACTOR, {
      name: 'Autumn outreach',
      template_version_id: VERSION_ID,
      audience_filter: { cities: ['Nagpur'] },
    });
    assert.equal(campaign.status, MarketingCampaignStatus.DRAFT);
    assert.equal(campaign.template_id, TEMPLATE_ID);
    assert.equal(campaign.template_version_id, VERSION_ID);
    assert.equal(campaign.recipient_count, 0, 'no snapshot exists for a draft');
    assert.equal(campaign.audience_snapshot_hash, null);
    assert.equal(campaignRows.length, 1);
  });

  it('refuses an unpublished (draft) template version', async () => {
    const { service } = makeService({ versionPublished: false });
    await assert.rejects(
      service.create(ACTOR, {
        name: 'Autumn outreach',
        template_version_id: VERSION_ID,
        audience_filter: { cities: ['Nagpur'] },
      }),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 409, 'a draft version is a conflict');
        return true;
      },
    );
  });

  it('refuses an archived template', async () => {
    const { service } = makeService({ templateStatus: MarketingTemplateStatus.ARCHIVED });
    await assert.rejects(
      service.create(ACTOR, {
        name: 'Autumn outreach',
        template_version_id: VERSION_ID,
        audience_filter: {},
      }),
      ConflictException,
    );
  });

  it('allows edits on a draft campaign and rejects them once scheduled', async () => {
    const draft = makeService({ campaign: makeCampaignRow(), audience: NAGPUR_AUDIENCE });
    const updated = await draft.service.update(ACTOR, CAMPAIGN_ID, {
      name: 'Renamed outreach',
      audience_filter: { cities: ['Pune'] },
    });
    assert.equal(updated.name, 'Renamed outreach');
    assert.deepEqual(updated.audience_filter, { cities: ['Pune'] });

    const scheduled = makeService({
      campaign: makeCampaignRow({ status: MarketingCampaignStatus.SCHEDULED }),
    });
    await assert.rejects(
      scheduled.service.update(ACTOR, CAMPAIGN_ID, { name: 'too late' }),
      ConflictException,
    );
  });

  it('previews the stored filter of a saved campaign — never a client-sent one', async () => {
    const { service } = makeService({ campaign: makeCampaignRow() });
    const preview = await service.previewAudience({
      campaign_id: CAMPAIGN_ID,
      audience_filter: { cities: ['Mumbai'] },
    });
    // The stored Nagpur filter is echoed, not the Mumbai decoy.
    assert.deepEqual(preview.filter, { cities: ['Nagpur'] });
  });

  it('previews an ad-hoc filter when no campaign id is given', async () => {
    const { service } = makeService({});
    const preview = await service.previewAudience({
      audience_filter: { cities: ['Mumbai'], active_only: false },
    });
    assert.equal(preview.filter.active_only, false);
    assert.equal(preview.snapshot_hash, 'preview-hash');
  });
});

describe('MarketingCampaignsService — scheduling and the recipient snapshot', () => {
  it('schedules inside a transaction: snapshot rows, hash and count are written together', async () => {
    const { service, campaignRows, bulkCreateCalls, transactions } = makeService({
      campaign: makeCampaignRow(),
      audience: NAGPUR_AUDIENCE,
    });

    const result = await service.schedule(ACTOR, CAMPAIGN_ID, {});

    assert.equal(result.already_scheduled, false);
    assert.equal(result.recipients_created, 3);
    assert.equal(transactions.length, 1, 'exactly one transaction is used');
    assert.equal(bulkCreateCalls.length, 1);
    assert.strictEqual(
      (bulkCreateCalls[0].options as { transaction?: unknown } | undefined)?.transaction,
      transactions[0],
      'the recipient rows are written inside the transaction',
    );

    const rows = bulkCreateCalls[0].rows as Array<Record<string, unknown>>;
    assert.deepEqual(
      rows.map((row) => row.normalized_email),
      ['office@alpha.edu', 'office@beta.edu', 'office@gamma.edu'],
    );
    assert.ok(rows.every((row) => row.campaign_id === CAMPAIGN_ID));
    assert.ok(rows.every((row) => row.status === 'PENDING'));
    assert.ok(rows.every((row) => row.attempts === 0));
    assert.ok(
      rows.every(
        (row) => row.click_token_hash === undefined && row.unsubscribe_token_hash === undefined,
      ),
      'no tracking tokens exist yet (Session 3)',
    );

    const campaign = campaignRows[0];
    assert.equal(campaign.status, MarketingCampaignStatus.SCHEDULED);
    assert.ok(campaign.scheduled_at instanceof Date);
    assert.equal(campaign.recipient_count, 3);
    assert.equal(campaign.audience_snapshot_hash, NAGPUR_AUDIENCE.snapshot_hash);
    assert.equal(campaign.sent_count, 0, 'nothing was sent — no email leaves the API');
  });

  it('honours an explicit scheduled_at timestamp', async () => {
    const { service, campaignRows } = makeService({
      campaign: makeCampaignRow(),
      audience: NAGPUR_AUDIENCE,
    });
    await service.schedule(ACTOR, CAMPAIGN_ID, {
      scheduled_at: '2026-10-01T09:30:00.000Z',
    });
    assert.equal(campaignRows[0].scheduled_at?.toISOString(), '2026-10-01T09:30:00.000Z');
  });

  it('rejects a schedule timestamp in the past', async () => {
    const { service } = makeService({ campaign: makeCampaignRow(), audience: NAGPUR_AUDIENCE });
    await assert.rejects(
      service.schedule(ACTOR, CAMPAIGN_ID, { scheduled_at: '2020-01-01T00:00:00.000Z' }),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 400);
        return true;
      },
    );
  });

  it('refuses to schedule an empty audience', async () => {
    const { service } = makeService({
      campaign: makeCampaignRow(),
      audience: makeComputation([]),
    });
    await assert.rejects(
      service.schedule(ACTOR, CAMPAIGN_ID, {}),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 400);
        return true;
      },
    );
  });

  it('is idempotent: an already-scheduled campaign is returned untouched', async () => {
    const { service, bulkCreateCalls, transactions } = makeService({
      campaign: makeCampaignRow({
        status: MarketingCampaignStatus.SCHEDULED,
        scheduled_at: NOW,
        audience_snapshot_hash: 'existing-hash',
        recipient_count: 3,
      }),
      audience: NAGPUR_AUDIENCE,
    });

    const result = await service.schedule(ACTOR, CAMPAIGN_ID, {});

    assert.equal(result.already_scheduled, true);
    assert.equal(result.recipients_created, 0);
    assert.equal(result.campaign.audience_snapshot_hash, 'existing-hash');
    assert.equal(result.campaign.recipient_count, 3);
    assert.equal(bulkCreateCalls.length, 0, 'no second snapshot is written');
    assert.equal(transactions.length, 0, 'not even a transaction is opened');
  });

  it('rejects a snapshot collision as a conflict (unique constraint safety net)', async () => {
    const { service } = makeService({
      campaign: makeCampaignRow(),
      audience: NAGPUR_AUDIENCE,
      failBulkCreate: true,
    });
    await assert.rejects(service.schedule(ACTOR, CAMPAIGN_ID, {}), ConflictException);
  });
});

describe('MarketingCampaignsService — state transitions', () => {
  it('enforces the documented transition map', () => {
    assert.equal(
      isMarketingCampaignTransitionAllowed('schedule', MarketingCampaignStatus.DRAFT),
      true,
    );
    assert.equal(
      isMarketingCampaignTransitionAllowed('schedule', MarketingCampaignStatus.SCHEDULED),
      false,
    );
    assert.equal(
      isMarketingCampaignTransitionAllowed('pause', MarketingCampaignStatus.SCHEDULED),
      true,
    );
    assert.equal(
      isMarketingCampaignTransitionAllowed('pause', MarketingCampaignStatus.SENDING),
      true,
    );
    assert.equal(
      isMarketingCampaignTransitionAllowed('pause', MarketingCampaignStatus.DRAFT),
      false,
    );
    assert.equal(
      isMarketingCampaignTransitionAllowed('resume', MarketingCampaignStatus.PAUSED),
      true,
    );
    assert.equal(
      isMarketingCampaignTransitionAllowed('resume', MarketingCampaignStatus.SCHEDULED),
      false,
    );
    assert.equal(
      isMarketingCampaignTransitionAllowed('cancel', MarketingCampaignStatus.DRAFT),
      true,
    );
    assert.equal(
      isMarketingCampaignTransitionAllowed('cancel', MarketingCampaignStatus.PAUSED),
      true,
    );
    assert.equal(
      isMarketingCampaignTransitionAllowed('cancel', MarketingCampaignStatus.CANCELLED),
      false,
    );
    assert.equal(
      isMarketingCampaignTransitionAllowed('cancel', MarketingCampaignStatus.COMPLETED),
      false,
    );
    // Sanity: every action has at least one legal predecessor.
    for (const action of Object.keys(MARKETING_CAMPAIGN_TRANSITIONS)) {
      assert.ok(
        (MARKETING_CAMPAIGN_TRANSITIONS as Record<string, MarketingCampaignStatus[]>)[action]
          .length > 0,
        action,
      );
    }
  });

  it('pauses a scheduled campaign', async () => {
    const { service, campaignRows } = makeService({
      campaign: makeCampaignRow({ status: MarketingCampaignStatus.SCHEDULED }),
    });
    const campaign = await service.pause(CAMPAIGN_ID);
    assert.equal(campaign.status, MarketingCampaignStatus.PAUSED);
    assert.equal(campaignRows[0].status, MarketingCampaignStatus.PAUSED);
  });

  it('resumes a paused campaign back to SCHEDULED when it never started', async () => {
    const { service, campaignRows } = makeService({
      campaign: makeCampaignRow({
        status: MarketingCampaignStatus.PAUSED,
        started_at: null,
      }),
    });
    const campaign = await service.resume(CAMPAIGN_ID);
    assert.equal(campaign.status, MarketingCampaignStatus.SCHEDULED);
    assert.equal(campaignRows[0].status, MarketingCampaignStatus.SCHEDULED);
  });

  it('resumes a started (paused mid-send) campaign back to SENDING', async () => {
    const { service } = makeService({
      campaign: makeCampaignRow({
        status: MarketingCampaignStatus.PAUSED,
        started_at: NOW,
      }),
    });
    const campaign = await service.resume(CAMPAIGN_ID);
    assert.equal(campaign.status, MarketingCampaignStatus.SENDING);
  });

  it('cancels a scheduled campaign and marks its completion', async () => {
    const { service, campaignRows } = makeService({
      campaign: makeCampaignRow({ status: MarketingCampaignStatus.SCHEDULED }),
    });
    const campaign = await service.cancel(CAMPAIGN_ID);
    assert.equal(campaign.status, MarketingCampaignStatus.CANCELLED);
    assert.ok(campaignRows[0].completed_at instanceof Date);
  });

  it('cancelling also cancels every recipient the worker has not sent yet', async () => {
    const { service, campaignRows, recipientUpdates, transactions } = makeService({
      campaign: makeCampaignRow({ status: MarketingCampaignStatus.SENDING }),
    });

    await service.cancel(CAMPAIGN_ID);

    assert.equal(recipientUpdates.length, 1, 'recipients are cancelled in one statement');
    const values = recipientUpdates[0].values as Record<string, unknown>;
    assert.equal(values.status, MarketingRecipientStatus.CANCELLED);
    assert.equal(values.locked_by, null, 'a cancelled row holds no lease');
    assert.equal(values.next_attempt_at, null, 'a cancelled row is never retried');

    const where = (recipientUpdates[0].options as { where: Record<string, unknown> }).where;
    assert.equal(where.campaign_id, CAMPAIGN_ID);
    assert.strictEqual(
      (recipientUpdates[0].options as { transaction?: unknown }).transaction,
      transactions[0],
      'the status flip and the row cancellation share one transaction',
    );

    // SENT rows are historical fact and PROCESSING rows belong to a worker
    // that still has to record an outcome, so only queued/retrying move.
    const statuses = (where.status as { [key: symbol]: unknown })[Op.in as unknown as symbol] as
      | string[]
      | undefined;
    assert.deepEqual(statuses, [
      MarketingRecipientStatus.PENDING,
      MarketingRecipientStatus.RETRYING,
    ]);

    assert.equal(campaignRows[0].queued_count, 0, 'nothing is left queued after a cancel');
    assert.equal(campaignRows[0].cancelled_count, 2, 'the cancelled rows are counted');
  });

  it('rejects invalid transitions with 409', async () => {
    const cases: Array<{
      action: 'pause' | 'resume' | 'cancel' | 'schedule';
      status: MarketingCampaignStatus;
    }> = [
      { action: 'pause', status: MarketingCampaignStatus.DRAFT },
      { action: 'pause', status: MarketingCampaignStatus.COMPLETED },
      { action: 'resume', status: MarketingCampaignStatus.SCHEDULED },
      { action: 'resume', status: MarketingCampaignStatus.CANCELLED },
      { action: 'cancel', status: MarketingCampaignStatus.CANCELLED },
      { action: 'cancel', status: MarketingCampaignStatus.FAILED },
      { action: 'schedule', status: MarketingCampaignStatus.CANCELLED },
      { action: 'schedule', status: MarketingCampaignStatus.COMPLETED },
    ];
    for (const { action, status } of cases) {
      const { service } = makeService({
        campaign: makeCampaignRow({ status }),
        audience: NAGPUR_AUDIENCE,
      });
      const call =
        action === 'pause'
          ? service.pause(CAMPAIGN_ID)
          : action === 'resume'
            ? service.resume(CAMPAIGN_ID)
            : action === 'cancel'
              ? service.cancel(CAMPAIGN_ID)
              : service.schedule(ACTOR, CAMPAIGN_ID, {});
      await assert.rejects(
        call,
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 409, `${action} from ${status}`);
          return true;
        },
        `${action} from ${status} must be rejected`,
      );
    }
  });
});

describe('MarketingCampaignsService — list and detail', () => {
  it('lists campaigns with template attribution and pagination meta', async () => {
    const { service } = makeService({ campaign: makeCampaignRow() });
    const list = await service.list({ page: 1, limit: 20 });
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].template_name, 'Welcome email');
    assert.equal(list.items[0].template_slug, 'welcome-email');
    assert.equal(list.items[0].template_version, 3);
    assert.equal(list.meta.total, 1);
  });

  it('returns campaign details with the pinned template summary', async () => {
    const { service } = makeService({ campaign: makeCampaignRow() });
    const detail = await service.findOneOrThrow(CAMPAIGN_ID);
    assert.equal(detail.template?.slug, 'welcome-email');
    assert.equal(detail.template?.version, 3);
    assert.equal(detail.template?.subject, 'Hello');
  });
});
