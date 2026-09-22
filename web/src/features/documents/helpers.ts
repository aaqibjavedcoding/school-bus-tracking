import {
  DOCUMENT_STATUS_LABELS,
  DocumentStatus,
  type DocumentComplianceState,
  type DocumentComplianceSummary,
  type DocumentOwnerType,
  type DocumentRequirementStatus,
} from '@school-bus-tracking/shared-types';

/**
 * Pure presentation helpers for the compliance-document screens.
 *
 * Free of React and of relative imports so the Node test runner
 * (`npm --prefix web test`) can execute them directly — the same
 * convention as `lib/errors.spec.ts` and
 * `features/admin/subscriptions/helpers.ts`.
 *
 * Every label and tone here is *derived* from data the API computed from real
 * dates. Nothing in the UI invents a validity: there is no "mark as valid"
 * control anywhere in the product.
 */

/** Matches the `BadgeTone` union of `components/ui` structurally. */
export type DocumentTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

/** Badge tone of a derived document validity. */
export function documentStatusTone(status: DocumentStatus): DocumentTone {
  switch (status) {
    case DocumentStatus.VALID:
      return 'success';
    case DocumentStatus.EXPIRING_SOON:
      return 'warning';
    case DocumentStatus.EXPIRED:
      return 'danger';
    default:
      return 'neutral';
  }
}

export function documentStatusLabel(status: DocumentStatus): string {
  return DOCUMENT_STATUS_LABELS[status] ?? status;
}

/** Badge tone of a requirement state (including MISSING). */
export function complianceStateTone(state: DocumentComplianceState): DocumentTone {
  switch (state) {
    case 'VALID':
      return 'success';
    case 'EXPIRING_SOON':
      return 'warning';
    case 'EXPIRED':
      return 'danger';
    case 'MISSING':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function complianceStateLabel(state: DocumentComplianceState): string {
  switch (state) {
    case 'MISSING':
      return 'Missing';
    case 'VALID':
      return 'Valid';
    case 'EXPIRING_SOON':
      return 'Expiring soon';
    case 'EXPIRED':
      return 'Expired';
    default:
      return state;
  }
}

/** Human day count: "in 12 days", "today", "3 days ago". */
export function formatDaysRemaining(daysRemaining: number | null): string | null {
  if (daysRemaining === null || !Number.isFinite(daysRemaining)) {
    return null;
  }
  if (daysRemaining === 0) {
    return 'today';
  }
  const magnitude = Math.abs(daysRemaining);
  const unit = magnitude === 1 ? 'day' : 'days';
  return daysRemaining > 0 ? `in ${magnitude} ${unit}` : `${magnitude} ${unit} ago`;
}

/**
 * One-line expiry summary.
 *
 * `null` means the document carries no expiry date at all — it is valid
 * indefinitely and the UI says so instead of showing an empty dash.
 */
export function describeExpiry(expiryDate: string | null, daysRemaining: number | null): string {
  if (!expiryDate) {
    return 'No expiry date';
  }
  const relative = formatDaysRemaining(daysRemaining);
  return relative ? `Expires ${relative} (${expiryDate})` : `Expires ${expiryDate}`;
}

/** "4 valid · 1 expiring soon · 1 missing" — only non-zero parts. */
export function complianceSummaryLine(summary: DocumentComplianceSummary): string {
  const parts: string[] = [];
  if (summary.valid > 0) parts.push(`${summary.valid} valid`);
  if (summary.expiring_soon > 0) parts.push(`${summary.expiring_soon} expiring soon`);
  if (summary.expired > 0) parts.push(`${summary.expired} expired`);
  if (summary.missing > 0) parts.push(`${summary.missing} missing`);
  return parts.length > 0 ? parts.join(' · ') : 'No required documents';
}

/** True when the owner has anything an operator needs to act on. */
export function needsAttention(summary: DocumentComplianceSummary): boolean {
  return !summary.is_compliant || summary.expiring_soon > 0;
}

/** Requirement states that an operator must act on, worst first. */
const ATTENTION_ORDER: Record<DocumentComplianceState, number> = {
  EXPIRED: 0,
  MISSING: 1,
  EXPIRING_SOON: 2,
  VALID: 3,
};

/** Sorts requirement rows: things to fix first, then valid, then optional. */
export function sortRequirements(
  requirements: DocumentRequirementStatus[],
): DocumentRequirementStatus[] {
  return [...requirements].sort((a, b) => {
    const byState = ATTENTION_ORDER[a.state] - ATTENTION_ORDER[b.state];
    if (byState !== 0) return byState;
    if (a.is_required !== b.is_required) return a.is_required ? -1 : 1;
    return a.document_type_label.localeCompare(b.document_type_label);
  });
}

/** Route of the document screen for one owner. */
export function documentOwnerPath(ownerType: DocumentOwnerType, ownerId: string): string {
  return ownerType === 'BUS' ? `/buses/${ownerId}/documents` : `/drivers/${ownerId}/documents`;
}

/**
 * The `DRIVER` owner covers both crew roles — drivers and conductors keep the
 * same paperwork — so the label says so.
 */
export function ownerTypeLabel(ownerType: DocumentOwnerType): string {
  return ownerType === 'BUS' ? 'Bus' : 'Crew';
}

/**
 * The three fields a compliance record is made of: what the paper is, when it
 * was issued, when it stops being valid.
 *
 * The API requires all three on a create and refuses an explicit `null` for any
 * of them on an update — a document without them can never be verified, and it
 * would silently count as valid because there is no expiry to compare against.
 * The shared Zod schema is deliberately permissive about the dates (a bare
 * `null` is a legitimate *clear* on other payloads), so presence is checked
 * here, on the client, before a round trip: this is the list's "blocked" path,
 * and each message names the field it belongs to.
 */
export interface DocumentRequiredFields {
  document_type: string;
  document_number: string;
  issue_date: string;
  expiry_date: string;
}

/** Wording shared with `lib/field-errors.ts`, kept local so this module stays import-free. */
const REQUIRED = (label: string): string => `Please enter the ${label}.`;

/** True for `YYYY-MM-DD` or a full date-time whose date part is a real day. */
function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) return false;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const parsed = new Date(Date.UTC(year as number, (month as number) - 1, day as number));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === (month as number) - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Per-field errors for an incomplete document form — empty required fields and
 * impossible dates, each naming its own input.
 *
 * Returns `{}` when the form is complete enough to send; the API then owns
 * every remaining verdict.
 */
export function documentRequiredFieldErrors(
  form: DocumentRequiredFields,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.document_type) {
    errors.document_type = 'Please choose a document type.';
  }
  if (form.document_number.trim().length === 0) {
    errors.document_number = REQUIRED('document number');
  }
  for (const [field, label] of [
    ['issue_date', 'issue date'],
    ['expiry_date', 'expiry date'],
  ] as const) {
    const value = form[field].trim();
    if (value.length === 0) {
      errors[field] = REQUIRED(label);
    } else if (!isRealDate(value)) {
      errors[field] = `Please enter the ${label} as a real date, for example 2026-04-01.`;
    }
  }
  const issue = form.issue_date.trim();
  const expiry = form.expiry_date.trim();
  if (
    !errors.issue_date &&
    !errors.expiry_date &&
    isRealDate(issue) &&
    isRealDate(expiry) &&
    Date.parse(expiry) <= Date.parse(issue)
  ) {
    errors.expiry_date = 'Please enter an expiry date after the issue date.';
  }
  return errors;
}
