import {
  DOCUMENT_STATUS_LABELS,
  DocumentStatus,
  type DocumentComplianceState,
  type DocumentComplianceSummary,
  type DocumentOwnerType,
  type DocumentRequirementStatus,
} from '@school-bus-tracking/shared-types';
import type { Tone } from '../../../lib/format';

/**
 * Pure presentation helpers for the mobile compliance screens (Task 44).
 *
 * The web console carries an equivalent file
 * (`apps/web/src/features/documents/helpers.ts`) — each app keeps its own copy
 * because there is no shared React package, and both are covered by the same
 * test cases so they cannot drift.
 *
 * Everything here is *derived* from data the API computed from real dates.
 * There is no "mark as valid" control anywhere in the product: the only input
 * that changes a document's status is the real expiry date.
 */

/** Badge tone of a derived document validity. */
export function documentStatusTone(status: DocumentStatus): Tone {
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
export function complianceStateTone(state: DocumentComplianceState): Tone {
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
 * `null` expiry means the document never expires — the UI says so instead of
 * printing an empty dash, because an undated document is valid indefinitely
 * and claiming otherwise would be a fabricated status.
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

/** Requirement states an operator must act on, worst first. */
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

export function ownerTypeLabel(ownerType: DocumentOwnerType): string {
  return ownerType === 'BUS' ? 'Bus' : 'Driver';
}

/** Expo Router segment of one owner's document screen. */
export const DOCUMENT_OWNER_PATHS: Record<DocumentOwnerType, string> = {
  BUS: '/manage/documents/bus',
  DRIVER: '/manage/documents/driver',
};

/** Mobile route of the document screen for one owner. */
export function documentOwnerRoute(ownerType: DocumentOwnerType, ownerId: string): string {
  return `${DOCUMENT_OWNER_PATHS[ownerType]}/${ownerId}`;
}
