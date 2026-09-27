/**
 * Endpoint definitions for the `marketing` module (Session 2: templates &
 * campaigns).
 *
 * Mirrors `admin.ts`: each entry declares authentication, roles, rate-limit
 * policy, success status and DTOs, plus the handler; `route.ts` files under
 * `src/app/api/v1/marketing` re-export these as App Router verb handlers.
 *
 * Every endpoint is **SUPER_ADMIN only** — marketing data is platform-level
 * and carries no `school_id`; school roles are rejected by the role guard
 * before any handler runs.
 *
 * Every mutation is audited with **safe metadata only**: slugs, version
 * numbers, statuses, counts and the (non-reversible) snapshot hash. Never
 * audited: subject lines, HTML/text bodies, recipient addresses, SMTP
 * credentials or token material. `AUDIT_REDACTED_FIELDS` in the audit service
 * is the second line of defence.
 */
import { HttpStatus, parseUuidParam } from '../framework';
import { UserRole } from '@school-bus-tracking/shared-types';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../modules/audit/audit.constants';
import { auditRequestContext } from '../modules/audit/audit-request';
import { IDEMPOTENCY_ENDPOINTS } from '../common/idempotency/idempotency.constants';
import {
  CreateMarketingCampaignDto,
  CreateMarketingTemplateDto,
  ListMarketingCampaignsQueryDto,
  ListMarketingTemplatesQueryDto,
  MarketingAudiencePreviewDto,
  MarketingTemplateRenderDto,
  SaveMarketingTemplateContentDto,
  ScheduleMarketingCampaignDto,
  UpdateMarketingCampaignDto,
  UpdateMarketingTemplateDto,
} from '../modules/marketing/dto';

// ---------------------------------------------------------------- templates

/** `GET /api/v1/marketing/templates` */
export const getMarketingTemplates: EndpointDefinition<unknown, ListMarketingTemplatesQueryDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  queryType: ListMarketingTemplatesQueryDto,
  handler: async ({ query }) => {
    return container().marketingTemplates().list(query);
  },
};

/** `POST /api/v1/marketing/templates` */
export const postMarketingTemplates: EndpointDefinition<CreateMarketingTemplateDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateMarketingTemplateDto,
  handler: async ({ user, body, request }) => {
    const result = await container()
      .marketingTemplates()
      .create(user.id, body as never);
    await container()
      .audit()
      .log({
        school_id: null,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.MARKETING_TEMPLATE_CREATE,
        entity_type: AUDIT_ENTITY_TYPES.EMAIL_TEMPLATE,
        entity_id: result.template.id,
        ...auditRequestContext({ request }),
        metadata: { slug: result.template.slug, version: result.version.version },
      });
    return result;
  },
};

/** `GET /api/v1/marketing/templates/:id` */
export const getMarketingTemplatesById: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const id = parseUuidParam(params['id'], { label: 'template' });
    return container().marketingTemplates().findOneOrThrow(id);
  },
};

/** `PATCH /api/v1/marketing/templates/:id` */
export const patchMarketingTemplatesById: EndpointDefinition<UpdateMarketingTemplateDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateMarketingTemplateDto,
  handler: async ({ user, body, params, request }) => {
    const id = parseUuidParam(params['id'], { label: 'template' });
    const template = await container()
      .marketingTemplates()
      .update(user.id, id, body as never);
    await container()
      .audit()
      .log({
        school_id: null,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.MARKETING_TEMPLATE_UPDATE,
        entity_type: AUDIT_ENTITY_TYPES.EMAIL_TEMPLATE,
        entity_id: template.id,
        ...auditRequestContext({ request }),
        metadata: { slug: template.slug },
      });
    return template;
  },
};

/** `PUT /api/v1/marketing/templates/:id/content` */
export const putMarketingTemplatesByIdContent: EndpointDefinition<SaveMarketingTemplateContentDto> =
  {
    roles: [UserRole.SUPER_ADMIN],
    status: HttpStatus.OK,
    bodyType: SaveMarketingTemplateContentDto,
    handler: async ({ user, body, params, request }) => {
      const id = parseUuidParam(params['id'], { label: 'template' });
      const result = await container()
        .marketingTemplates()
        .saveContent(user.id, id, body as never);
      await container()
        .audit()
        .log({
          school_id: null,
          actor_user_id: user.id,
          action: AUDIT_ACTIONS.MARKETING_TEMPLATE_CONTENT_SAVE,
          entity_type: AUDIT_ENTITY_TYPES.EMAIL_TEMPLATE_VERSION,
          entity_id: result.version.id,
          ...auditRequestContext({ request }),
          metadata: {
            template_id: result.template.id,
            slug: result.template.slug,
            version: result.version.version,
            published: false,
          },
        });
      return result;
    },
  };

/** `POST /api/v1/marketing/templates/:id/versions/:versionId/publish` */
export const postMarketingTemplatesByIdVersionsByVersionIdPublish: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const id = parseUuidParam(params['id'], { label: 'template' });
    const versionId = parseUuidParam(params['versionId'], { label: 'template version' });
    const result = await container().marketingTemplates().publishVersion(user.id, id, versionId);
    await container()
      .audit()
      .log({
        school_id: null,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.MARKETING_TEMPLATE_VERSION_PUBLISH,
        entity_type: AUDIT_ENTITY_TYPES.EMAIL_TEMPLATE_VERSION,
        entity_id: result.version.id,
        ...auditRequestContext({ request }),
        metadata: {
          template_id: result.template.id,
          slug: result.template.slug,
          version: result.version.version,
        },
      });
    return result;
  },
};

/** `POST /api/v1/marketing/templates/:id/archive` */
export const postMarketingTemplatesByIdArchive: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const id = parseUuidParam(params['id'], { label: 'template' });
    const result = await container().marketingTemplates().archive(user.id, id);
    await container()
      .audit()
      .log({
        school_id: null,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.MARKETING_TEMPLATE_ARCHIVE,
        entity_type: AUDIT_ENTITY_TYPES.EMAIL_TEMPLATE,
        entity_id: result.id,
        ...auditRequestContext({ request }),
        metadata: { status: result.status },
      });
    return result;
  },
};

/** `POST /api/v1/marketing/templates/:id/preview` */
export const postMarketingTemplatesByIdPreview: EndpointDefinition<MarketingTemplateRenderDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: MarketingTemplateRenderDto,
  handler: async ({ body, params }) => {
    const id = parseUuidParam(params['id'], { label: 'template' });
    return container()
      .marketingTemplates()
      .preview(id, body as never);
  },
};

/**
 * `POST /api/v1/marketing/templates/:id/versions/:versionId/test-send`
 *
 * Sends a single test message per configured `MARKETING_TEST_RECIPIENTS`
 * address — the body carries no recipient, so the browser cannot pick a
 * target. The payload is constructed field-by-field (never spread from the
 * request body) so nothing unexpected can reach the service. Audited as an
 * act with a recipient count, never with content.
 */
export const postMarketingTemplatesByIdVersionsByVersionIdTestSend: EndpointDefinition<
  MarketingTemplateRenderDto,
  unknown
> = {
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'password_reset',
  status: HttpStatus.OK,
  bodyType: MarketingTemplateRenderDto,
  handler: async ({ user, body, params, request }) => {
    const id = parseUuidParam(params['id'], { label: 'template' });
    const versionId = parseUuidParam(params['versionId'], { label: 'template version' });
    const dto = (body ?? {}) as { variables?: Record<string, string> | null };
    const result = await container()
      .marketingTemplates()
      .testSendVersion(id, { version_id: versionId, variables: dto.variables ?? null });
    await container()
      .audit()
      .log({
        school_id: null,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.MARKETING_TEMPLATE_TEST_SEND,
        entity_type: AUDIT_ENTITY_TYPES.EMAIL_TEMPLATE_VERSION,
        entity_id: versionId,
        ...auditRequestContext({ request }),
        metadata: { template_id: id, recipient_count: result.recipient_count, sent: result.sent },
      });
    return result;
  },
};

// ---------------------------------------------------------------- campaigns

/** `GET /api/v1/marketing/campaigns` */
export const getMarketingCampaigns: EndpointDefinition<unknown, ListMarketingCampaignsQueryDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  queryType: ListMarketingCampaignsQueryDto,
  handler: async ({ query }) => {
    return container().marketingCampaigns().list(query);
  },
};

/** `POST /api/v1/marketing/campaigns` */
export const postMarketingCampaigns: EndpointDefinition<CreateMarketingCampaignDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateMarketingCampaignDto,
  handler: async ({ user, body, request }) => {
    const campaign = await container()
      .marketingCampaigns()
      .create(user.id, body as never);
    await container()
      .audit()
      .log({
        school_id: null,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.MARKETING_CAMPAIGN_CREATE,
        entity_type: AUDIT_ENTITY_TYPES.EMAIL_CAMPAIGN,
        entity_id: campaign.id,
        ...auditRequestContext({ request }),
        metadata: { template_version_id: campaign.template_version_id },
      });
    return campaign;
  },
};

/** `GET /api/v1/marketing/campaigns/:id` */
export const getMarketingCampaignsById: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const id = parseUuidParam(params['id'], { label: 'campaign' });
    return container().marketingCampaigns().findOneOrThrow(id);
  },
};

/** `PATCH /api/v1/marketing/campaigns/:id` */
export const patchMarketingCampaignsById: EndpointDefinition<UpdateMarketingCampaignDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateMarketingCampaignDto,
  handler: async ({ user, body, params, request }) => {
    const id = parseUuidParam(params['id'], { label: 'campaign' });
    const campaign = await container()
      .marketingCampaigns()
      .update(user.id, id, body as never);
    await container()
      .audit()
      .log({
        school_id: null,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.MARKETING_CAMPAIGN_UPDATE,
        entity_type: AUDIT_ENTITY_TYPES.EMAIL_CAMPAIGN,
        entity_id: campaign.id,
        ...auditRequestContext({ request }),
        metadata: { status: campaign.status, template_version_id: campaign.template_version_id },
      });
    return campaign;
  },
};

/**
 * `POST /api/v1/marketing/campaigns/audience-preview`
 *
 * Read-only: resolves the audience server-side and returns counts, a masked
 * sample and the snapshot hash. Never audited (no mutation), never returns a
 * raw address list.
 */
export const postMarketingCampaignsAudiencePreview: EndpointDefinition<MarketingAudiencePreviewDto> =
  {
    roles: [UserRole.SUPER_ADMIN],
    status: HttpStatus.OK,
    bodyType: MarketingAudiencePreviewDto,
    handler: async ({ body }) => {
      return container()
        .marketingCampaigns()
        .previewAudience(body as never);
    },
  };

/**
 * `POST /api/v1/marketing/campaigns/:id/schedule`
 *
 * Freezes the audience snapshot inside a transaction and marks the campaign
 * SCHEDULED. Sends nothing — delivery is the background worker's job
 * (Session 3). Supports `x-idempotency-key`, and the service is idempotent
 * regardless: an already-scheduled campaign is returned untouched.
 */
export const postMarketingCampaignsByIdSchedule: EndpointDefinition<ScheduleMarketingCampaignDto> =
  {
    roles: [UserRole.SUPER_ADMIN],
    status: HttpStatus.OK,
    bodyType: ScheduleMarketingCampaignDto,
    idempotency: IDEMPOTENCY_ENDPOINTS.MARKETING_CAMPAIGN_SCHEDULE,
    handler: async ({ user, body, params, request }) => {
      const id = parseUuidParam(params['id'], { label: 'campaign' });
      const result = await container()
        .marketingCampaigns()
        .schedule(user.id, id, body as never);
      await container()
        .audit()
        .log({
          school_id: null,
          actor_user_id: user.id,
          action: AUDIT_ACTIONS.MARKETING_CAMPAIGN_SCHEDULE,
          entity_type: AUDIT_ENTITY_TYPES.EMAIL_CAMPAIGN,
          entity_id: result.campaign.id,
          ...auditRequestContext({ request }),
          metadata: {
            status: result.campaign.status,
            recipients: result.campaign.recipient_count,
            snapshot_hash: result.campaign.audience_snapshot_hash,
            already_scheduled: result.already_scheduled,
          },
        });
      return result;
    },
  };

/** `POST /api/v1/marketing/campaigns/:id/pause` */
export const postMarketingCampaignsByIdPause: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const id = parseUuidParam(params['id'], { label: 'campaign' });
    const campaign = await container().marketingCampaigns().pause(id);
    await container()
      .audit()
      .log({
        school_id: null,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.MARKETING_CAMPAIGN_PAUSE,
        entity_type: AUDIT_ENTITY_TYPES.EMAIL_CAMPAIGN,
        entity_id: campaign.id,
        ...auditRequestContext({ request }),
        metadata: { status: campaign.status },
      });
    return campaign;
  },
};

/** `POST /api/v1/marketing/campaigns/:id/resume` */
export const postMarketingCampaignsByIdResume: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const id = parseUuidParam(params['id'], { label: 'campaign' });
    const campaign = await container().marketingCampaigns().resume(id);
    await container()
      .audit()
      .log({
        school_id: null,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.MARKETING_CAMPAIGN_RESUME,
        entity_type: AUDIT_ENTITY_TYPES.EMAIL_CAMPAIGN,
        entity_id: campaign.id,
        ...auditRequestContext({ request }),
        metadata: { status: campaign.status },
      });
    return campaign;
  },
};

/** `POST /api/v1/marketing/campaigns/:id/cancel` */
export const postMarketingCampaignsByIdCancel: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const id = parseUuidParam(params['id'], { label: 'campaign' });
    const campaign = await container().marketingCampaigns().cancel(id);
    await container()
      .audit()
      .log({
        school_id: null,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.MARKETING_CAMPAIGN_CANCEL,
        entity_type: AUDIT_ENTITY_TYPES.EMAIL_CAMPAIGN,
        entity_id: campaign.id,
        ...auditRequestContext({ request }),
        metadata: { status: campaign.status },
      });
    return campaign;
  },
};
