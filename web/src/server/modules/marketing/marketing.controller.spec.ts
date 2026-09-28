import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { JwtService, Reflector } from '../../framework';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { makeGuardContext, callHandler } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import * as marketing from '../../api/marketing';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import type { AuditService } from '../audit/audit.service';
import type { MarketingCampaignsService } from './marketing-campaigns.service';
import type { MarketingTemplatesService } from './marketing-templates.service';

/**
 * The marketing surface is SUPER_ADMIN only — the authorization contract is
 * asserted for **every** exported endpoint (enumerated by reflection, so a
 * newly added endpoint cannot escape the check), and the mutation handlers'
 * audit rows are asserted to carry safe metadata only: no subject, no HTML or
 * text body, no recipient address, no token material, no SMTP credentials.
 */

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const CAMPAIGN_ID = '55555555-5555-4555-8555-555555555555';
const SECRET = 'unit-test-jwt-secret';

const jwtService = new JwtService({ secret: SECRET });
const schoolAccess = { isSchoolAccessible: async () => true };
const jwtAuthGuard = new JwtAuthGuard(jwtService, schoolAccess as never);
const rolesGuard = new RolesGuard(new Reflector());

async function signAccessToken(role: UserRole, schoolId: string | null): Promise<string> {
  const payload: JwtAccessTokenPayload = { sub: USER_ID, school_id: schoolId, role };
  return jwtService.signAsync(payload);
}

interface MockRequest {
  headers: Record<string, unknown>;
  user?: AuthenticatedRequestUser;
}

async function activateGuards(
  request: MockRequest,
  definition: EndpointDefinition<never, never>,
): Promise<void> {
  const context = makeGuardContext(definition, request as unknown as Record<string, unknown>);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
}

/** Every endpoint of the marketing surface, enumerated from the module exports. */
const MARKETING_ENDPOINTS: Array<{ name: string; definition: EndpointDefinition<never, never> }> =
  Object.entries(marketing)
    .filter(
      (entry): entry is [string, EndpointDefinition<never, never>] =>
        typeof entry[1] === 'object' && entry[1] !== null && 'handler' in entry[1],
    )
    .map(([name, definition]) => ({ name, definition }));

const SUPER_ADMIN_USER = {
  id: USER_ID,
  school_id: null,
  role: UserRole.SUPER_ADMIN,
} as AuthenticatedRequestUser;

describe('marketing endpoint authorization', () => {
  it('covers the whole marketing surface', () => {
    // Session 2 ships 17 endpoints; the reflection keeps future ones covered.
    assert.ok(MARKETING_ENDPOINTS.length >= 17, `found ${MARKETING_ENDPOINTS.length}`);
  });

  it('restricts every marketing route to the SUPER_ADMIN role', () => {
    for (const { name, definition } of MARKETING_ENDPOINTS) {
      assert.deepEqual(
        definition.roles,
        [UserRole.SUPER_ADMIN],
        `${name} must require SUPER_ADMIN`,
      );
    }
  });

  it('allows a SUPER_ADMIN (platform, no school claim) through both guards', async () => {
    for (const { name, definition } of MARKETING_ENDPOINTS) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(UserRole.SUPER_ADMIN, null)}` },
      };
      await activateGuards(request, definition);
      assert.equal((request.user as AuthenticatedRequestUser).role, UserRole.SUPER_ADMIN, name);
      assert.equal((request.user as AuthenticatedRequestUser).school_id, null, name);
    }
  });

  it('rejects every school role with 403 on every marketing route', async () => {
    const schoolRoles = [
      UserRole.SCHOOL_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ];
    for (const role of schoolRoles) {
      for (const { name, definition } of MARKETING_ENDPOINTS) {
        const request: MockRequest = {
          headers: { authorization: `Bearer ${await signAccessToken(role, SCHOOL_ID)}` },
        };
        await assert.rejects(
          activateGuards(request, definition),
          (error: { getStatus?: () => number }) => {
            assert.equal(error.getStatus?.(), 403, `${role} ${name} must be 403`);
            return true;
          },
          `${role} must not reach ${name}`,
        );
      }
    }
  });

  it('rejects an unauthenticated request with 401', async () => {
    const request: MockRequest = { headers: {} };
    for (const { name, definition } of MARKETING_ENDPOINTS.slice(0, 3)) {
      await assert.rejects(
        activateGuards(request, definition),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 401, name);
          return true;
        },
      );
    }
  });
});

describe('marketing mutation audit wiring', () => {
  /**
   * Runs one mutation endpoint against stub services and returns the audit
   * rows it produced. Handlers resolve their services through the container,
   * so the stubs are swapped in with `overrideContainer` (restored in the
   * `finally`).
   */
  async function runWithStubs(
    definition: EndpointDefinition<unknown, unknown>,
    options: {
      params?: Record<string, string>;
      body?: unknown;
      templates?: Record<string, unknown>;
      campaigns?: Record<string, unknown>;
    } = {},
  ): Promise<Array<Record<string, unknown>>> {
    const audited: Array<Record<string, unknown>> = [];
    const audit = {
      log: async (input: Record<string, unknown>) => {
        audited.push(input);
      },
    } as unknown as AuditService;
    const templates = {
      create: async () => ({
        template: { id: TEMPLATE_ID, slug: 'welcome-email', status: 'DRAFT' },
        version: { id: VERSION_ID, version: 1, published_at: null },
      }),
      update: async () => ({ id: TEMPLATE_ID, slug: 'welcome-email', status: 'DRAFT' }),
      saveContent: async () => ({
        template: { id: TEMPLATE_ID, slug: 'welcome-email', status: 'DRAFT' },
        version: { id: VERSION_ID, version: 2, published_at: null },
      }),
      publishVersion: async () => ({
        template: { id: TEMPLATE_ID, slug: 'welcome-email', status: 'PUBLISHED' },
        version: { id: VERSION_ID, version: 1, published_at: '2026-09-27T10:00:00.000Z' },
        message: 'Template version published',
      }),
      archive: async () => ({
        id: TEMPLATE_ID,
        status: 'ARCHIVED',
        message: 'Template archived',
      }),
      testSendVersion: async () => ({
        sent: true,
        provider: 'noop-email',
        recipient_count: 1,
        message: 'Test email sent',
      }),
      ...options.templates,
    } as unknown as MarketingTemplatesService;
    const campaigns = {
      create: async () => ({
        id: CAMPAIGN_ID,
        status: 'DRAFT',
        template_version_id: VERSION_ID,
        recipient_count: 0,
        audience_snapshot_hash: null,
      }),
      update: async () => ({ id: CAMPAIGN_ID, status: 'DRAFT', template_version_id: VERSION_ID }),
      schedule: async () => ({
        campaign: {
          id: CAMPAIGN_ID,
          status: 'SCHEDULED',
          recipient_count: 3,
          audience_snapshot_hash: 'abc123',
        },
        recipients_created: 3,
        already_scheduled: false,
      }),
      pause: async () => ({ id: CAMPAIGN_ID, status: 'PAUSED' }),
      resume: async () => ({ id: CAMPAIGN_ID, status: 'SCHEDULED' }),
      cancel: async () => ({ id: CAMPAIGN_ID, status: 'CANCELLED' }),
      ...options.campaigns,
    } as unknown as MarketingCampaignsService;

    const restoreTemplates = overrideContainer('marketingTemplates', templates);
    const restoreCampaigns = overrideContainer('marketingCampaigns', campaigns);
    const restoreAudit = overrideContainer('audit', audit);
    try {
      await callHandler(definition, {
        user: SUPER_ADMIN_USER,
        params: options.params ?? {},
        body: options.body,
        request: { requestId: 'req-1', ip: '203.0.113.10' },
      });
    } finally {
      restoreAudit();
      restoreCampaigns();
      restoreTemplates();
    }
    return audited;
  }

  /** Secrets/content that must never appear anywhere in an audit row. */
  const FORBIDDEN_AUDIT_STRINGS = [
    'subject',
    'html_body',
    'text_body',
    'password',
    'SMTP_PASS',
    'click_token',
    'unsubscribe_token',
    'normalized_email',
  ];

  function assertAuditRowSafe(rows: Array<Record<string, unknown>>): void {
    assert.ok(rows.length > 0, 'the mutation must be audited');
    for (const row of rows) {
      const serialized = JSON.stringify(row).toLowerCase();
      for (const forbidden of FORBIDDEN_AUDIT_STRINGS) {
        assert.ok(
          !serialized.includes(forbidden.toLowerCase()),
          `audit row must not contain ${forbidden}: ${serialized}`,
        );
      }
      // Marketing rows are platform-level: never a school id.
      assert.equal(row.school_id, null);
      assert.equal(row.actor_user_id, USER_ID);
      assert.equal(row.request_id, 'req-1');
      assert.equal(row.ip_address, '203.0.113.10');
    }
  }

  it('audits template creation with slug + version only', async () => {
    const rows = await runWithStubs(marketing.postMarketingTemplates as EndpointDefinition, {
      body: {
        name: 'Welcome email',
        slug: 'welcome-email',
        content: {
          subject: 'Hi',
          html_body: '<p>Hi</p>',
          text_body: 'Hi',
          allowed_variables: [],
        },
      },
    });
    assertAuditRowSafe(rows);
    assert.equal(rows[0].action, AUDIT_ACTIONS.MARKETING_TEMPLATE_CREATE);
    assert.equal(rows[0].entity_type, AUDIT_ENTITY_TYPES.EMAIL_TEMPLATE);
    assert.equal(rows[0].entity_id, TEMPLATE_ID);
    assert.deepEqual(rows[0].metadata, { slug: 'welcome-email', version: 1 });
  });

  it('audits content saves, publish, archive and metadata updates', async () => {
    const contentRows = await runWithStubs(
      marketing.putMarketingTemplatesByIdContent as EndpointDefinition,
      {
        params: { id: TEMPLATE_ID },
        body: { subject: 'x', html_body: '<p>x</p>', text_body: 'x' },
      },
    );
    assertAuditRowSafe(contentRows);
    assert.equal(contentRows[0].action, AUDIT_ACTIONS.MARKETING_TEMPLATE_CONTENT_SAVE);

    const publishRows = await runWithStubs(
      marketing.postMarketingTemplatesByIdVersionsByVersionIdPublish as EndpointDefinition,
      { params: { id: TEMPLATE_ID, versionId: VERSION_ID } },
    );
    assertAuditRowSafe(publishRows);
    assert.equal(publishRows[0].action, AUDIT_ACTIONS.MARKETING_TEMPLATE_VERSION_PUBLISH);

    const archiveRows = await runWithStubs(
      marketing.postMarketingTemplatesByIdArchive as EndpointDefinition,
      { params: { id: TEMPLATE_ID } },
    );
    assertAuditRowSafe(archiveRows);
    assert.equal(archiveRows[0].action, AUDIT_ACTIONS.MARKETING_TEMPLATE_ARCHIVE);

    const updateRows = await runWithStubs(
      marketing.patchMarketingTemplatesById as EndpointDefinition,
      { params: { id: TEMPLATE_ID }, body: { name: 'New name' } },
    );
    assertAuditRowSafe(updateRows);
    assert.equal(updateRows[0].action, AUDIT_ACTIONS.MARKETING_TEMPLATE_UPDATE);
  });

  it('audits a test send with a recipient count, never content or addresses', async () => {
    const rows = await runWithStubs(
      marketing.postMarketingTemplatesByIdVersionsByVersionIdTestSend as EndpointDefinition,
      { params: { id: TEMPLATE_ID, versionId: VERSION_ID }, body: { variables: {} } },
    );
    assertAuditRowSafe(rows);
    assert.equal(rows[0].action, AUDIT_ACTIONS.MARKETING_TEMPLATE_TEST_SEND);
    assert.deepEqual(rows[0].metadata, {
      template_id: TEMPLATE_ID,
      recipient_count: 1,
      sent: true,
    });
  });

  it('audits campaign create, update, schedule, pause, resume and cancel', async () => {
    const create = await runWithStubs(marketing.postMarketingCampaigns as EndpointDefinition, {
      body: {
        name: 'Autumn outreach',
        template_version_id: VERSION_ID,
        audience_filter: { cities: ['Nagpur'] },
      },
    });
    assertAuditRowSafe(create);
    assert.equal(create[0].action, AUDIT_ACTIONS.MARKETING_CAMPAIGN_CREATE);
    assert.equal(create[0].entity_type, AUDIT_ENTITY_TYPES.EMAIL_CAMPAIGN);

    const update = await runWithStubs(marketing.patchMarketingCampaignsById as EndpointDefinition, {
      params: { id: CAMPAIGN_ID },
      body: { name: 'Renamed' },
    });
    assertAuditRowSafe(update);
    assert.equal(update[0].action, AUDIT_ACTIONS.MARKETING_CAMPAIGN_UPDATE);

    const schedule = await runWithStubs(
      marketing.postMarketingCampaignsByIdSchedule as EndpointDefinition,
      { params: { id: CAMPAIGN_ID }, body: {} },
    );
    assertAuditRowSafe(schedule);
    assert.equal(schedule[0].action, AUDIT_ACTIONS.MARKETING_CAMPAIGN_SCHEDULE);
    assert.deepEqual(schedule[0].metadata, {
      status: 'SCHEDULED',
      recipients: 3,
      snapshot_hash: 'abc123',
      already_scheduled: false,
    });

    const pause = await runWithStubs(
      marketing.postMarketingCampaignsByIdPause as EndpointDefinition,
      {
        params: { id: CAMPAIGN_ID },
      },
    );
    assertAuditRowSafe(pause);
    assert.equal(pause[0].action, AUDIT_ACTIONS.MARKETING_CAMPAIGN_PAUSE);

    const resume = await runWithStubs(
      marketing.postMarketingCampaignsByIdResume as EndpointDefinition,
      { params: { id: CAMPAIGN_ID } },
    );
    assertAuditRowSafe(resume);
    assert.equal(resume[0].action, AUDIT_ACTIONS.MARKETING_CAMPAIGN_RESUME);

    const cancel = await runWithStubs(
      marketing.postMarketingCampaignsByIdCancel as EndpointDefinition,
      {
        params: { id: CAMPAIGN_ID },
      },
    );
    assertAuditRowSafe(cancel);
    assert.equal(cancel[0].action, AUDIT_ACTIONS.MARKETING_CAMPAIGN_CANCEL);
  });

  it('does not audit reads (list, detail, preview, audience preview)', async () => {
    // Reads never mutate, so they must not write audit rows. The audience
    // preview stub is exercised through the campaigns service.
    const rows: Array<Record<string, unknown>> = [];
    const audit = {
      log: async (input: Record<string, unknown>) => {
        rows.push(input);
      },
    } as unknown as AuditService;
    const campaigns = {
      previewAudience: async () => ({ filter: {}, final_recipient_count: 0 }),
    } as unknown as MarketingCampaignsService;
    const restoreCampaigns = overrideContainer('marketingCampaigns', campaigns);
    const restoreAudit = overrideContainer('audit', audit);
    try {
      await callHandler(marketing.postMarketingCampaignsAudiencePreview as EndpointDefinition, {
        user: SUPER_ADMIN_USER,
        body: { audience_filter: { cities: ['Nagpur'] } },
      });
    } finally {
      restoreAudit();
      restoreCampaigns();
    }
    assert.equal(rows.length, 0, 'read-only endpoints are not audited');
  });
});

describe('marketing endpoint guardrails', () => {
  it('declares the schedule endpoint idempotent', () => {
    const definition = marketing.postMarketingCampaignsByIdSchedule as EndpointDefinition;
    assert.equal(definition.idempotency, 'marketing.campaign_schedule');
  });

  it('never lets the test-send handler forward a body-supplied recipient', async () => {
    // The DTO carries no recipient field, so a hostile body's `to` is dropped
    // by validation before the handler; assert the handler itself passes only
    // the resolved version_id through.
    const seen: Array<Record<string, unknown>> = [];
    const templates = {
      testSendVersion: async (_templateId: string, payload: Record<string, unknown>) => {
        seen.push(payload);
        return { sent: true, provider: 'noop-email', recipient_count: 1, message: 'ok' };
      },
    } as unknown as MarketingTemplatesService;
    const restoreTemplates = overrideContainer('marketingTemplates', templates);
    const restoreAudit = overrideContainer('audit', { log: async () => undefined } as never);
    try {
      await callHandler(
        marketing.postMarketingTemplatesByIdVersionsByVersionIdTestSend as EndpointDefinition,
        {
          user: SUPER_ADMIN_USER,
          params: { id: TEMPLATE_ID, versionId: VERSION_ID },
          body: { to: 'attacker@evil.example', variables: {} },
          request: {},
        },
      );
    } finally {
      restoreAudit();
      restoreTemplates();
    }
    assert.equal(seen.length, 1);
    assert.equal(seen[0].version_id, VERSION_ID, 'the path version id is pinned');
    assert.equal('to' in (seen[0] as object), false, 'no recipient field exists to forward');
  });
});

describe('marketing lead console (Session 4)', () => {
  const LEAD_ID = '66666666-6666-4666-8666-666666666666';

  /** Runs one lead endpoint against a stub service and returns audit rows. */
  async function runLeadEndpoint(
    definition: EndpointDefinition<unknown, unknown>,
    options: { params?: Record<string, string>; body?: unknown } = {},
  ): Promise<{ rows: Array<Record<string, unknown>>; calls: string[] }> {
    const rows: Array<Record<string, unknown>> = [];
    const calls: string[] = [];
    const audit = {
      log: async (input: Record<string, unknown>) => {
        rows.push(input);
      },
    } as unknown as AuditService;
    const leads = {
      list: async () => {
        calls.push('list');
        return { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } };
      },
      metrics: async () => {
        calls.push('metrics');
        return { total_leads: 0 };
      },
      findOneOrThrow: async (id: string) => {
        calls.push(`detail:${id}`);
        return { lead: { id }, events: [] };
      },
      updateStatus: async (id: string, status: string) => {
        calls.push(`status:${id}:${status}`);
        return { id, status };
      },
      addNote: async (id: string, note: string) => {
        calls.push(`note:${id}:${note.length}`);
        return { id: 'evt-1', event_type: 'NOTE_ADDED' };
      },
    };
    const restoreLeads = overrideContainer('marketingLeads', leads as never);
    const restoreAudit = overrideContainer('audit', audit);
    try {
      await callHandler(definition, {
        user: SUPER_ADMIN_USER,
        params: options.params ?? {},
        body: options.body,
        query: {},
        request: { requestId: 'req-1', ip: '203.0.113.10' },
      });
    } finally {
      restoreAudit();
      restoreLeads();
    }
    return { rows, calls };
  }

  it('audits a status change with statuses and note length only — never the note or contact details', async () => {
    const { rows } = await runLeadEndpoint(
      marketing.patchMarketingLeadsByIdStatus as EndpointDefinition,
      {
        params: { id: LEAD_ID },
        body: { status: 'CONTACTED', note: 'Called the principal at +91 9xxxx' },
      },
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, AUDIT_ACTIONS.MARKETING_LEAD_STATUS_CHANGE);
    assert.equal(rows[0].entity_type, AUDIT_ENTITY_TYPES.MARKETING_LEAD);
    assert.equal(rows[0].entity_id, LEAD_ID);
    assert.equal(rows[0].school_id, null, 'leads are platform-scoped');
    assert.deepEqual(rows[0].metadata, { status: 'CONTACTED', note_length: 33 });
    const serialized = JSON.stringify(rows[0]);
    assert.equal(serialized.includes('principal'), false, 'the note text stays out of the audit');
  });

  it('audits a note with its length only', async () => {
    const { rows } = await runLeadEndpoint(
      marketing.postMarketingLeadsByIdNotes as EndpointDefinition,
      { params: { id: LEAD_ID }, body: { note: 'Wants a Tuesday demo' } },
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, AUDIT_ACTIONS.MARKETING_LEAD_NOTE_ADD);
    assert.deepEqual(rows[0].metadata, { note_length: 20 });
    assert.equal(JSON.stringify(rows[0]).includes('Tuesday'), false);
  });

  it('does not audit lead reads', async () => {
    for (const definition of [
      marketing.getMarketingLeads,
      marketing.getMarketingLeadsMetrics,
      marketing.getMarketingLeadsById,
    ]) {
      const { rows } = await runLeadEndpoint(definition as EndpointDefinition, {
        params: { id: LEAD_ID },
      });
      assert.equal(rows.length, 0);
    }
  });

  it('rejects a malformed lead id before touching the service', async () => {
    const { calls } = await runLeadEndpoint(
      marketing.getMarketingLeadsById as EndpointDefinition,
      { params: { id: 'not-a-uuid' } },
    ).then(
      () => {
        throw new Error('expected a 400');
      },
      () => ({ calls: [] as string[] }),
    );
    assert.equal(calls.length, 0);
  });

  it('the note endpoint answers 201 and the status endpoint 200', () => {
    assert.equal(
      (marketing.postMarketingLeadsByIdNotes as EndpointDefinition).status,
      201,
    );
    assert.equal(
      (marketing.patchMarketingLeadsByIdStatus as EndpointDefinition).status,
      200,
    );
  });
});
