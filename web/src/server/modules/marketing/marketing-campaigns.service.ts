/**
 * Super Admin email campaign management.
 *
 * Responsibilities:
 *
 * - the campaign **lifecycle state machine** (draft → scheduled → …) with
 *   invalid transitions rejected, not silently coerced;
 * - the **published-version pin** — a campaign always references an immutable
 *   `email_template_versions` row, never a mutable template;
 * - the **audience snapshot**: scheduling is the only moment the audience is
 *   materialized, and it happens inside a database transaction, from
 *   server-computed recipients only. No email is ever sent here — delivery is
 *   the background worker's job (Session 3). An HTTP handler that looped over
 *   recipients calling the provider would tie request latency to SMTP
 *   throughput; it is a prohibited pattern, not just a discouraged one.
 *
 * ### Idempotent scheduling
 *
 * Scheduling is naturally retried by consoles (double-clicks, reconnects), so
 * `schedule()` is idempotent at the service level: a campaign already in
 * `SCHEDULED` returns its current state with `already_scheduled: true` and
 * writes **no** new snapshot rows. The endpoint additionally supports the
 * `x-idempotency-key` header (see `IDEMPOTENCY_ENDPOINTS`), and the
 * transaction below re-checks the status so two concurrent schedules cannot
 * both write recipients.
 *
 * ### Audience freeze
 *
 * `audience_filter` (the question) may only change while the campaign is a
 * draft. Once scheduled, `audience_snapshot_hash` plus the
 * `email_campaign_recipients` rows are the frozen answer — schools registered
 * afterwards are simply not in the campaign.
 */

import { BadRequestException, ConflictException, NotFoundException } from '../../framework';
import { Op, Transaction, UniqueConstraintError, type Sequelize, type WhereOptions } from 'sequelize';
import {
  MarketingCampaignStatus,
  MarketingRecipientStatus,
  MarketingTemplateStatus,
} from '@school-bus-tracking/shared-types';
import type {
  MarketingAudiencePreviewRequest,
  MarketingAudiencePreviewResponse,
  MarketingCampaignAudienceFilter,
  MarketingCampaignCreateRequest,
  MarketingCampaignDetailResponse,
  MarketingCampaignListResponse,
  MarketingCampaignLifecycleResponse,
  MarketingCampaignResponse,
  MarketingCampaignScheduleRequest,
  MarketingCampaignScheduleResponse,
  MarketingCampaignSummary,
  MarketingCampaignTemplateSummary,
  MarketingCampaignUpdateRequest,
  PaginationMeta,
} from '@school-bus-tracking/shared-types';
import {
  marketingAudiencePreviewSchema,
  marketingCampaignCreateSchema,
  marketingCampaignScheduleSchema,
  marketingCampaignUpdateSchema,
} from '@school-bus-tracking/validation';
import type {
  EmailCampaign,
  EmailCampaignRecipient,
  EmailTemplate,
  EmailTemplateVersion,
} from '../../database/models';
import type { MarketingAudienceService } from './marketing-audience.service';
import { parseOrThrow } from './marketing-validation.util';
import {
  MARKETING_CAMPAIGN_ALREADY_SCHEDULED_MESSAGE,
  MARKETING_CAMPAIGN_CANCELLED_MESSAGE,
  MARKETING_CAMPAIGN_EMPTY_AUDIENCE,
  MARKETING_CAMPAIGN_NOT_FOUND,
  MARKETING_CAMPAIGN_ONLY_DRAFT_EDITABLE,
  MARKETING_CAMPAIGN_PAUSED_MESSAGE,
  MARKETING_CAMPAIGN_RESUMED_MESSAGE,
  MARKETING_CAMPAIGN_SCHEDULED_MESSAGE,
  MARKETING_CAMPAIGN_TEMPLATE_ARCHIVED,
  MARKETING_CAMPAIGN_TRANSITION_INVALID,
  MARKETING_TEMPLATE_NOT_PUBLISHED,
  MARKETING_TEMPLATE_VERSION_NOT_FOUND,
} from './marketing.constants';

/** Query DTO shape (validated at the HTTP layer). */
export interface ListMarketingCampaignsQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
}

/** The legal predecessor statuses for each lifecycle action. */
export const MARKETING_CAMPAIGN_TRANSITIONS: Record<
  'schedule' | 'pause' | 'resume' | 'cancel',
  MarketingCampaignStatus[]
> = {
  schedule: [MarketingCampaignStatus.DRAFT],
  pause: [MarketingCampaignStatus.SCHEDULED, MarketingCampaignStatus.SENDING],
  resume: [MarketingCampaignStatus.PAUSED],
  cancel: [
    MarketingCampaignStatus.DRAFT,
    MarketingCampaignStatus.SCHEDULED,
    MarketingCampaignStatus.SENDING,
    MarketingCampaignStatus.PAUSED,
  ],
};

/** `true` when `action` may be applied to a campaign in `from`. */
export function isMarketingCampaignTransitionAllowed(
  action: keyof typeof MARKETING_CAMPAIGN_TRANSITIONS,
  from: MarketingCampaignStatus,
): boolean {
  return MARKETING_CAMPAIGN_TRANSITIONS[action].includes(from);
}

/** Compact lifecycle projection for the pause/resume/cancel responses. */
function toLifecycleResponse(
  campaign: EmailCampaign,
  message: string,
): MarketingCampaignLifecycleResponse {
  return {
    id: campaign.id,
    status: campaign.status,
    scheduled_at: campaign.scheduled_at ? campaign.scheduled_at.toISOString() : null,
    audience_snapshot_hash: campaign.audience_snapshot_hash ?? null,
    message,
  };
}

function toCampaignResponse(campaign: EmailCampaign): MarketingCampaignResponse {
  return {
    id: campaign.id,
    name: campaign.name,
    template_id: campaign.template_id,
    template_version_id: campaign.template_version_id,
    status: campaign.status,
    audience_filter: campaign.audience_filter ?? {},
    audience_snapshot_hash: campaign.audience_snapshot_hash ?? null,
    scheduled_at: campaign.scheduled_at ? campaign.scheduled_at.toISOString() : null,
    started_at: campaign.started_at ? campaign.started_at.toISOString() : null,
    completed_at: campaign.completed_at ? campaign.completed_at.toISOString() : null,
    recipient_count: campaign.recipient_count ?? 0,
    queued_count: campaign.queued_count ?? 0,
    processing_count: campaign.processing_count ?? 0,
    sent_count: campaign.sent_count ?? 0,
    retrying_count: campaign.retrying_count ?? 0,
    failed_count: campaign.failed_count ?? 0,
    suppressed_count: campaign.suppressed_count ?? 0,
    skipped_count: campaign.skipped_count ?? 0,
    cancelled_count: campaign.cancelled_count ?? 0,
    expired_count: campaign.expired_count ?? 0,
    clicked_count: campaign.clicked_count ?? 0,
    total_click_count: campaign.total_click_count ?? 0,
    unsubscribed_count: campaign.unsubscribed_count ?? 0,
    created_by: campaign.created_by ?? null,
    created_at: campaign.created_at.toISOString(),
    updated_at: campaign.updated_at.toISOString(),
  };
}

export class MarketingCampaignsService {
  constructor(
    private readonly campaigns: typeof EmailCampaign,
    private readonly recipients: typeof EmailCampaignRecipient,
    private readonly templates: typeof EmailTemplate,
    private readonly versions: typeof EmailTemplateVersion,
    private readonly audience: MarketingAudienceService,
    private readonly sequelize: Sequelize | null,
  ) {}

  // ------------------------------------------------------------- queries

  /** Paginated campaign list with template attribution. */
  async list(query: ListMarketingCampaignsQuery): Promise<MarketingCampaignListResponse> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const where: Record<string, unknown> = {};
    if (query.status) {
      where.status = query.status;
    }
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${search.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
      where.name = { ilike: pattern };
    }

    const rows = await this.campaigns.findAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [['created_at', 'DESC']],
    });
    const total = await this.campaigns.count({ where: where as WhereOptions });

    const attribution = await this.loadAttribution(
      rows.map((campaign) => campaign.template_version_id),
    );

    const items: MarketingCampaignSummary[] = rows.map((campaign) => ({
      ...toCampaignResponse(campaign),
      template_name: attribution.get(campaign.template_version_id)?.template_name ?? null,
      template_slug: attribution.get(campaign.template_version_id)?.template_slug ?? null,
      template_version: attribution.get(campaign.template_version_id)?.version ?? null,
    }));

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

  /** One campaign with its template/version attribution. */
  async findOneOrThrow(campaignId: string): Promise<MarketingCampaignDetailResponse> {
    const campaign = await this.requireCampaign(campaignId);
    const attribution = await this.loadAttribution([campaign.template_version_id]);
    return {
      ...toCampaignResponse(campaign),
      template: attribution.get(campaign.template_version_id)?.template ?? null,
    };
  }

  // ------------------------------------------------------------ mutations

  /** Creates a draft campaign pinned to a published template version. */
  async create(
    actorUserId: string,
    dto: MarketingCampaignCreateRequest,
  ): Promise<MarketingCampaignResponse> {
    const validated = parseOrThrow(marketingCampaignCreateSchema, dto);
    // One lookup enforces both rules (published + template not archived) and
    // supplies the denormalized template_id.
    const version = await this.assertVersionUsable(validated.template_version_id);

    const campaign = await this.campaigns.create({
      name: validated.name.trim(),
      template_id: version.template_id,
      template_version_id: validated.template_version_id,
      audience_filter: validated.audience_filter,
      created_by: actorUserId,
    });
    return toCampaignResponse(campaign);
  }

  /** Updates a **draft** campaign (name, pinned version, audience filter). */
  async update(
    actorUserId: string,
    campaignId: string,
    dto: MarketingCampaignUpdateRequest,
  ): Promise<MarketingCampaignResponse> {
    const campaign = await this.requireCampaign(campaignId);
    if (campaign.status !== MarketingCampaignStatus.DRAFT) {
      throw new ConflictException(MARKETING_CAMPAIGN_ONLY_DRAFT_EDITABLE);
    }
    const validated = parseOrThrow(marketingCampaignUpdateSchema, dto);

    const updates: Record<string, unknown> = {};
    if (validated.name !== undefined) {
      updates.name = validated.name.trim();
    }
    if (validated.template_version_id !== undefined) {
      const version = await this.assertVersionUsable(validated.template_version_id);
      updates.template_id = version.template_id;
      updates.template_version_id = validated.template_version_id;
    }
    if (validated.audience_filter !== undefined) {
      updates.audience_filter = validated.audience_filter;
    }
    void actorUserId;

    await campaign.update(updates);
    await campaign.reload();
    return toCampaignResponse(campaign);
  }

  /**
   * Previews an audience.
   *
   * When `campaign_id` is supplied the campaign's **stored** filter is used —
   * a filter sent alongside it is ignored — so a preview can never claim a
   * different audience than the campaign will actually snapshot. Ad-hoc
   * filters (draft editors) are validated by the shared schema.
   */
  async previewAudience(
    dto: MarketingAudiencePreviewRequest,
  ): Promise<MarketingAudiencePreviewResponse> {
    const validated = parseOrThrow(marketingAudiencePreviewSchema, dto);
    let filter: MarketingCampaignAudienceFilter;
    if (validated.campaign_id) {
      const campaign = await this.requireCampaign(validated.campaign_id);
      filter = campaign.audience_filter ?? {};
    } else {
      filter = validated.audience_filter as MarketingCampaignAudienceFilter;
    }
    return this.audience.preview(filter);
  }

  /**
   * Schedules a campaign.
   *
   * Computes the audience **server-side**, then — inside one transaction —
   * re-checks the campaign is still a draft, writes the recipient snapshot,
   * and freezes the campaign (`status`, `scheduled_at`,
   * `audience_snapshot_hash`, `recipient_count`). Sends no email.
   *
   * Idempotent: a campaign already in `SCHEDULED` is returned untouched.
   */
  async schedule(
    actorUserId: string,
    campaignId: string,
    dto: MarketingCampaignScheduleRequest,
  ): Promise<MarketingCampaignScheduleResponse> {
    void actorUserId;
    const campaign = await this.requireCampaign(campaignId);

    if (campaign.status === MarketingCampaignStatus.SCHEDULED) {
      // Idempotent replay: nothing is recomputed, nothing is re-written —
      // the caller gets the frozen state back with a message that says so.
      return {
        campaign: toCampaignResponse(campaign),
        recipients_created: 0,
        already_scheduled: true,
        message: MARKETING_CAMPAIGN_ALREADY_SCHEDULED_MESSAGE,
      };
    }
    this.assertTransitionAllowed('schedule', campaign.status);

    const validated = parseOrThrow(marketingCampaignScheduleSchema, dto);
    const scheduledAt = validated.scheduled_at ? new Date(validated.scheduled_at) : new Date();

    // The audience is computed outside the transaction (read-only, potentially
    // a few queries) and materialized inside it.
    const computation = await this.audience.computeAudience(campaign.audience_filter ?? {});
    if (computation.final_recipient_count === 0) {
      throw new BadRequestException(MARKETING_CAMPAIGN_EMPTY_AUDIENCE);
    }

    const runSnapshot = async (
      transaction: Transaction | null,
    ): Promise<MarketingCampaignScheduleResponse> => {
      // Re-check inside the transaction: a concurrent schedule must not be
      // able to write a second snapshot over the first.
      const current = transaction
        ? await this.campaigns.findOne({
            where: { id: campaign.id },
            transaction,
            lock: Transaction.LOCK.UPDATE,
          })
        : campaign;

      if (!current) {
        throw new NotFoundException(MARKETING_CAMPAIGN_NOT_FOUND);
      }
      if (current.status === MarketingCampaignStatus.SCHEDULED) {
        return {
          campaign: toCampaignResponse(current),
          recipients_created: 0,
          already_scheduled: true,
          message: MARKETING_CAMPAIGN_ALREADY_SCHEDULED_MESSAGE,
        };
      }
      if (current.status !== MarketingCampaignStatus.DRAFT) {
        throw new ConflictException(MARKETING_CAMPAIGN_TRANSITION_INVALID);
      }

      try {
        await this.recipients.bulkCreate(
          computation.recipients.map((recipient) => ({
            campaign_id: current.id,
            school_id: recipient.school_id,
            school_name: recipient.school_name,
            normalized_email: recipient.normalized_email,
            recipient_name: recipient.recipient_name,
            recipient_source: recipient.recipient_source,
            status: MarketingRecipientStatus.PENDING,
            attempts: 0,
          })),
          { transaction: transaction ?? undefined },
        );
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          throw new ConflictException(
            'This campaign already has a recipient snapshot; refusing to write a second one',
          );
        }
        throw error;
      }

      await current.update(
        {
          status: MarketingCampaignStatus.SCHEDULED,
          scheduled_at: scheduledAt,
          audience_snapshot_hash: computation.snapshot_hash,
          recipient_count: computation.final_recipient_count,
          // Every snapshotted row starts queued; the worker moves them.
          queued_count: computation.final_recipient_count,
        },
        { transaction: transaction ?? undefined },
      );
      await current.reload();

      return {
        campaign: toCampaignResponse(current),
        recipients_created: computation.final_recipient_count,
        already_scheduled: false,
        message: MARKETING_CAMPAIGN_SCHEDULED_MESSAGE,
      };
    };

    if (this.sequelize) {
      return this.sequelize.transaction((transaction) => runSnapshot(transaction));
    }
    // DB-less smoke mode (bootstrapDatabase stubbed): still single-threaded.
    return runSnapshot(null);
  }

  // ------------------------------------------------------ lifecycle moves

  /**
   * Pauses a scheduled/sending campaign.
   *
   * Pause stops **new claims** and nothing else: the worker's claim query
   * only considers `SCHEDULED`/`SENDING` campaigns, so the next sweep takes
   * no further rows. Recipients a worker is already processing finish and
   * record their outcome — aborting them would leave leased rows with no
   * result, and a message the relay has already accepted cannot be unsent
   * anyway. The counters therefore keep moving for a few seconds after a
   * pause, which is the honest behaviour.
   */
  async pause(campaignId: string): Promise<MarketingCampaignLifecycleResponse> {
    const campaign = await this.requireCampaign(campaignId);
    this.assertTransitionAllowed('pause', campaign.status);
    await campaign.update({ status: MarketingCampaignStatus.PAUSED });
    await campaign.reload();
    return toLifecycleResponse(campaign, MARKETING_CAMPAIGN_PAUSED_MESSAGE);
  }

  /** Resumes a paused campaign (back to scheduled/sending, per started_at). */
  async resume(campaignId: string): Promise<MarketingCampaignLifecycleResponse> {
    const campaign = await this.requireCampaign(campaignId);
    this.assertTransitionAllowed('resume', campaign.status);
    await campaign.update({ status: this.resumeTarget(campaign) });
    await campaign.reload();
    return toLifecycleResponse(campaign, MARKETING_CAMPAIGN_RESUMED_MESSAGE);
  }

  /**
   * Cancels a non-terminal campaign.
   *
   * Cancelling is not only a status change: every recipient that has not
   * gone out yet is moved to `CANCELLED` in the same transaction, so the
   * delivery worker has nothing left to claim even if it is mid-sweep. The
   * worker re-checks the campaign status before each send as well — two
   * independent stops, because "one more email went out after I pressed
   * cancel" is the kind of failure an operator never forgives.
   *
   * Rows already `SENT` (and rows a worker is actively `PROCESSING`) are
   * left alone: the first are historical fact, the second are finished by
   * the worker that owns their lease and would otherwise lose their outcome.
   */
  async cancel(campaignId: string): Promise<MarketingCampaignLifecycleResponse> {
    const campaign = await this.requireCampaign(campaignId);
    this.assertTransitionAllowed('cancel', campaign.status);

    const cancelRows = async (transaction: Transaction | null): Promise<number> => {
      const [affected] = await this.recipients.update(
        {
          status: MarketingRecipientStatus.CANCELLED,
          next_attempt_at: null,
          locked_by: null,
          lease_expires_at: null,
        } as never,
        {
          where: {
            campaign_id: campaign.id,
            status: {
              [Op.in]: [MarketingRecipientStatus.PENDING, MarketingRecipientStatus.RETRYING],
            },
          } as never,
          ...(transaction ? { transaction } : {}),
        },
      );
      const cancelled = affected ?? 0;
      await campaign.update(
        {
          status: MarketingCampaignStatus.CANCELLED,
          completed_at: campaign.completed_at ?? new Date(),
          queued_count: 0,
          retrying_count: 0,
          cancelled_count: (campaign.cancelled_count ?? 0) + cancelled,
        },
        transaction ? { transaction } : {},
      );
      return cancelled;
    };

    if (this.sequelize) {
      await this.sequelize.transaction((transaction) => cancelRows(transaction));
    } else {
      await cancelRows(null);
    }
    await campaign.reload();
    return toLifecycleResponse(campaign, MARKETING_CAMPAIGN_CANCELLED_MESSAGE);
  }

  // -------------------------------------------------------------- helpers

  private assertTransitionAllowed(
    action: keyof typeof MARKETING_CAMPAIGN_TRANSITIONS,
    status: MarketingCampaignStatus,
  ): void {
    if (!isMarketingCampaignTransitionAllowed(action, status)) {
      throw new ConflictException(MARKETING_CAMPAIGN_TRANSITION_INVALID);
    }
  }

  /** A paused campaign resumes to SENDING once started, else SCHEDULED. */
  private resumeTarget(campaign: EmailCampaign): MarketingCampaignStatus {
    return campaign.started_at
      ? MarketingCampaignStatus.SENDING
      : MarketingCampaignStatus.SCHEDULED;
  }

  private async requireCampaign(campaignId: string): Promise<EmailCampaign> {
    const campaign = await this.campaigns.findOne({ where: { id: campaignId } });
    if (!campaign) {
      throw new NotFoundException(MARKETING_CAMPAIGN_NOT_FOUND);
    }
    return campaign;
  }

  private async requireVersion(templateVersionId: string): Promise<EmailTemplateVersion> {
    const version = await this.versions.findOne({ where: { id: templateVersionId } });
    if (!version) {
      throw new NotFoundException(MARKETING_TEMPLATE_VERSION_NOT_FOUND);
    }
    return version;
  }

  /**
   * Enforces the two selection rules: the pinned version must be **published**
   * (immutable), and its template must not be archived. The version's
   * template id is carried on the campaign row for reference integrity.
   */
  private async assertVersionUsable(templateVersionId: string): Promise<EmailTemplateVersion> {
    const version = await this.requireVersion(templateVersionId);
    if (!version.published_at) {
      throw new ConflictException(MARKETING_TEMPLATE_NOT_PUBLISHED);
    }
    const template = await this.templates.findOne({ where: { id: version.template_id } });
    if (!template) {
      throw new NotFoundException(MARKETING_TEMPLATE_VERSION_NOT_FOUND);
    }
    if (template.status === MarketingTemplateStatus.ARCHIVED) {
      throw new ConflictException(MARKETING_CAMPAIGN_TEMPLATE_ARCHIVED);
    }
    return version;
  }

  /** Loads template name/slug/version for a set of pinned version ids. */
  private async loadAttribution(templateVersionIds: string[]): Promise<
    Map<
      string,
      {
        template_name: string | null;
        template_slug: string | null;
        version: number | null;
        template: MarketingCampaignTemplateSummary | null;
      }
    >
  > {
    const map = new Map<
      string,
      {
        template_name: string | null;
        template_slug: string | null;
        version: number | null;
        template: MarketingCampaignTemplateSummary | null;
      }
    >();
    if (templateVersionIds.length === 0) {
      return map;
    }
    const uniqueIds = [...new Set(templateVersionIds)];
    const versionRows = await this.versions.findAll({ where: { id: uniqueIds } });
    const templateIds = [...new Set(versionRows.map((version) => version.template_id))];
    const templateRows = templateIds.length
      ? await this.templates.findAll({ where: { id: templateIds } })
      : [];
    const templatesById = new Map(templateRows.map((template) => [template.id, template]));

    for (const version of versionRows) {
      const template = templatesById.get(version.template_id);
      map.set(version.id, {
        template_name: template?.name ?? null,
        template_slug: template?.slug ?? null,
        version: version.version,
        template: template
          ? {
              id: template.id,
              name: template.name,
              slug: template.slug,
              version: version.version,
              subject: version.subject,
              published_at: version.published_at ? version.published_at.toISOString() : null,
            }
          : null,
      });
    }
    return map;
  }
}
