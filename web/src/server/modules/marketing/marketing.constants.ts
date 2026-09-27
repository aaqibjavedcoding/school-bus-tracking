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
