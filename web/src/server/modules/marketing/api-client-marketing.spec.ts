import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import {
  MarketingCampaignStatus,
  MarketingRecipientSource,
  MarketingSuppressionReason,
  MarketingTemplateStatus,
} from '@school-bus-tracking/shared-types';
import type {
  MarketingAudiencePreviewRequest,
  MarketingCampaignCreateRequest,
  MarketingCampaignScheduleRequest,
  MarketingCampaignUpdateRequest,
  MarketingTemplateContentSaveRequest,
  MarketingTemplateCreateRequest,
  MarketingTemplatePreviewRequest,
  MarketingTemplateTestSendRequest,
  MarketingTemplateUpdateRequest,
} from '@school-bus-tracking/shared-types';

/**
 * The request/response contracts of the marketing api-client methods —
 * verbs, paths, bodies and query strings, recorded through a fetch double so
 * no network is touched. Session 3's React screens will consume exactly these
 * methods (never a direct `fetch`).
 */

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN_ID = '33333333-3333-4333-8333-333333333333';

interface RecordedRequest {
  url: string;
  method: string;
  body?: string;
}

function recordingClient(): { client: ApiClient; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body as string | undefined,
    });
    return new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    client: new ApiClient({ baseUrl: 'https://api.example.test/api/v1' }),
    requests,
  };
}

describe('ApiClient marketing template methods', () => {
  it('targets the template endpoints with the correct verbs and bodies', async () => {
    const { client, requests } = recordingClient();

    await client.listMarketingTemplates({
      page: 2,
      limit: 10,
      search: 'wel',
      status: MarketingTemplateStatus.PUBLISHED,
      sort: 'name',
      order: 'asc',
    });
    const createBody: MarketingTemplateCreateRequest = {
      name: 'Welcome email',
      slug: 'welcome-email',
      content: {
        subject: 'Hello {{school_name}}',
        html_body: '<p>Hello {{school_name}}</p>',
        text_body: 'Hello {{school_name}}',
        allowed_variables: [{ name: 'school_name', required: true }],
      },
    };
    await client.createMarketingTemplate(createBody);
    await client.getMarketingTemplate(TEMPLATE_ID);
    const updateBody: MarketingTemplateUpdateRequest = { name: 'Renamed' };
    await client.updateMarketingTemplate(TEMPLATE_ID, updateBody);
    const contentBody: MarketingTemplateContentSaveRequest = {
      subject: 'Hello {{school_name}}',
      html_body: '<p>Hello</p>',
      text_body: 'Hello',
    };
    await client.saveMarketingTemplateContent(TEMPLATE_ID, contentBody);
    await client.publishMarketingTemplateVersion(TEMPLATE_ID, VERSION_ID);
    await client.archiveMarketingTemplate(TEMPLATE_ID);
    const previewBody: MarketingTemplatePreviewRequest = { variables: { school_name: 'Lincoln' } };
    await client.previewMarketingTemplate(TEMPLATE_ID, previewBody);
    const testBody: MarketingTemplateTestSendRequest = { variables: { school_name: 'Lincoln' } };
    await client.testSendMarketingTemplateVersion(TEMPLATE_ID, VERSION_ID, testBody);

    const [list, create, get, update, content, publish, archive, preview, testSend] = requests;

    assert.equal(list.method, 'GET');
    assert.equal(
      list.url,
      'https://api.example.test/api/v1/marketing/templates?page=2&limit=10&search=wel&status=PUBLISHED&sort=name&order=asc',
    );

    assert.equal(create.method, 'POST');
    assert.equal(create.url, 'https://api.example.test/api/v1/marketing/templates');
    assert.ok(create.body?.includes('"slug":"welcome-email"'));

    assert.equal(get.method, 'GET');
    assert.equal(get.url, `https://api.example.test/api/v1/marketing/templates/${TEMPLATE_ID}`);

    assert.equal(update.method, 'PATCH');
    assert.ok(update.body?.includes('"name":"Renamed"'));

    assert.equal(content.method, 'PUT');
    assert.equal(
      content.url,
      `https://api.example.test/api/v1/marketing/templates/${TEMPLATE_ID}/content`,
    );

    assert.equal(publish.method, 'POST');
    assert.equal(
      publish.url,
      `https://api.example.test/api/v1/marketing/templates/${TEMPLATE_ID}/versions/${VERSION_ID}/publish`,
    );

    assert.equal(archive.method, 'POST');
    assert.equal(
      archive.url,
      `https://api.example.test/api/v1/marketing/templates/${TEMPLATE_ID}/archive`,
    );

    assert.equal(preview.method, 'POST');
    assert.equal(
      preview.url,
      `https://api.example.test/api/v1/marketing/templates/${TEMPLATE_ID}/preview`,
    );

    // The test-send request carries sample variables but NEVER a recipient.
    assert.equal(testSend.method, 'POST');
    assert.equal(
      testSend.url,
      `https://api.example.test/api/v1/marketing/templates/${TEMPLATE_ID}/versions/${VERSION_ID}/test-send`,
    );
    assert.ok(!testSend.body?.includes('@'));
    assert.ok(!testSend.body?.includes('"to"'));
  });

  it('sends no test-recipient field at all when the body is omitted', async () => {
    const { client, requests } = recordingClient();
    await client.testSendMarketingTemplateVersion(TEMPLATE_ID, VERSION_ID);
    const [request] = requests;
    assert.ok(!request.body || !request.body.includes('@'));
  });
});

describe('ApiClient marketing campaign methods', () => {
  it('targets the campaign endpoints with the correct verbs and bodies', async () => {
    const { client, requests } = recordingClient();

    await client.listMarketingCampaigns({
      page: 1,
      limit: 50,
      search: 'autumn',
      status: MarketingCampaignStatus.SCHEDULED,
    });
    const createBody: MarketingCampaignCreateRequest = {
      name: 'Autumn outreach',
      template_version_id: VERSION_ID,
      audience_filter: { cities: ['Nagpur'] },
    };
    await client.createMarketingCampaign(createBody);
    await client.getMarketingCampaign(CAMPAIGN_ID);
    const updateBody: MarketingCampaignUpdateRequest = {
      name: 'Renamed outreach',
      audience_filter: { cities: ['Pune'] },
    };
    await client.updateMarketingCampaign(CAMPAIGN_ID, updateBody);
    const previewBody: MarketingAudiencePreviewRequest = {
      campaign_id: CAMPAIGN_ID,
    };
    await client.previewMarketingAudience(previewBody);
    const scheduleBody: MarketingCampaignScheduleRequest = {
      scheduled_at: '2026-10-01T09:30:00.000Z',
    };
    await client.scheduleMarketingCampaign(CAMPAIGN_ID, scheduleBody);
    await client.pauseMarketingCampaign(CAMPAIGN_ID);
    await client.resumeMarketingCampaign(CAMPAIGN_ID);
    await client.cancelMarketingCampaign(CAMPAIGN_ID);

    const [list, create, get, update, preview, schedule, pause, resume, cancel] = requests;

    assert.equal(list.method, 'GET');
    assert.equal(
      list.url,
      'https://api.example.test/api/v1/marketing/campaigns?page=1&limit=50&search=autumn&status=SCHEDULED',
    );

    assert.equal(create.method, 'POST');
    assert.equal(create.url, 'https://api.example.test/api/v1/marketing/campaigns');
    assert.ok(create.body?.includes('"template_version_id"'));

    assert.equal(get.method, 'GET');
    assert.equal(get.url, `https://api.example.test/api/v1/marketing/campaigns/${CAMPAIGN_ID}`);

    assert.equal(update.method, 'PATCH');

    // The audience preview is a POST under the campaigns namespace, and the
    // static segment must not be swallowed by the neighbouring [id] route.
    assert.equal(preview.method, 'POST');
    assert.equal(
      preview.url,
      'https://api.example.test/api/v1/marketing/campaigns/audience-preview',
    );

    assert.equal(schedule.method, 'POST');
    assert.equal(
      schedule.url,
      `https://api.example.test/api/v1/marketing/campaigns/${CAMPAIGN_ID}/schedule`,
    );

    assert.equal(pause.method, 'POST');
    assert.equal(
      pause.url,
      `https://api.example.test/api/v1/marketing/campaigns/${CAMPAIGN_ID}/pause`,
    );

    assert.equal(resume.method, 'POST');
    assert.equal(
      resume.url,
      `https://api.example.test/api/v1/marketing/campaigns/${CAMPAIGN_ID}/resume`,
    );

    assert.equal(cancel.method, 'POST');
    assert.equal(
      cancel.url,
      `https://api.example.test/api/v1/marketing/campaigns/${CAMPAIGN_ID}/cancel`,
    );
  });

  it('never sends recipient addresses or school emails in any campaign call', async () => {
    const { client, requests } = recordingClient();
    await client.previewMarketingAudience({
      audience_filter: {
        cities: ['Nagpur'],
        recipient_sources: [MarketingRecipientSource.SCHOOL_EMAIL],
      },
    });
    await client.createMarketingCampaign({
      name: 'Autumn outreach',
      template_version_id: VERSION_ID,
      audience_filter: { cities: ['Nagpur'] },
    });
    for (const request of requests) {
      assert.ok(!request.body?.includes('@'), 'no address may appear in a campaign request');
    }
  });
});

/**
 * Hardening 5B additions: the suppression console and lead erasure.
 *
 * Two contracts matter beyond verbs and paths. The suppression *create* call
 * is the one place in the whole client where an address is legitimately sent
 * (an operator is recording a bounce), and the *delete* call must carry its
 * confirmation in the body — a DELETE that confirms itself in a query string
 * is a link someone can be tricked into following.
 */
describe('ApiClient marketing suppression and erasure methods', () => {
  const SUPPRESSION_ID = '44444444-4444-4444-8444-444444444444';
  const LEAD_ID = '55555555-5555-4555-8555-555555555555';

  it('lists suppressions with filters in the query string', async () => {
    const { client, requests } = recordingClient();

    await client.listMarketingSuppressions({
      page: 2,
      limit: 20,
      reason: MarketingSuppressionReason.HARD_BOUNCE,
      search: 'school.test',
    });

    assert.equal(requests[0].method, 'GET');
    assert.equal(
      requests[0].url,
      'https://api.example.test/api/v1/marketing/suppressions?page=2&limit=20&reason=HARD_BOUNCE&search=school.test',
    );
  });

  it('omits absent filters entirely rather than sending empty values', async () => {
    const { client, requests } = recordingClient();
    await client.listMarketingSuppressions();
    assert.equal(requests[0].url, 'https://api.example.test/api/v1/marketing/suppressions');
  });

  it('posts a manual suppression with its reason and optional note', async () => {
    const { client, requests } = recordingClient();

    await client.createMarketingSuppression({
      email: 'principal@school.test',
      reason: MarketingSuppressionReason.HARD_BOUNCE,
      note: 'mailbox does not exist',
    });

    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, 'https://api.example.test/api/v1/marketing/suppressions');
    assert.deepEqual(JSON.parse(String(requests[0].body)), {
      email: 'principal@school.test',
      reason: MarketingSuppressionReason.HARD_BOUNCE,
      note: 'mailbox does not exist',
    });
  });

  it('sends the removal confirmation in the body, never in the URL', async () => {
    const { client, requests } = recordingClient();

    await client.deleteMarketingSuppression(SUPPRESSION_ID, {
      confirm: true,
      acknowledge_unsubscribed: true,
    });

    assert.equal(requests[0].method, 'DELETE');
    assert.equal(
      requests[0].url,
      `https://api.example.test/api/v1/marketing/suppressions/${SUPPRESSION_ID}`,
    );
    assert.ok(!requests[0].url.includes('confirm'), 'a confirmation is not a link');
    assert.deepEqual(JSON.parse(String(requests[0].body)), {
      confirm: true,
      acknowledge_unsubscribed: true,
    });
  });

  it('posts the lead erasure with an explicit confirmation', async () => {
    const { client, requests } = recordingClient();

    await client.eraseMarketingLead(LEAD_ID, { confirm: true });

    assert.equal(requests[0].method, 'POST');
    assert.equal(
      requests[0].url,
      `https://api.example.test/api/v1/marketing/leads/${LEAD_ID}/erase`,
    );
    assert.deepEqual(JSON.parse(String(requests[0].body)), { confirm: true });
  });

  it('never sends an address on any call except the deliberate suppression create', async () => {
    const { client, requests } = recordingClient();

    await client.listMarketingSuppressions({ search: 'school.test' });
    await client.deleteMarketingSuppression(SUPPRESSION_ID, { confirm: true });
    await client.eraseMarketingLead(LEAD_ID, { confirm: true });

    for (const request of requests) {
      assert.ok(!request.body?.includes('@'));
      assert.ok(!request.url.includes('@'));
    }
  });
});
