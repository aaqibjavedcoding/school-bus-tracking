/**
 * Marketing demo leads (Session 4): public capture + the Super Admin
 * pipeline console behind it.
 *
 * The service has two very different callers and is written around that
 * asymmetry:
 *
 * - **`captureDemoRequest` is public.** Anyone on the internet reaches it
 *   through the landing page form, so nothing the client sends is trusted
 *   beyond the validated form fields: no `school_id`, no `campaign_id`, no
 *   `recipient_id`, no admin address, ever. Campaign attribution comes
 *   exclusively from resolving the opaque attribution cookie server-side; a
 *   forged or stale cookie silently resolves to nothing. The response is
 *   the same generic sentence for a stored lead, a deduplicated replay and
 *   a honeypot hit.
 * - **Everything else is SUPER_ADMIN only** (enforced by the route layer)
 *   and platform-scoped — leads carry no `school_id`, so there is no tenant
 *   to leak across; school roles are rejected before any handler runs.
 *
 * Ordering guarantee the whole feature hangs on: **the lead row is committed
 * before any notification is attempted.** The admin notification runs
 * afterwards, asynchronously, through {@link MarketingLeadNotifier}; its
 * failure appends an `ADMIN_NOTIFY_FAILED` event and touches nothing else.
 * A dead SMTP relay can therefore never lose, delay or roll back a lead —
 * and never slows the public response down.
 */

import { createHash } from 'crypto';
import { Op, type WhereOptions } from 'sequelize';
import {
  MarketingLeadEventType,
  MarketingLeadSource,
  MarketingLeadStatus,
  isMarketingLeadTransitionAllowed,
  type MarketingDemoLeadInput,
  type MarketingDemoRequestResponse,
  type MarketingLeadDetailResponse,
  type MarketingLeadEventResponse,
  type MarketingLeadListQuery,
  type MarketingLeadListResponse,
  type MarketingLeadMetricsResponse,
  type MarketingLeadResponse,
  type MarketingLeadSummary,
  type PaginationMeta,
} from '@school-bus-tracking/shared-types';
import { marketingDemoLeadInputSchema } from '@school-bus-tracking/validation';
import { BadRequestException, Logger, NotFoundException } from '../../framework';
import type {
  EmailCampaign,
  EmailCampaignRecipient,
  MarketingLead,
  MarketingLeadEvent,
  MarketingSuppression,
} from '../../database/models';
import type { MarketingResolvedAttribution } from './marketing-tracking.service';
import {
  MARKETING_DEMO_REQUEST_RECEIVED_MESSAGE,
  MARKETING_LEAD_DEDUPE_WINDOW_MS,
  MARKETING_LEAD_METRICS_RECENT_LEADS,
  MARKETING_LEAD_METRICS_TOP_CAMPAIGNS,
  MARKETING_LEAD_NOT_FOUND,
  MARKETING_LEAD_TRANSITION_INVALID,
} from './marketing.constants';

/** What the notifier needs — the service never talks SMTP itself. */
export interface MarketingLeadNotifier {
  /**
   * Fire-and-forget: scheduled after the lead is committed, never awaited by
   * the public request, never able to throw into it.
   */
  notifyNewLead(lead: MarketingLead): void;
}

export interface MarketingLeadsServiceDeps {
  leads: typeof MarketingLead;
  events: typeof MarketingLeadEvent;
  campaigns: typeof EmailCampaign;
  recipients: typeof EmailCampaignRecipient;
  suppressions: typeof MarketingSuppression;
  /**
   * Resolves the opaque attribution cookie. Injected (rather than importing
   * the tracking service) so tests can drive every branch; the container
   * wires it to `MarketingTrackingService.resolveAttribution`.
   */
  resolveAttribution: (cookieValue: string | undefined) => Promise<MarketingResolvedAttribution | null>;
  notifier: MarketingLeadNotifier;
  now?: () => Date;
}

/** Context of one public submission, assembled by the endpoint. */
export interface DemoRequestContext {
  /** Raw value of the attribution cookie, when the browser sent one. */
  attributionCookie?: string;
}

export class MarketingLeadsService {
  private readonly logger = new Logger(MarketingLeadsService.name);
  private readonly now: () => Date;

  constructor(private readonly deps: MarketingLeadsServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  // ---------------------------------------------------------- public capture

  /**
   * Stores one demo request from the public landing page form.
   *
   * Pipeline (in this exact order, because each step protects the next):
   *
   * 1. **Honeypot.** A filled hidden field means a bot; answer the generic
   *    response and store nothing. Indistinguishable from success outside.
   * 2. **Validation** against the shared zod schema (bounded fields,
   *    `consent === true` mandatory), plus email normalization.
   * 3. **Idempotency.** An identical submission (same content fingerprint)
   *    inside the dedupe window is a browser retry — return the generic
   *    response without a second row or a second notification.
   * 4. **Attribution.** The opaque cookie is resolved server-side; only a
   *    digest that matches a real campaign/recipient attaches. Client JSON
   *    can never name a campaign or recipient.
   * 5. **Store** the lead + its `CREATED` event.
   * 6. **Then** schedule the admin notification — after the write, outside
   *    the request-critical path.
   */
  async captureDemoRequest(
    input: MarketingDemoLeadInput,
    context: DemoRequestContext = {},
  ): Promise<MarketingDemoRequestResponse> {
    const genericResponse: MarketingDemoRequestResponse = {
      received: true,
      message: MARKETING_DEMO_REQUEST_RECEIVED_MESSAGE,
    };

    // 1. Honeypot — silently drop, identically-shaped answer.
    if (typeof input?.website === 'string' && input.website.trim() !== '') {
      this.logger.warn('Public demo request dropped: honeypot field was filled.');
      return genericResponse;
    }

    // 2. Shared validation. The route DTO already bounded the outer shape;
    // this is the single source of field truth (same schema the docs name).
    const parsed = marketingDemoLeadInputSchema.safeParse({ ...input, website: undefined });
    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message ?? 'Please check the form and try again.';
      throw new BadRequestException(message);
    }
    const data = parsed.data;
    const email = data.email; // schema output: trimmed + lowercased

    // 3. Idempotency by content fingerprint.
    const fingerprint = submissionFingerprint(email, data);
    const windowStart = new Date(this.now().getTime() - MARKETING_LEAD_DEDUPE_WINDOW_MS);
    const duplicate = await this.deps.leads.findOne({
      where: {
        submission_fingerprint: fingerprint,
        created_at: { [Op.gte]: windowStart },
      } as never,
      order: [['created_at', 'DESC']],
    });
    if (duplicate) {
      // A retry of the same submission: same answer, no new row, no second
      // notification. The caller cannot tell this branch from a store.
      return genericResponse;
    }

    // 4. Attribution — only what the opaque cookie proves, never client JSON.
    let attribution: MarketingResolvedAttribution | null = null;
    try {
      attribution = await this.deps.resolveAttribution(context.attributionCookie);
    } catch (error) {
      // Attribution is nice-to-have; a resolver hiccup must not lose a lead.
      this.logger.warn(
        `Attribution resolution failed; storing lead without attribution: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // 5. Store the lead FIRST. Consent is recorded at capture time by the
    // server; the client only ever says "true", never a timestamp.
    const capturedAt = this.now();
    const lead = await this.deps.leads.create({
      full_name: data.full_name,
      normalized_email: email,
      institution_name: data.institution_name,
      phone: data.phone ?? null,
      city: data.city ?? null,
      country: data.country ?? null,
      message: data.message ?? null,
      preferred_contact_time: data.preferred_contact_time ?? null,
      status: MarketingLeadStatus.NEW,
      source: MarketingLeadSource.LANDING_PAGE,
      utm: data.utm ?? null,
      campaign_id: attribution?.campaign_id ?? null,
      campaign_recipient_id: attribution?.campaign_recipient_id ?? null,
      consent_at: capturedAt,
      consent_source: 'public-form',
      submission_fingerprint: fingerprint,
    } as never);

    await this.recordEvent(lead.id, MarketingLeadEventType.CREATED, 'public-form', {
      source: MarketingLeadSource.LANDING_PAGE,
      attributed: Boolean(attribution),
      attributed_recipient: Boolean(attribution?.campaign_recipient_id),
      consent_source: 'public-form',
    });

    // 6. Notification — after the commit, fire-and-forget. A relay outage
    // is the notifier's problem (it records the failure); never this
    // request's problem, and never the lead's.
    try {
      this.deps.notifier.notifyNewLead(lead);
    } catch (error) {
      this.logger.warn(
        `Failed to schedule the new-lead notification: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return genericResponse;
  }

  // ------------------------------------------------------------- admin reads

  async list(query: MarketingLeadListQuery): Promise<MarketingLeadListResponse> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const where: Record<string | symbol, unknown> = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.source) {
      where.source = query.source;
    }
    if (query.campaign_id) {
      where.campaign_id = query.campaign_id;
    }
    const createdBounds: Record<symbol, Date> = {};
    const from = parseDate(query.created_from);
    if (from) {
      createdBounds[Op.gte] = from;
    }
    const to = parseDate(query.created_to, true);
    if (to) {
      createdBounds[Op.lte] = to;
    }
    if (Object.getOwnPropertySymbols(createdBounds).length > 0) {
      where.created_at = createdBounds;
    }
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${search.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
      where[Op.or as never] = [
        { full_name: { [Op.iLike]: pattern } },
        { normalized_email: { [Op.iLike]: pattern } },
        { institution_name: { [Op.iLike]: pattern } },
      ];
    }

    const rows = await this.deps.leads.findAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [['created_at', 'DESC']],
    });
    const total = await this.deps.leads.count({ where: where as WhereOptions });

    const totalPages = Math.ceil(total / limit) || 1;
    const meta: PaginationMeta = {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
    return { items: rows.map((lead) => toLeadSummary(lead)), meta };
  }

  async findOneOrThrow(leadId: string): Promise<MarketingLeadDetailResponse> {
    const lead = await this.requireLead(leadId);

    const [campaign, recipient, events] = await Promise.all([
      lead.campaign_id
        ? this.deps.campaigns.findOne({ where: { id: lead.campaign_id } })
        : Promise.resolve(null),
      lead.campaign_recipient_id
        ? this.deps.recipients.findOne({ where: { id: lead.campaign_recipient_id } })
        : Promise.resolve(null),
      this.deps.events.findAll({
        where: { lead_id: lead.id } as never,
        order: [['created_at', 'DESC']],
        limit: 200,
      }),
    ]);

    return {
      lead: toLeadResponse(lead, {
        campaignName: campaign ? (campaign as { name?: string }).name ?? null : null,
        attributedClickAt:
          (recipient as { first_clicked_at?: Date | null } | null)?.first_clicked_at ?? null,
      }),
      events: events.map((event) => toLeadEventResponse(event)),
    };
  }

  // --------------------------------------------------------- admin mutations

  /**
   * Moves a lead through the pipeline. The transition graph is enforced
   * here — the console only *offers* buttons, the server *decides*. In
   * particular `DEMO_SCHEDULED` is only ever set by this explicit action,
   * because without calendar integration nobody but the operator who booked
   * the appointment can truthfully claim one exists.
   */
  async updateStatus(
    leadId: string,
    nextStatus: MarketingLeadStatus,
    note?: string,
  ): Promise<MarketingLeadResponse> {
    const lead = await this.requireLead(leadId);
    const from = lead.status;

    if (!isMarketingLeadTransitionAllowed(from, nextStatus)) {
      throw new BadRequestException(MARKETING_LEAD_TRANSITION_INVALID);
    }

    await lead.update({ status: nextStatus });
    await this.recordEvent(lead.id, MarketingLeadEventType.STATUS_CHANGED, 'super-admin', {
      from,
      to: nextStatus,
      ...(note ? { note } : {}),
    });
    if (nextStatus === MarketingLeadStatus.CONTACTED) {
      await this.recordEvent(lead.id, MarketingLeadEventType.CONTACTED, 'super-admin', null);
    }

    return toLeadResponse(lead, { campaignName: null, attributedClickAt: null });
  }

  /** Appends an internal note to the lead's timeline. */
  async addNote(leadId: string, note: string): Promise<MarketingLeadEventResponse> {
    const lead = await this.requireLead(leadId);
    const trimmed = note.trim();
    if (trimmed.length === 0 || trimmed.length > 2000) {
      throw new BadRequestException('Please enter a note of at most 2000 characters.');
    }
    const event = await this.deps.events.create({
      lead_id: lead.id,
      event_type: MarketingLeadEventType.NOTE_ADDED,
      actor: 'super-admin',
      metadata: { note: trimmed },
    } as never);
    return toLeadEventResponse(event);
  }

  // ---------------------------------------------------------------- metrics

  /**
   * The marketing funnel in plain counts. Every figure is a grouped
   * aggregate over tables this module already owns; deliberately no
   * charting dependency and no per-recipient detail.
   */
  async metrics(): Promise<MarketingLeadMetricsResponse> {
    const now = this.now();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalLeads, last7, last30, allLeads, recentRows, suppressedTotal] = await Promise.all([
      this.deps.leads.count({}),
      this.deps.leads.count({ where: { created_at: { [Op.gte]: sevenDaysAgo } } as never }),
      this.deps.leads.count({ where: { created_at: { [Op.gte]: thirtyDaysAgo } } as never }),
      this.deps.leads.findAll({
        attributes: ['id', 'status', 'campaign_id'],
        limit: 10_000,
      } as never),
      this.deps.leads.findAll({
        order: [['created_at', 'DESC']],
        limit: MARKETING_LEAD_METRICS_RECENT_LEADS,
      }),
      this.deps.suppressions.count({}),
    ]);

    const byStatus = Object.fromEntries(
      Object.values(MarketingLeadStatus).map((status) => [status, 0]),
    ) as Record<MarketingLeadStatus, number>;
    const byCampaign = new Map<string, number>();
    let attributedLeads = 0;
    for (const row of allLeads as Array<{ status: MarketingLeadStatus; campaign_id: string | null }>) {
      if (row.status in byStatus) {
        byStatus[row.status] += 1;
      }
      if (row.campaign_id) {
        attributedLeads += 1;
        byCampaign.set(row.campaign_id, (byCampaign.get(row.campaign_id) ?? 0) + 1);
      }
    }

    // Click totals come from the campaign counters the delivery/tracking
    // rails maintain — no recipient row scan and no address ever loaded.
    const campaigns = await this.deps.campaigns.findAll({
      attributes: ['id', 'name', 'total_click_count', 'clicked_count'],
      limit: 1_000,
    } as never);
    let totalClicks = 0;
    let uniqueClicks = 0;
    const campaignNames = new Map<string, string | null>();
    for (const campaign of campaigns as Array<{
      id: string;
      name?: string | null;
      total_click_count?: number | null;
      clicked_count?: number | null;
    }>) {
      totalClicks += campaign.total_click_count ?? 0;
      uniqueClicks += campaign.clicked_count ?? 0;
      campaignNames.set(campaign.id, campaign.name ?? null);
    }

    const leadsByCampaign = [...byCampaign.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MARKETING_LEAD_METRICS_TOP_CAMPAIGNS)
      .map(([campaignId, count]) => ({
        campaign_id: campaignId,
        campaign_name: campaignNames.get(campaignId) ?? null,
        leads: count,
      }));

    return {
      total_leads: totalLeads,
      new_leads_last_7_days: last7,
      new_leads_last_30_days: last30,
      leads_by_status: byStatus,
      leads_by_campaign: leadsByCampaign,
      total_clicks: totalClicks,
      unique_clicks: uniqueClicks,
      click_to_lead_rate:
        uniqueClicks > 0 ? Math.round((attributedLeads / uniqueClicks) * 1000) / 10 : null,
      unsubscribed_total: suppressedTotal,
      recent_leads: recentRows.map((lead) => toLeadSummary(lead)),
    };
  }

  // ----------------------------------------------------------------- helpers

  private async requireLead(leadId: string): Promise<MarketingLead> {
    const lead = await this.deps.leads.findOne({ where: { id: leadId } });
    if (!lead) {
      throw new NotFoundException(MARKETING_LEAD_NOT_FOUND);
    }
    return lead;
  }

  private async recordEvent(
    leadId: string,
    eventType: MarketingLeadEventType,
    actor: string,
    metadata: Record<string, unknown> | null,
  ): Promise<void> {
    try {
      await this.deps.events.create({
        lead_id: leadId,
        event_type: eventType,
        actor,
        metadata,
      } as never);
    } catch (error) {
      // The event trail is best-effort context; losing one line must never
      // fail the mutation that already happened.
      this.logger.warn(
        `Lead event write failed (${eventType}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

// ------------------------------------------------------------- projections

function toLeadSummary(lead: MarketingLead): MarketingLeadSummary {
  return {
    id: lead.id,
    full_name: lead.full_name,
    email: lead.normalized_email,
    institution_name: lead.institution_name ?? null,
    city: lead.city ?? null,
    country: lead.country ?? null,
    status: lead.status,
    source: lead.source,
    campaign_id: lead.campaign_id ?? null,
    created_at: toIso(lead.created_at),
    updated_at: toIso(lead.updated_at),
  };
}

function toLeadResponse(
  lead: MarketingLead,
  context: { campaignName: string | null; attributedClickAt: Date | null },
): MarketingLeadResponse {
  return {
    ...toLeadSummary(lead),
    phone: lead.phone ?? null,
    message: lead.message ?? null,
    preferred_contact_time: lead.preferred_contact_time ?? null,
    utm: lead.utm ?? null,
    campaign_name: context.campaignName,
    campaign_recipient_id: lead.campaign_recipient_id ?? null,
    attributed_click_at: context.attributedClickAt ? toIso(context.attributedClickAt) : null,
    consent_at: toIso(lead.consent_at),
    consent_source: lead.consent_source ?? 'public-form',
    admin_notified_at: lead.admin_notified_at ? toIso(lead.admin_notified_at) : null,
  };
}

function toLeadEventResponse(event: MarketingLeadEvent): MarketingLeadEventResponse {
  return {
    id: event.id,
    event_type: event.event_type,
    actor: event.actor,
    metadata: event.metadata ?? null,
    created_at: toIso(event.created_at),
  };
}

function toIso(value: Date | string | undefined | null): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' ? value : new Date().toISOString();
}

function parseDate(raw: string | undefined, endOfDay = false): Date | null {
  if (!raw || raw.trim() === '') {
    return null;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    parsed.setUTCHours(23, 59, 59, 999);
  }
  return parsed;
}

/**
 * Content fingerprint of one submission — the idempotency key of an
 * accountless form. A digest over the normalized identifying fields; never
 * an IP address, never a token, and never stored in any reversible form.
 */
export function submissionFingerprint(
  normalizedEmail: string,
  data: Pick<MarketingDemoLeadInput, 'full_name' | 'institution_name' | 'message'>,
): string {
  return createHash('sha256')
    .update(
      [
        normalizedEmail,
        data.full_name.trim().toLowerCase(),
        data.institution_name?.trim().toLowerCase() ?? '',
        (data.message ?? '').trim(),
      ].join('\u0000'),
    )
    .digest('hex');
}
