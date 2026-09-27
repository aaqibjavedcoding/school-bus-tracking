/**
 * Super Admin email template management.
 *
 * The lifecycle this service enforces (see `docs/marketing-communications.md`):
 *
 * ```text
 * create → DRAFT (version 1 draft)
 *   save content → edits the draft version, or opens draft N+1 after a publish
 *   publish     → the version becomes immutable (published_at set) and the
 *                 template becomes selectable by campaigns
 *   archive     → no new campaigns may select the template; existing snapshots
 *                 keep working
 * ```
 *
 * ### Immutability is the contract
 *
 * A published version is never updated — not by `saveContent` (which opens a
 * **new** draft version instead) and not by a repeat publish. Campaigns pin
 * `template_version_id`, so "what did school X receive" must resolve to bytes
 * that cannot change after the fact. Version history is therefore
 * append-mostly: the only legal post-insert write to a version row is the
 * single publish that freezes it.
 *
 * ### Content safety
 *
 * Every save runs the tokenizer-based sanitizer
 * (`marketing-html.sanitizer.ts`): constructs that are merely off-brand are
 * stripped during sanitization, while executable/embedding markup, event
 * handlers and unsafe URL schemes are **rejected** so the save fails. The
 * placeholder contract (unknown `{{variable}}` ⇒ reject) is enforced by the
 * shared zod schema before anything touches the database.
 *
 * ### Test sending is closed by construction
 *
 * `testSendVersion` accepts no recipient address from the caller. Recipients
 * are resolved from `MARKETING_TEST_RECIPIENTS` (injected as a function so
 * configuration is read at call time, never baked in), and the send goes
 * through the same email rail as password reset — one message per configured
 * address, never a bulk send. Rendered content never reaches a log or the
 * response.
 */

import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '../../framework';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import { MarketingTemplateStatus } from '@school-bus-tracking/shared-types';
import type {
  MarketingTemplateArchiveResponse,
  MarketingTemplateContentInput,
  MarketingTemplateContentSaveResponse,
  MarketingTemplateCreateRequest,
  MarketingTemplateDetailResponse,
  MarketingTemplateListResponse,
  MarketingTemplatePreviewRequest,
  MarketingTemplatePreviewResponse,
  MarketingTemplateResponse,
  MarketingTemplateSummary,
  MarketingTemplateTestSendRequest,
  MarketingTemplateTestSendResponse,
  MarketingTemplateUpdateRequest,
  MarketingTemplateVersionPublishResponse,
  MarketingTemplateVersionResponse,
  PaginationMeta,
} from '@school-bus-tracking/shared-types';
import {
  marketingTemplateContentSaveSchema,
  marketingTemplateCreateSchema,
  marketingTemplatePreviewSchema,
  marketingTemplateTestSendSchema,
  marketingTemplateUpdateSchema,
} from '@school-bus-tracking/validation';
import type { EmailTemplate, EmailTemplateVersion } from '../../database/models';
import type { EmailNotificationProvider } from '../notifications/providers/notification-provider.interface';
import { parseOrThrow } from './marketing-validation.util';
import { sanitizeMarketingHtml } from './marketing-html.sanitizer';
import { buildSampleVariables, renderMarketingTemplate } from './marketing-template-render.util';
import {
  MARKETING_TEMPLATE_ALREADY_ARCHIVED,
  MARKETING_TEMPLATE_ARCHIVED,
  MARKETING_TEMPLATE_ARCHIVED_MESSAGE,
  MARKETING_TEMPLATE_HTML_UNSAFE,
  MARKETING_TEMPLATE_NOT_FOUND,
  MARKETING_TEMPLATE_SLUG_TAKEN,
  MARKETING_TEMPLATE_TEST_PARTIALLY_SENT,
  MARKETING_TEMPLATE_TEST_SENT,
  MARKETING_TEMPLATE_VERSION_NOT_FOUND,
  MARKETING_TEMPLATE_VERSION_PUBLISH_MESSAGE,
  MARKETING_TEMPLATE_VERSION_PUBLISHED,
  MARKETING_TEST_RECIPIENTS_UNSET,
} from './marketing.constants';

/** Query DTO shape (validated at the HTTP layer). */
export interface ListMarketingTemplatesQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  sort?: string;
  order?: string;
}

/** Maps a version row to its API projection. */
function toVersionResponse(version: EmailTemplateVersion): MarketingTemplateVersionResponse {
  return {
    id: version.id,
    template_id: version.template_id,
    version: version.version,
    subject: version.subject,
    html_body: version.html_body,
    text_body: version.text_body,
    allowed_variables: version.allowed_variables ?? [],
    published_at: version.published_at ? version.published_at.toISOString() : null,
    created_at: version.created_at.toISOString(),
    updated_at: version.updated_at.toISOString(),
  };
}

/** Maps a template row to its API projection. */
function toTemplateResponse(template: EmailTemplate): MarketingTemplateResponse {
  return {
    id: template.id,
    name: template.name,
    slug: template.slug,
    status: template.status,
    created_by: template.created_by ?? null,
    updated_by: template.updated_by ?? null,
    created_at: template.created_at.toISOString(),
    updated_at: template.updated_at.toISOString(),
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export class MarketingTemplatesService {
  private readonly logger = new Logger(MarketingTemplatesService.name);

  constructor(
    private readonly templates: typeof EmailTemplate,
    private readonly versions: typeof EmailTemplateVersion,
    private readonly emailProvider: EmailNotificationProvider,
    private readonly testRecipients: () => readonly string[],
  ) {}

  // ------------------------------------------------------------- queries

  /** Paginated template list with per-template version statistics. */
  async list(query: ListMarketingTemplatesQuery): Promise<MarketingTemplateListResponse> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const where: Record<PropertyKey, unknown> = {};
    if (query.status) {
      where.status = query.status;
    }
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      where[Op.or] = [{ name: { [Op.iLike]: pattern } }, { slug: { [Op.iLike]: pattern } }];
    }

    const rows = await this.templates.findAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [[sortColumn(query.sort), query.order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC']],
    });
    const total = await this.templates.count({ where: where as WhereOptions });

    const ids = rows.map((template) => template.id);
    const versionRows = ids.length
      ? await this.versions.findAll({ where: { template_id: { [Op.in]: ids } } })
      : [];

    const items: MarketingTemplateSummary[] = rows.map((template) => {
      const own = versionRows.filter((version) => version.template_id === template.id);
      const published = own
        .filter((version) => version.published_at !== null)
        .map((version) => version.version);
      const drafts = own
        .filter((version) => version.published_at === null)
        .map((version) => version.version);
      return {
        ...toTemplateResponse(template),
        version_count: own.length,
        latest_published_version: published.length > 0 ? Math.max(...published) : null,
        draft_version: drafts.length > 0 ? Math.max(...drafts) : null,
      };
    });

    const totalPages = Math.ceil(total / limit) || 1;
    const meta: PaginationMeta = {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
    return { items, meta };
  }

  /** One template with its full (newest-first) version history. */
  async findOneOrThrow(templateId: string): Promise<MarketingTemplateDetailResponse> {
    const template = await this.requireTemplate(templateId);
    const versionRows = await this.versions.findAll({
      where: { template_id: template.id },
      order: [['version', 'DESC']],
    });
    return {
      template: toTemplateResponse(template),
      versions: versionRows.map(toVersionResponse),
    };
  }

  // ------------------------------------------------------------ mutations

  /** Creates a template with its first draft version. */
  async create(
    actorUserId: string,
    dto: MarketingTemplateCreateRequest,
  ): Promise<MarketingTemplateContentSaveResponse> {
    const validated = parseOrThrow(marketingTemplateCreateSchema, dto);
    const content = this.prepareContent(validated.content);

    try {
      const template = await this.templates.create({
        name: validated.name.trim(),
        slug: validated.slug,
        created_by: actorUserId,
        updated_by: actorUserId,
      });
      const version = await this.versions.create({
        template_id: template.id,
        version: 1,
        subject: content.subject,
        html_body: content.html_body,
        text_body: content.text_body,
        allowed_variables: content.allowed_variables,
        created_by: actorUserId,
      });
      return {
        template: toTemplateResponse(template),
        version: toVersionResponse(version),
      };
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(MARKETING_TEMPLATE_SLUG_TAKEN);
      }
      throw error;
    }
  }

  /** Updates template metadata (`name`; the slug is the stable identity). */
  async update(
    actorUserId: string,
    templateId: string,
    dto: MarketingTemplateUpdateRequest,
  ): Promise<MarketingTemplateResponse> {
    const template = await this.requireTemplate(templateId);
    const validated = parseOrThrow(marketingTemplateUpdateSchema, dto);

    const updates: Record<string, unknown> = {};
    if (validated.name !== undefined) {
      updates.name = validated.name.trim();
    }
    updates.updated_by = actorUserId;

    await template.update(updates);
    await template.reload();
    return toTemplateResponse(template);
  }

  /**
   * Saves draft content.
   *
   * - no version yet → creates version 1 (draft);
   * - newest version is a draft → that row is updated in place;
   * - newest version is published → a **new** draft version is opened
   *   (the published one is never touched).
   */
  async saveContent(
    actorUserId: string,
    templateId: string,
    dto: MarketingTemplateContentInput,
  ): Promise<MarketingTemplateContentSaveResponse> {
    const template = await this.requireTemplate(templateId);
    if (template.status === MarketingTemplateStatus.ARCHIVED) {
      throw new ConflictException(MARKETING_TEMPLATE_ARCHIVED);
    }
    const validated = parseOrThrow(marketingTemplateContentSaveSchema, dto);
    const prepared = this.prepareContent(validated);

    const latest = await this.findLatestVersion(template.id);
    let version: EmailTemplateVersion;
    if (!latest) {
      version = await this.versions.create({
        template_id: template.id,
        version: 1,
        subject: prepared.subject,
        html_body: prepared.html_body,
        text_body: prepared.text_body,
        allowed_variables: prepared.allowed_variables,
        created_by: actorUserId,
      });
    } else if (latest.published_at === null) {
      await latest.update({
        subject: prepared.subject,
        html_body: prepared.html_body,
        text_body: prepared.text_body,
        allowed_variables: prepared.allowed_variables,
      });
      await latest.reload();
      version = latest;
    } else {
      version = await this.versions.create({
        template_id: template.id,
        version: latest.version + 1,
        subject: prepared.subject,
        html_body: prepared.html_body,
        text_body: prepared.text_body,
        allowed_variables: prepared.allowed_variables,
        created_by: actorUserId,
      });
    }

    await template.update({ updated_by: actorUserId });
    await template.reload();
    return {
      template: toTemplateResponse(template),
      version: toVersionResponse(version),
    };
  }

  /**
   * Publishes a draft version — the one-way door.
   *
   * Publishing sets `published_at`, which is what freezes the row: a second
   * publish is a 409, and `saveContent` structurally cannot reach a published
   * version. The template moves to `PUBLISHED` so campaigns may select it.
   */
  async publishVersion(
    actorUserId: string,
    templateId: string,
    versionId: string,
  ): Promise<MarketingTemplateVersionPublishResponse> {
    const template = await this.requireTemplate(templateId);
    if (template.status === MarketingTemplateStatus.ARCHIVED) {
      throw new ConflictException(MARKETING_TEMPLATE_ARCHIVED);
    }
    const version = await this.requireVersion(template.id, versionId);

    if (version.published_at !== null) {
      throw new ConflictException(MARKETING_TEMPLATE_VERSION_PUBLISHED);
    }

    await version.update({ published_at: new Date() });
    await version.reload();

    const templateUpdates: Record<string, unknown> = { updated_by: actorUserId };
    if (template.status === MarketingTemplateStatus.DRAFT) {
      templateUpdates.status = MarketingTemplateStatus.PUBLISHED;
    }
    await template.update(templateUpdates);
    await template.reload();

    return {
      template: toTemplateResponse(template),
      version: toVersionResponse(version),
      message: MARKETING_TEMPLATE_VERSION_PUBLISH_MESSAGE,
    };
  }

  /** Archives a template. Existing campaign snapshots are unaffected. */
  async archive(
    actorUserId: string,
    templateId: string,
  ): Promise<MarketingTemplateArchiveResponse> {
    const template = await this.requireTemplate(templateId);
    if (template.status === MarketingTemplateStatus.ARCHIVED) {
      throw new ConflictException(MARKETING_TEMPLATE_ALREADY_ARCHIVED);
    }
    await template.update({ status: MarketingTemplateStatus.ARCHIVED, updated_by: actorUserId });
    await template.reload();
    return {
      id: template.id,
      status: template.status,
      message: MARKETING_TEMPLATE_ARCHIVED_MESSAGE,
    };
  }

  // ------------------------------------------------------- render & test

  /** Renders a version with sample variables (pure — nothing is stored). */
  async preview(
    templateId: string,
    dto: MarketingTemplatePreviewRequest,
  ): Promise<MarketingTemplatePreviewResponse> {
    const validated = parseOrThrow(marketingTemplatePreviewSchema, dto);
    const version = await this.resolveVersion(templateId, validated.version_id ?? null);

    const samples = buildSampleVariables(
      version.allowed_variables ?? [],
      validated.variables ?? {},
    );
    const rendered = renderMarketingTemplate(version, samples);

    return {
      version_id: version.id,
      version: version.version,
      subject: rendered.subject,
      html_body: rendered.html_body,
      text_body: rendered.text_body,
    };
  }

  /**
   * Sends a test email of a version to the **configured** test recipients.
   *
   * The request carries no address — the only way to widen the audience is
   * `MARKETING_TEST_RECIPIENTS` in the environment. One message per
   * recipient, through the shared email rail; the rendered body is neither
   * returned nor logged.
   */
  async testSendVersion(
    templateId: string,
    dto: MarketingTemplateTestSendRequest,
  ): Promise<MarketingTemplateTestSendResponse> {
    const validated = parseOrThrow(marketingTemplateTestSendSchema, dto);
    const version = await this.resolveVersion(templateId, validated.version_id ?? null);

    const recipients = this.testRecipients();
    if (recipients.length === 0) {
      throw new ServiceUnavailableException(MARKETING_TEST_RECIPIENTS_UNSET);
    }

    const samples = buildSampleVariables(
      version.allowed_variables ?? [],
      validated.variables ?? {},
    );
    const rendered = renderMarketingTemplate(version, samples);

    let delivered = 0;
    for (const recipient of recipients) {
      const result = await this.emailProvider.send({
        recipientId: 'marketing-test-send',
        title: rendered.subject,
        body: rendered.text_body,
        to: recipient,
        subject: rendered.subject,
        html: rendered.html_body,
      });
      if (result.success) {
        delivered += 1;
      } else {
        // Safe classification only — never the provider's raw error text,
        // which can echo credentials or message content.
        this.logger.warn(
          `Test send to a configured recipient failed (provider=${result.provider}, retryable=${result.retryable}).`,
        );
      }
    }

    return {
      sent: delivered === recipients.length,
      provider: this.emailProvider.name,
      recipient_count: delivered,
      message:
        delivered === recipients.length
          ? MARKETING_TEMPLATE_TEST_SENT
          : MARKETING_TEMPLATE_TEST_PARTIALLY_SENT,
    };
  }

  // -------------------------------------------------------------- helpers

  /**
   * Sanitizes + finalizes content before storage.
   *
   * Rejects executable markup, event handlers and unsafe URLs; sanitizes
   * everything else (unknown tags unwrapped, non-allowlisted attributes
   * dropped).
   */
  private prepareContent(content: MarketingTemplateContentInput): {
    subject: string;
    html_body: string;
    text_body: string;
    allowed_variables: NonNullable<MarketingTemplateContentInput['allowed_variables']>;
  } {
    const { html, violations } = sanitizeMarketingHtml(content.html_body);
    if (violations.length > 0) {
      throw new BadRequestException({
        message: MARKETING_TEMPLATE_HTML_UNSAFE,
        details: { html_body: violations.join('; ') },
      });
    }
    return {
      subject: content.subject,
      html_body: html,
      text_body: content.text_body,
      allowed_variables: content.allowed_variables ?? [],
    };
  }

  private async requireTemplate(templateId: string): Promise<EmailTemplate> {
    const template = await this.templates.findOne({ where: { id: templateId } });
    if (!template) {
      throw new NotFoundException(MARKETING_TEMPLATE_NOT_FOUND);
    }
    return template;
  }

  private async requireVersion(
    templateId: string,
    versionId: string,
  ): Promise<EmailTemplateVersion> {
    const version = await this.versions.findOne({
      where: { id: versionId, template_id: templateId },
    });
    if (!version) {
      throw new NotFoundException(MARKETING_TEMPLATE_VERSION_NOT_FOUND);
    }
    return version;
  }

  private async findLatestVersion(templateId: string): Promise<EmailTemplateVersion | null> {
    const rows = await this.versions.findAll({
      where: { template_id: templateId },
      order: [['version', 'DESC']],
      limit: 1,
    });
    return rows[0] ?? null;
  }

  /** The version a preview/test-send targets: explicit id, else the newest. */
  private async resolveVersion(
    templateId: string,
    versionId: string | null,
  ): Promise<EmailTemplateVersion> {
    if (versionId) {
      return this.requireVersion(templateId, versionId);
    }
    const latest = await this.findLatestVersion(templateId);
    if (!latest) {
      throw new NotFoundException(MARKETING_TEMPLATE_VERSION_NOT_FOUND);
    }
    return latest;
  }
}

/** Builds the list `where` clause (search is an OR over name/slug). */
function sortColumn(sort: string | undefined): string {
  if (sort === 'name' || sort === 'slug') {
    return sort;
  }
  return 'created_at';
}
