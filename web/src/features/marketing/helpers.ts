import {
  MARKETING_LEAD_STATUS_TRANSITIONS,
  MarketingCampaignStatus,
  MarketingLeadEventType,
  MarketingLeadSource,
  MarketingLeadStatus,
  MarketingRecipientSource,
  MarketingTemplateStatus,
  type MarketingCampaignAudienceFilter,
  type MarketingCampaignResponse,
  type MarketingTemplateSummary,
  type MarketingTemplateVersionResponse,
} from '@school-bus-tracking/shared-types';

/**
 * Pure presentation logic for the marketing console.
 *
 * React-free and free of relative imports, so the Node test runner
 * (`npm --prefix web run test:web`) executes it directly — the same
 * convention as `features/documents/helpers.ts`. The pages stay thin and the
 * rules that matter (which lifecycle buttons exist, what a progress bar adds
 * up to, what a status badge claims) are asserted without a DOM.
 */

/** Matches the `BadgeTone` union of `components/ui` structurally. */
export type MarketingTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

// ------------------------------------------------------------------ templates

export function marketingTemplateStatusLabel(status: MarketingTemplateStatus): string {
  switch (status) {
    case MarketingTemplateStatus.DRAFT:
      return 'Draft';
    case MarketingTemplateStatus.PUBLISHED:
      return 'Published';
    case MarketingTemplateStatus.ARCHIVED:
      return 'Archived';
    default:
      return String(status);
  }
}

export function marketingTemplateStatusTone(status: MarketingTemplateStatus): MarketingTone {
  switch (status) {
    case MarketingTemplateStatus.PUBLISHED:
      return 'success';
    case MarketingTemplateStatus.DRAFT:
      return 'warning';
    case MarketingTemplateStatus.ARCHIVED:
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** One-line summary of a template's version state for the list view. */
export function describeTemplateVersions(template: MarketingTemplateSummary): string {
  const published =
    template.latest_published_version === null
      ? 'no published version'
      : `v${template.latest_published_version} published`;
  const draft = template.draft_version === null ? null : `v${template.draft_version} draft`;
  return [published, draft].filter(Boolean).join(' · ');
}

/** A version is editable only while it is an unpublished draft. */
export function isTemplateVersionEditable(
  version: Pick<MarketingTemplateVersionResponse, 'published_at'> | null | undefined,
  templateStatus: MarketingTemplateStatus,
): boolean {
  if (!version || templateStatus === MarketingTemplateStatus.ARCHIVED) {
    return false;
  }
  return version.published_at === null;
}

/** Publishing is offered for a draft of a non-archived template. */
export function canPublishTemplateVersion(
  version: Pick<MarketingTemplateVersionResponse, 'published_at'> | null | undefined,
  templateStatus: MarketingTemplateStatus,
): boolean {
  return isTemplateVersionEditable(version, templateStatus);
}

/** Archiving is offered for anything not already archived. */
export function canArchiveTemplate(status: MarketingTemplateStatus): boolean {
  return status !== MarketingTemplateStatus.ARCHIVED;
}

/**
 * Whether the "Send test email" button is offered at all.
 *
 * The button never takes an address: the server sends to
 * `MARKETING_TEST_RECIPIENTS` and the request body carries no recipient. The
 * UI therefore only decides *whether* there is something to send.
 */
export function canTestSendVersion(
  version: Pick<MarketingTemplateVersionResponse, 'id'> | null | undefined,
): boolean {
  return Boolean(version?.id);
}

/** The sentence shown next to the test-send button. */
export const MARKETING_TEST_SEND_NOTE =
  'Test emails go only to the addresses configured in MARKETING_TEST_RECIPIENTS. You cannot type a recipient here.';

// ------------------------------------------------------------------ campaigns

export function marketingCampaignStatusLabel(status: MarketingCampaignStatus): string {
  switch (status) {
    case MarketingCampaignStatus.DRAFT:
      return 'Draft';
    case MarketingCampaignStatus.SCHEDULED:
      return 'Scheduled';
    case MarketingCampaignStatus.SENDING:
      return 'Sending';
    case MarketingCampaignStatus.PAUSED:
      return 'Paused';
    case MarketingCampaignStatus.COMPLETED:
      return 'Completed';
    case MarketingCampaignStatus.PARTIALLY_FAILED:
      return 'Completed with failures';
    case MarketingCampaignStatus.FAILED:
      return 'Failed';
    case MarketingCampaignStatus.CANCELLED:
      return 'Cancelled';
    default:
      return String(status);
  }
}

export function marketingCampaignStatusTone(status: MarketingCampaignStatus): MarketingTone {
  switch (status) {
    case MarketingCampaignStatus.COMPLETED:
      return 'success';
    case MarketingCampaignStatus.SENDING:
    case MarketingCampaignStatus.SCHEDULED:
      return 'info';
    case MarketingCampaignStatus.PAUSED:
    case MarketingCampaignStatus.PARTIALLY_FAILED:
      return 'warning';
    case MarketingCampaignStatus.FAILED:
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Statuses in which the delivery worker may still claim recipients. */
export function isCampaignActive(status: MarketingCampaignStatus): boolean {
  return (
    status === MarketingCampaignStatus.SCHEDULED || status === MarketingCampaignStatus.SENDING
  );
}

/** A campaign that can no longer change. */
export function isCampaignTerminal(status: MarketingCampaignStatus): boolean {
  return (
    status === MarketingCampaignStatus.COMPLETED ||
    status === MarketingCampaignStatus.PARTIALLY_FAILED ||
    status === MarketingCampaignStatus.FAILED ||
    status === MarketingCampaignStatus.CANCELLED
  );
}

export function canScheduleCampaign(status: MarketingCampaignStatus): boolean {
  return status === MarketingCampaignStatus.DRAFT;
}

export function canEditCampaign(status: MarketingCampaignStatus): boolean {
  // Once an audience snapshot is frozen the campaign is a historical record.
  return status === MarketingCampaignStatus.DRAFT;
}

export function canPauseCampaign(status: MarketingCampaignStatus): boolean {
  return isCampaignActive(status);
}

export function canResumeCampaign(status: MarketingCampaignStatus): boolean {
  return status === MarketingCampaignStatus.PAUSED;
}

export function canCancelCampaign(status: MarketingCampaignStatus): boolean {
  return !isCampaignTerminal(status);
}

/** One segment of the progress bar. */
export interface CampaignProgressSegment {
  key:
    | 'sent'
    | 'processing'
    | 'retrying'
    | 'failed'
    | 'suppressed'
    | 'skipped'
    | 'cancelled'
    | 'expired'
    | 'queued';
  label: string;
  count: number;
  tone: MarketingTone;
  /** Share of the snapshot, 0–100, rounded to one decimal. */
  percent: number;
}

const SEGMENT_DEFINITIONS: Array<{
  key: CampaignProgressSegment['key'];
  label: string;
  tone: MarketingTone;
  read: (campaign: MarketingCampaignResponse) => number;
}> = [
  { key: 'sent', label: 'Sent', tone: 'success', read: (c) => c.sent_count },
  { key: 'processing', label: 'Sending now', tone: 'info', read: (c) => c.processing_count },
  { key: 'retrying', label: 'Retrying', tone: 'warning', read: (c) => c.retrying_count },
  { key: 'failed', label: 'Failed', tone: 'danger', read: (c) => c.failed_count },
  { key: 'suppressed', label: 'Suppressed', tone: 'neutral', read: (c) => c.suppressed_count },
  { key: 'skipped', label: 'Skipped', tone: 'neutral', read: (c) => c.skipped_count },
  { key: 'cancelled', label: 'Cancelled', tone: 'neutral', read: (c) => c.cancelled_count },
  { key: 'expired', label: 'Expired', tone: 'neutral', read: (c) => c.expired_count },
  { key: 'queued', label: 'Queued', tone: 'neutral', read: (c) => c.queued_count },
];

/** Non-zero progress segments, in the order the bar draws them. */
export function campaignProgressSegments(
  campaign: MarketingCampaignResponse,
): CampaignProgressSegment[] {
  const total = Math.max(0, campaign.recipient_count);
  return SEGMENT_DEFINITIONS.map((definition) => {
    const count = Math.max(0, definition.read(campaign) ?? 0);
    return {
      key: definition.key,
      label: definition.label,
      tone: definition.tone,
      count,
      percent: total === 0 ? 0 : Math.round((count / total) * 1000) / 10,
    };
  }).filter((segment) => segment.count > 0);
}

/** Recipients that have reached a terminal state, as a percentage. */
export function campaignCompletionPercent(campaign: MarketingCampaignResponse): number {
  const total = Math.max(0, campaign.recipient_count);
  if (total === 0) {
    return 0;
  }
  const outstanding =
    Math.max(0, campaign.queued_count) +
    Math.max(0, campaign.processing_count) +
    Math.max(0, campaign.retrying_count);
  const done = Math.max(0, total - outstanding);
  return Math.min(100, Math.round((done / total) * 100));
}

/** Recipients the worker may still act on. */
export function campaignOutstandingCount(campaign: MarketingCampaignResponse): number {
  return (
    Math.max(0, campaign.queued_count) +
    Math.max(0, campaign.processing_count) +
    Math.max(0, campaign.retrying_count)
  );
}

/** Click-through rate over delivered mail, as a percentage with one decimal. */
export function campaignClickRate(campaign: MarketingCampaignResponse): number | null {
  if (campaign.sent_count <= 0) {
    return null;
  }
  return Math.round((campaign.clicked_count / campaign.sent_count) * 1000) / 10;
}

/**
 * The server-side default of `MARKETING_RATE_PER_MINUTE`, mirrored for the
 * console's pacing sentence.
 *
 * The real value lives in server config and is deliberately not exposed to
 * the browser, so every sentence built from it is hedged with "about".
 */
export const MARKETING_DISPLAY_RATE_PER_MINUTE = 60;

/**
 * The sentence that explains why a campaign is not "sent" the instant it is
 * scheduled.
 *
 * Operators otherwise read a 4%-complete bar as a bug. Stating the pacing —
 * and the reason for it — is the difference between a support ticket and an
 * informed wait.
 */
export function describeGradualDelivery(
  recipientCount: number,
  ratePerMinute: number,
): string {
  const rate = Math.max(1, Math.floor(ratePerMinute));
  const minutes = Math.max(1, Math.ceil(Math.max(0, recipientCount) / rate));
  const duration =
    minutes < 60
      ? `${minutes} minute${minutes === 1 ? '' : 's'}`
      : `${Math.round((minutes / 60) * 10) / 10} hours`;
  return `Delivery is paced at about ${rate} emails per minute, so this campaign takes roughly ${duration}. Sending slowly protects the sending domain's reputation — a burst of thousands of messages is what makes mail providers start rejecting them.`;
}

// ------------------------------------------------------------------- audience

export const MARKETING_RECIPIENT_SOURCE_LABELS: Record<MarketingRecipientSource, string> = {
  [MarketingRecipientSource.SCHOOL_EMAIL]: "School's main contact address",
  [MarketingRecipientSource.SCHOOL_ADMIN]: 'Active school administrators',
};

/** Human summary of a saved audience filter, for the campaign detail page. */
export function describeAudienceFilter(filter: MarketingCampaignAudienceFilter): string {
  const parts: string[] = [];
  if (filter.search) {
    parts.push(`matching “${filter.search}”`);
  }
  if (filter.countries?.length) {
    parts.push(`in ${filter.countries.join(', ')}`);
  }
  if (filter.states?.length) {
    parts.push(`in ${filter.states.join(', ')}`);
  }
  if (filter.cities?.length) {
    parts.push(`in ${filter.cities.join(', ')}`);
  }
  if (filter.subscription_statuses?.length) {
    parts.push(`with subscription ${filter.subscription_statuses.join(' / ')}`);
  }
  if (filter.include_school_ids?.length) {
    parts.push(`limited to ${filter.include_school_ids.length} selected school(s)`);
  }
  if (filter.exclude_school_ids?.length) {
    parts.push(`excluding ${filter.exclude_school_ids.length} school(s)`);
  }
  const sources = (filter.recipient_sources ?? [MarketingRecipientSource.SCHOOL_EMAIL])
    .map((source) => MARKETING_RECIPIENT_SOURCE_LABELS[source] ?? source)
    .join(' + ');
  const scope = parts.length > 0 ? `Schools ${parts.join(', ')}` : 'All schools';
  // "Active only" is the default, so it is a qualifier rather than the whole
  // description — saying it first would make an unfiltered audience look
  // narrower than it is.
  const activity = filter.active_only === false ? 'including inactive schools' : 'active only';
  return `${scope} (${activity}) — ${sources}.`;
}

/** Splits a comma/newline separated console input into a clean list. */
export function parseFilterList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

// ---------------------------------------------------------------- demo leads

export function marketingLeadStatusLabel(status: MarketingLeadStatus): string {
  switch (status) {
    case MarketingLeadStatus.NEW:
      return 'New';
    case MarketingLeadStatus.CONTACTED:
      return 'Contacted';
    case MarketingLeadStatus.QUALIFIED:
      return 'Qualified';
    case MarketingLeadStatus.DEMO_SCHEDULED:
      return 'Demo scheduled';
    case MarketingLeadStatus.CONVERTED:
      return 'Converted';
    case MarketingLeadStatus.LOST:
      return 'Lost';
    default:
      return String(status);
  }
}

export function marketingLeadStatusTone(status: MarketingLeadStatus): MarketingTone {
  switch (status) {
    case MarketingLeadStatus.NEW:
      return 'info';
    case MarketingLeadStatus.CONTACTED:
      return 'warning';
    case MarketingLeadStatus.QUALIFIED:
      return 'info';
    case MarketingLeadStatus.DEMO_SCHEDULED:
      return 'warning';
    case MarketingLeadStatus.CONVERTED:
      return 'success';
    case MarketingLeadStatus.LOST:
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function marketingLeadSourceLabel(source: MarketingLeadSource): string {
  switch (source) {
    case MarketingLeadSource.LANDING_PAGE:
      return 'Landing page';
    case MarketingLeadSource.CAMPAIGN_REPLY:
      return 'Campaign reply';
    case MarketingLeadSource.MANUAL:
      return 'Manual entry';
    default:
      return String(source);
  }
}

/**
 * The transitions the console may offer for a lead in `status` — a mirror
 * of the server-enforced `MARKETING_LEAD_STATUS_TRANSITIONS`. The UI only
 * *offers*; the API *decides*. `DEMO_SCHEDULED` is offered like any other
 * button, but its wording must make clear it means a **confirmed**
 * appointment (there is no calendar integration to confirm one for you).
 */
export function marketingLeadNextStatuses(status: MarketingLeadStatus): MarketingLeadStatus[] {
  return [...(MARKETING_LEAD_STATUS_TRANSITIONS[status] ?? [])];
}

/** The action wording of each transition button. */
export function marketingLeadActionLabel(target: MarketingLeadStatus): string {
  switch (target) {
    case MarketingLeadStatus.CONTACTED:
      return 'Mark contacted';
    case MarketingLeadStatus.QUALIFIED:
      return 'Mark qualified';
    case MarketingLeadStatus.DEMO_SCHEDULED:
      return 'Mark demo scheduled';
    case MarketingLeadStatus.CONVERTED:
      return 'Mark converted';
    case MarketingLeadStatus.LOST:
      return 'Mark lost';
    default:
      return `Mark ${String(target).toLowerCase()}`;
  }
}

/** One-line description of a timeline event for the lead detail page. */
export function describeLeadEvent(event: {
  event_type: MarketingLeadEventType;
  metadata: Record<string, unknown> | null;
}): string {
  const metadata = event.metadata ?? {};
  switch (event.event_type) {
    case MarketingLeadEventType.CREATED:
      return metadata['attributed']
        ? 'Demo request received (campaign-attributed visit)'
        : 'Demo request received';
    case MarketingLeadEventType.STATUS_CHANGED: {
      const from = typeof metadata['from'] === 'string' ? metadata['from'] : null;
      const to = typeof metadata['to'] === 'string' ? metadata['to'] : null;
      return from && to
        ? `Status changed: ${marketingLeadStatusLabel(from as MarketingLeadStatus)} → ${marketingLeadStatusLabel(to as MarketingLeadStatus)}`
        : 'Status changed';
    }
    case MarketingLeadEventType.CONTACTED:
      return 'Marked as contacted';
    case MarketingLeadEventType.NOTE_ADDED:
      return typeof metadata['note'] === 'string' ? `Note: ${metadata['note']}` : 'Note added';
    case MarketingLeadEventType.ADMIN_NOTIFIED:
      return 'Admin notification email sent';
    case MarketingLeadEventType.ADMIN_NOTIFY_FAILED:
      return 'Admin notification email failed (lead is safely stored)';
    default:
      return String(event.event_type);
  }
}
