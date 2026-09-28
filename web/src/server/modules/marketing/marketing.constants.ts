/**
 * User-facing messages and small knobs for the marketing module
 * (Super Admin templates & campaigns).
 *
 * Messages follow the admin-plans convention: short, actionable, and safe to
 * return verbatim in an HTTP error envelope. None of them ever includes
 * content (subject/body HTML), addresses or tokens — the audit metadata rules
 * in `docs/marketing-communications.md` apply to error text too.
 */

import { MarketingRecipientSource } from '@school-bus-tracking/shared-types';

// ------------------------------------------------------------ templates

export const MARKETING_TEMPLATE_NOT_FOUND = 'Marketing template not found';
export const MARKETING_TEMPLATE_SLUG_TAKEN = 'A template with this slug already exists';
export const MARKETING_TEMPLATE_ARCHIVED = 'This template is archived and can no longer be edited';
export const MARKETING_TEMPLATE_ALREADY_ARCHIVED = 'This template is already archived';
export const MARKETING_TEMPLATE_ARCHIVED_MESSAGE = 'Template archived';
export const MARKETING_TEMPLATE_VERSION_NOT_FOUND = 'Template version not found';
export const MARKETING_TEMPLATE_VERSION_PUBLISHED =
  'This version is already published and can no longer be edited';
export const MARKETING_TEMPLATE_VERSION_PUBLISH_MESSAGE = 'Template version published';
export const MARKETING_TEMPLATE_HTML_UNSAFE =
  'The HTML body contains unsafe markup and was rejected';
export const MARKETING_TEMPLATE_VARIABLES_UNKNOWN =
  'The content uses variables that are not declared in allowed_variables';
export const MARKETING_TEMPLATE_NOT_PUBLISHED =
  'The template version must be published before it can be used';
export const MARKETING_TEST_RECIPIENTS_UNSET =
  'No test recipients are configured (MARKETING_TEST_RECIPIENTS is empty)';
export const MARKETING_TEMPLATE_TEST_SENT = 'Test email sent to the configured test recipients';
export const MARKETING_TEMPLATE_TEST_PARTIALLY_SENT =
  'The email provider rejected the test send for some recipients';

// ------------------------------------------------------------- campaigns

export const MARKETING_CAMPAIGN_NOT_FOUND = 'Campaign not found';
export const MARKETING_CAMPAIGN_TEMPLATE_ARCHIVED =
  'The template this campaign references is archived; new campaigns cannot use it';
export const MARKETING_CAMPAIGN_ONLY_DRAFT_EDITABLE =
  'Only draft campaigns can be edited; the audience of a scheduled campaign is frozen';
export const MARKETING_CAMPAIGN_SCHEDULED_MESSAGE = 'Campaign scheduled';
export const MARKETING_CAMPAIGN_ALREADY_SCHEDULED_MESSAGE =
  'Campaign was already scheduled — the existing audience snapshot was kept';
export const MARKETING_CAMPAIGN_PAUSED_MESSAGE = 'Campaign paused';
export const MARKETING_CAMPAIGN_RESUMED_MESSAGE = 'Campaign resumed';
export const MARKETING_CAMPAIGN_CANCELLED_MESSAGE = 'Campaign cancelled';
export const MARKETING_CAMPAIGN_TRANSITION_INVALID =
  'This campaign status does not allow that action';
export const MARKETING_CAMPAIGN_EMPTY_AUDIENCE =
  'The audience filter resolved to zero recipients; refusing to schedule an empty campaign';

// ------------------------------------------------------- delivery worker

/** Rejected before a single message leaves (see `marketing-message.builder`). */
export const MARKETING_RENDER_UNKNOWN_VARIABLE =
  'The template version uses variables the delivery worker cannot fill';

/** Advisory-lock class id of the marketing sweep (distinct from the outbox's). */
export const MARKETING_DELIVERY_LOCK_CLASS = 714_290_002;

/** Advisory-lock key of the global claim sweep. */
export const MARKETING_DELIVERY_LOCK_KEY = 1;

/**
 * Advisory-lock class of the durable lead-notification sweep.
 *
 * A **different** class from campaign delivery on purpose: operational mail
 * to `MARKETING_ADMIN_EMAILS` must never wait behind a 5,000-recipient
 * campaign claim, and the two queues are independent failure domains.
 */
export const MARKETING_NOTIFICATION_LOCK_CLASS = 714_290_003;

/** Advisory-lock key of the notification claim sweep. */
export const MARKETING_NOTIFICATION_LOCK_KEY = 1;

// ------------------------------------------------------- provider events

/** The single, safe answer every rejected provider webhook call receives. */
export const MARKETING_PROVIDER_EVENT_REJECTED = 'This request could not be verified';

/** Returned when no `MARKETING_PROVIDER_WEBHOOK_SECRET` is configured. */
export const MARKETING_PROVIDER_EVENTS_DISABLED =
  'Provider event ingestion is not enabled for this deployment';

/** Hard ceiling on a webhook body (bytes). Bigger payloads are rejected. */
export const MARKETING_PROVIDER_EVENT_MAX_BODY_BYTES = 64 * 1024;

/** How far a signed timestamp may drift from server time (milliseconds). */
export const MARKETING_PROVIDER_EVENT_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

// --------------------------------------------------------- suppressions

export const MARKETING_SUPPRESSION_NOT_FOUND = 'Suppression not found';
export const MARKETING_SUPPRESSION_CONFIRM_REQUIRED =
  'Please confirm the removal before this suppression can be deleted';
export const MARKETING_SUPPRESSION_UNSUBSCRIBE_PROTECTED =
  'This address unsubscribed. Removing an opt-out requires the explicit unsubscribe acknowledgement.';
export const MARKETING_SUPPRESSION_INVALID_EMAIL = 'Please enter a valid email address';
export const MARKETING_SUPPRESSION_ADDED = 'Address suppressed';
export const MARKETING_SUPPRESSION_REMOVED = 'Suppression removed';

// ------------------------------------------------------------- erasure

export const MARKETING_LEAD_ERASE_CONFIRM_REQUIRED =
  'Please confirm the erasure before the lead can be anonymized';
export const MARKETING_LEAD_ERASED_MESSAGE =
  'Lead contact details were erased; the consent record and pipeline history remain';

// -------------------------------------------------------- public tracking

/**
 * The single answer every invalid/expired/cancelled token gets.
 *
 * Deliberately identical for "no such token", "campaign cancelled" and
 * "malformed": a public endpoint that distinguished them would let anyone
 * probe which tokens exist.
 */
export const MARKETING_TRACKING_TOKEN_INVALID = 'This link is no longer valid';

export const MARKETING_UNSUBSCRIBED_MESSAGE =
  'You have been unsubscribed from Zero Mile Systems marketing email. Account and service notifications are unaffected.';

export const MARKETING_ALREADY_UNSUBSCRIBED_MESSAGE =
  'This address was already unsubscribed from Zero Mile Systems marketing email.';

// ------------------------------------------------------------------- leads

/**
 * The one answer every public demo-request submission gets — stored lead,
 * deduplicated replay and honeypot hit alike. Anything more specific would
 * let a caller probe which addresses already have a lead.
 */
export const MARKETING_DEMO_REQUEST_RECEIVED_MESSAGE =
  'Thank you! Your demo request has been received. Our team will reach out to you shortly.';

export const MARKETING_LEAD_NOT_FOUND = 'Lead not found';

export const MARKETING_LEAD_TRANSITION_INVALID =
  'This lead status does not allow that transition';

/**
 * Idempotency window of the public form: an *identical* submission (same
 * normalized content fingerprint) inside this window is answered with the
 * generic response without creating a second lead or a second notification.
 * A submission with different content is a new lead by design.
 */
export const MARKETING_LEAD_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Bounds for the metrics aggregation (top campaigns / recent leads). */
export const MARKETING_LEAD_METRICS_TOP_CAMPAIGNS = 10;
export const MARKETING_LEAD_METRICS_RECENT_LEADS = 8;

// ---------------------------------------------------------------- audience

/** How many masked recipients the preview sample returns. */
export const MARKETING_AUDIENCE_SAMPLE_SIZE = 5;

/** Conservative address shape check (mirrors `marketing.config.ts`). */
export const MARKETING_EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * The default `recipient_sources` of an audience filter: the school's primary
 * contact address only. `SCHOOL_ADMIN` must be requested explicitly.
 */
export const MARKETING_DEFAULT_RECIPIENT_SOURCES: readonly MarketingRecipientSource[] = [
  MarketingRecipientSource.SCHOOL_EMAIL,
];
