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
