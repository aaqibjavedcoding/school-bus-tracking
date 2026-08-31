/**
 * Mobile compliance-document feature barrel (Task 44).
 *
 * The presentation helpers live next to their web counterparts in
 * `apps/web/src/features/documents/helpers.ts` conceptually, but each app
 * carries its own copy so no React Native screen ever imports from the web
 * app. The two files are kept intentionally identical in behaviour: **validity
 * is always derived by the API from real dates, never entered or edited**.
 */

export {
  complianceStateLabel,
  complianceStateTone,
  complianceSummaryLine,
  describeExpiry,
  documentStatusLabel,
  documentStatusTone,
  formatDaysRemaining,
  needsAttention,
  ownerTypeLabel,
  sortRequirements,
} from './helpers';
export { DOCUMENT_OWNER_PATHS, documentOwnerRoute } from './helpers';
export { ComplianceSummaryCard } from './ComplianceSummaryCard';
export { DocumentFormSheet } from './DocumentFormSheet';
export { EMPTY_DOCUMENT_FORM, buildDocumentRequest, toFormValues } from './documentForm';
export type { DocumentFormValues, DocumentRequest, DocumentRequestResult } from './documentForm';
export { DocumentOwnerScreen } from './DocumentOwnerScreen';
export type { DocumentOwnerScreenProps } from './DocumentOwnerScreen';
