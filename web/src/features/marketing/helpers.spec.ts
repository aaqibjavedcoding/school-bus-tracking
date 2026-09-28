import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  MARKETING_LEAD_STATUS_TRANSITIONS,
  MarketingCampaignStatus,
  MarketingLeadEventType,
  MarketingLeadSource,
  MarketingLeadStatus,
  MarketingRecipientSource,
  MarketingTemplateStatus,
  type MarketingCampaignResponse,
  type MarketingTemplateSummary,
} from '@school-bus-tracking/shared-types';
import {
  campaignClickRate,
  campaignCompletionPercent,
  campaignOutstandingCount,
  campaignProgressSegments,
  canArchiveTemplate,
  canCancelCampaign,
  canEditCampaign,
  canPauseCampaign,
  canPublishTemplateVersion,
  canResumeCampaign,
  canScheduleCampaign,
  canTestSendVersion,
  describeAudienceFilter,
  describeGradualDelivery,
  describeLeadEvent,
  describeTemplateVersions,
  isCampaignTerminal,
  isTemplateVersionEditable,
  marketingCampaignStatusLabel,
  marketingCampaignStatusTone,
  marketingLeadActionLabel,
  marketingLeadNextStatuses,
  marketingLeadSourceLabel,
  marketingLeadStatusLabel,
  marketingTemplateStatusLabel,
  marketingTemplateStatusTone,
  parseFilterList,
  MARKETING_TEST_SEND_NOTE,
} from './helpers.ts';

/**
 * The marketing console's decisions, tested without a DOM.
 *
 * Web specs in this repo run under `node --test`, so the pages keep their
 * logic in these helpers. What is asserted here is what an operator can and
 * cannot do — the wrong answer means either a dead button or, worse, a
 * "Resume" offered on a cancelled campaign.
 */

function campaign(overrides: Partial<MarketingCampaignResponse> = {}): MarketingCampaignResponse {
  return {
    id: 'c-1',
    name: 'Autumn announcement',
    template_id: 't-1',
    template_version_id: 'v-1',
    status: MarketingCampaignStatus.SENDING,
    audience_filter: {},
    audience_snapshot_hash: 'hash',
    scheduled_at: '2026-09-27T10:00:00.000Z',
    started_at: '2026-09-27T10:01:00.000Z',
    completed_at: null,
    recipient_count: 100,
    queued_count: 40,
    processing_count: 2,
    sent_count: 50,
    retrying_count: 3,
    failed_count: 2,
    suppressed_count: 2,
    skipped_count: 1,
    cancelled_count: 0,
    expired_count: 0,
    clicked_count: 10,
    total_click_count: 14,
    unsubscribed_count: 1,
    created_by: 'u-1',
    created_at: '2026-09-26T10:00:00.000Z',
    updated_at: '2026-09-27T10:05:00.000Z',
    ...overrides,
  };
}

describe('template status presentation', () => {
  it('labels and tones every template status', () => {
    assert.equal(marketingTemplateStatusLabel(MarketingTemplateStatus.DRAFT), 'Draft');
    assert.equal(marketingTemplateStatusLabel(MarketingTemplateStatus.PUBLISHED), 'Published');
    assert.equal(marketingTemplateStatusLabel(MarketingTemplateStatus.ARCHIVED), 'Archived');
    assert.equal(marketingTemplateStatusTone(MarketingTemplateStatus.PUBLISHED), 'success');
    assert.equal(marketingTemplateStatusTone(MarketingTemplateStatus.DRAFT), 'warning');
    assert.equal(marketingTemplateStatusTone(MarketingTemplateStatus.ARCHIVED), 'neutral');
  });

  it('summarizes the published/draft split for the list row', () => {
    const base = {
      id: 't-1',
      name: 'Autumn',
      slug: 'autumn',
      status: MarketingTemplateStatus.PUBLISHED,
      created_by: null,
      updated_by: null,
      created_at: '',
      updated_at: '',
      version_count: 3,
    };
    assert.equal(
      describeTemplateVersions({
        ...base,
        latest_published_version: 2,
        draft_version: 3,
      } as MarketingTemplateSummary),
      'v2 published · v3 draft',
    );
    assert.equal(
      describeTemplateVersions({
        ...base,
        latest_published_version: null,
        draft_version: 1,
      } as MarketingTemplateSummary),
      'no published version · v1 draft',
    );
  });
});

describe('template editing rules', () => {
  it('allows editing and publishing only an unpublished draft', () => {
    const draft = { published_at: null };
    const published = { published_at: '2026-09-27T00:00:00.000Z' };

    assert.equal(isTemplateVersionEditable(draft, MarketingTemplateStatus.DRAFT), true);
    assert.equal(
      isTemplateVersionEditable(published, MarketingTemplateStatus.PUBLISHED),
      false,
      'a published version is immutable — that is what makes a campaign reproducible',
    );
    assert.equal(canPublishTemplateVersion(draft, MarketingTemplateStatus.DRAFT), true);
    assert.equal(canPublishTemplateVersion(published, MarketingTemplateStatus.PUBLISHED), false);
  });

  it('never offers editing on an archived template', () => {
    assert.equal(isTemplateVersionEditable({ published_at: null }, MarketingTemplateStatus.ARCHIVED), false);
    assert.equal(canArchiveTemplate(MarketingTemplateStatus.ARCHIVED), false);
    assert.equal(canArchiveTemplate(MarketingTemplateStatus.PUBLISHED), true);
  });

  it('offers a test send for any existing version, with the restriction spelled out', () => {
    assert.equal(canTestSendVersion({ id: 'v-1' }), true);
    assert.equal(canTestSendVersion(null), false);
    assert.match(MARKETING_TEST_SEND_NOTE, /MARKETING_TEST_RECIPIENTS/);
    assert.match(MARKETING_TEST_SEND_NOTE, /cannot type a recipient/i);
  });
});

describe('campaign status presentation', () => {
  it('labels every campaign status in operator language', () => {
    assert.equal(marketingCampaignStatusLabel(MarketingCampaignStatus.SENDING), 'Sending');
    assert.equal(
      marketingCampaignStatusLabel(MarketingCampaignStatus.PARTIALLY_FAILED),
      'Completed with failures',
    );
    assert.equal(marketingCampaignStatusTone(MarketingCampaignStatus.COMPLETED), 'success');
    assert.equal(marketingCampaignStatusTone(MarketingCampaignStatus.PAUSED), 'warning');
    assert.equal(marketingCampaignStatusTone(MarketingCampaignStatus.FAILED), 'danger');
  });

  it('knows which statuses are terminal', () => {
    assert.equal(isCampaignTerminal(MarketingCampaignStatus.CANCELLED), true);
    assert.equal(isCampaignTerminal(MarketingCampaignStatus.SENDING), false);
  });
});

describe('campaign lifecycle controls', () => {
  it('offers schedule and edit on drafts only', () => {
    assert.equal(canScheduleCampaign(MarketingCampaignStatus.DRAFT), true);
    assert.equal(canScheduleCampaign(MarketingCampaignStatus.SCHEDULED), false);
    assert.equal(canEditCampaign(MarketingCampaignStatus.SCHEDULED), false);
  });

  it('offers pause while sending and resume only when paused', () => {
    assert.equal(canPauseCampaign(MarketingCampaignStatus.SENDING), true);
    assert.equal(canPauseCampaign(MarketingCampaignStatus.SCHEDULED), true);
    assert.equal(canPauseCampaign(MarketingCampaignStatus.PAUSED), false);
    assert.equal(canResumeCampaign(MarketingCampaignStatus.PAUSED), true);
    assert.equal(canResumeCampaign(MarketingCampaignStatus.SENDING), false);
  });

  it('never offers a lifecycle action on a terminal campaign', () => {
    for (const status of [
      MarketingCampaignStatus.COMPLETED,
      MarketingCampaignStatus.PARTIALLY_FAILED,
      MarketingCampaignStatus.FAILED,
      MarketingCampaignStatus.CANCELLED,
    ]) {
      assert.equal(canPauseCampaign(status), false, `${status} cannot be paused`);
      assert.equal(canResumeCampaign(status), false, `${status} cannot be resumed`);
      assert.equal(canCancelCampaign(status), false, `${status} cannot be cancelled again`);
    }
    assert.equal(canCancelCampaign(MarketingCampaignStatus.DRAFT), true);
  });
});

describe('campaign progress', () => {
  it('breaks the snapshot into non-zero segments that add up', () => {
    const segments = campaignProgressSegments(campaign());
    const total = segments.reduce((sum, segment) => sum + segment.count, 0);

    assert.equal(total, 100, 'every recipient is accounted for exactly once');
    assert.deepEqual(
      segments.map((segment) => segment.key),
      ['sent', 'processing', 'retrying', 'failed', 'suppressed', 'skipped', 'queued'],
    );
    assert.equal(segments[0].percent, 50);
    assert.equal(segments[0].tone, 'success');
  });

  it('omits empty buckets instead of rendering zeros', () => {
    const segments = campaignProgressSegments(
      campaign({
        queued_count: 0,
        processing_count: 0,
        retrying_count: 0,
        failed_count: 0,
        suppressed_count: 0,
        skipped_count: 0,
        sent_count: 100,
      }),
    );
    assert.deepEqual(
      segments.map((segment) => segment.key),
      ['sent'],
    );
  });

  it('computes completion from terminal recipients only', () => {
    assert.equal(campaignCompletionPercent(campaign()), 55, '100 - (40 queued + 2 + 3)');
    assert.equal(campaignOutstandingCount(campaign()), 45);
    assert.equal(
      campaignCompletionPercent(campaign({ recipient_count: 0, queued_count: 0 })),
      0,
      'an empty snapshot is 0%, never NaN',
    );
  });

  it('never reports a negative count from a stale row', () => {
    const segments = campaignProgressSegments(
      campaign({ sent_count: -5 as unknown as number, recipient_count: 10 }),
    );
    assert.equal(
      segments.every((segment) => segment.count >= 0),
      true,
    );
  });

  it('reports click-through over delivered mail, or nothing before the first send', () => {
    assert.equal(campaignClickRate(campaign()), 20);
    assert.equal(campaignClickRate(campaign({ sent_count: 0 })), null);
  });
});

describe('gradual delivery explanation', () => {
  it('states the pace, the duration and the reason', () => {
    const sentence = describeGradualDelivery(600, 60);
    assert.match(sentence, /60 emails per minute/);
    assert.match(sentence, /10 minutes/);
    assert.match(sentence, /reputation/);
  });

  it('switches to hours for a long campaign and never claims zero minutes', () => {
    assert.match(describeGradualDelivery(7200, 60), /2 hours/);
    assert.match(describeGradualDelivery(1, 60), /1 minute/);
    assert.match(describeGradualDelivery(0, 0), /1 minute/);
  });
});

describe('audience filter description', () => {
  it('reads back a filter in plain language', () => {
    const description = describeAudienceFilter({
      cities: ['Nagpur', 'Pune'],
      subscription_statuses: ['active'],
      recipient_sources: [MarketingRecipientSource.SCHOOL_EMAIL],
    });
    assert.match(description, /Nagpur, Pune/);
    assert.match(description, /subscription active/);
    assert.match(description, /active only/);
    assert.match(description, /main contact address/);
  });

  it('describes an empty filter as all schools', () => {
    assert.match(describeAudienceFilter({}), /^All schools/);
  });

  it('names the admin source only when it was explicitly requested', () => {
    assert.equal(
      describeAudienceFilter({}).includes('administrators'),
      false,
      'SCHOOL_ADMIN is opt-in; the default must not imply it',
    );
    assert.match(
      describeAudienceFilter({ recipient_sources: [MarketingRecipientSource.SCHOOL_ADMIN] }),
      /administrators/,
    );
  });
});

describe('parseFilterList', () => {
  it('splits, trims and drops empties', () => {
    assert.deepEqual(parseFilterList(' Nagpur, Pune \n Mumbai ,,'), ['Nagpur', 'Pune', 'Mumbai']);
    assert.deepEqual(parseFilterList('   '), []);
  });
});

describe('demo lead helpers (Session 4)', () => {
  it('labels every lead status and source', () => {
    for (const status of Object.values(MarketingLeadStatus)) {
      assert.ok(marketingLeadStatusLabel(status).length > 0, status);
    }
    for (const source of Object.values(MarketingLeadSource)) {
      assert.ok(marketingLeadSourceLabel(source).length > 0, source);
    }
    assert.equal(marketingLeadStatusLabel(MarketingLeadStatus.DEMO_SCHEDULED), 'Demo scheduled');
  });

  it('mirrors the server transition graph exactly — the UI only offers, the API decides', () => {
    for (const status of Object.values(MarketingLeadStatus)) {
      assert.deepEqual(
        marketingLeadNextStatuses(status),
        [...(MARKETING_LEAD_STATUS_TRANSITIONS[status] ?? [])],
        status,
      );
    }
    // The invariants the pipeline wording rests on:
    assert.equal(
      marketingLeadNextStatuses(MarketingLeadStatus.NEW).includes(
        MarketingLeadStatus.DEMO_SCHEDULED,
      ),
      false,
      'a fresh request can never claim a confirmed appointment',
    );
    assert.deepEqual(
      marketingLeadNextStatuses(MarketingLeadStatus.CONVERTED),
      [],
      'CONVERTED is terminal',
    );
  });

  it('words the scheduled transition as an operator action, never an automatic booking', () => {
    assert.equal(
      marketingLeadActionLabel(MarketingLeadStatus.DEMO_SCHEDULED),
      'Mark demo scheduled',
    );
    assert.equal(marketingLeadActionLabel(MarketingLeadStatus.LOST), 'Mark lost');
  });

  it('describes timeline events without leaking raw enum names', () => {
    assert.equal(
      describeLeadEvent({
        event_type: MarketingLeadEventType.CREATED,
        metadata: { attributed: true },
      }),
      'Demo request received (campaign-attributed visit)',
    );
    assert.equal(
      describeLeadEvent({
        event_type: MarketingLeadEventType.STATUS_CHANGED,
        metadata: { from: 'NEW', to: 'CONTACTED' },
      }),
      'Status changed: New → Contacted',
    );
    assert.equal(
      describeLeadEvent({ event_type: MarketingLeadEventType.NOTE_ADDED, metadata: { note: 'x' } }),
      'Note: x',
    );
    assert.match(
      describeLeadEvent({ event_type: MarketingLeadEventType.ADMIN_NOTIFY_FAILED, metadata: null }),
      /lead is safely stored/,
      'a failed notification is presented as recorded, not as a lost lead',
    );
  });
});
