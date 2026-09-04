import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DocumentStatus,
  type DocumentComplianceState,
  type DocumentComplianceSummary,
  type DocumentRequirementStatus,
} from '@school-bus-tracking/shared-types';
import {
  complianceStateLabel,
  complianceStateTone,
  complianceSummaryLine,
  describeExpiry,
  documentOwnerRoute,
  documentStatusLabel,
  documentStatusTone,
  formatDaysRemaining,
  needsAttention,
  ownerTypeLabel,
  sortRequirements,
} from './helpers.ts';

/**
 * Mirrors `apps/web/src/features/documents/helpers.spec.ts` so the two clients
 * cannot drift: the same rules, expressed for the mobile kit.
 */

const summary = (
  overrides: Partial<DocumentComplianceSummary> = {},
): DocumentComplianceSummary => ({
  required_total: 5,
  valid: 5,
  expiring_soon: 0,
  expired: 0,
  missing: 0,
  is_compliant: true,
  ...overrides,
});

const requirement = (
  documentType: string,
  state: DocumentComplianceState,
  isRequired = true,
): DocumentRequirementStatus => ({
  owner_type: 'BUS',
  document_type: documentType,
  document_type_label: documentType.toUpperCase(),
  is_required: isRequired,
  state,
  document_id: state === 'MISSING' ? null : `${documentType}-id`,
  expiry_date: null,
  days_remaining: null,
});

describe('document presentation helpers', () => {
  it('maps every derived status to a tone and a label', () => {
    assert.equal(documentStatusTone(DocumentStatus.VALID), 'success');
    assert.equal(documentStatusTone(DocumentStatus.EXPIRING_SOON), 'warning');
    assert.equal(documentStatusTone(DocumentStatus.EXPIRED), 'danger');
    assert.equal(documentStatusLabel(DocumentStatus.EXPIRED), 'Expired');
  });

  it('treats MISSING as neutral rather than danger', () => {
    assert.equal(complianceStateTone('MISSING'), 'neutral');
    assert.equal(complianceStateTone('EXPIRED'), 'danger');
    assert.equal(complianceStateLabel('MISSING'), 'Missing');
    assert.equal(complianceStateLabel('EXPIRING_SOON'), 'Expiring soon');
  });

  it('formats day counts in both directions and handles today', () => {
    assert.equal(formatDaysRemaining(12), 'in 12 days');
    assert.equal(formatDaysRemaining(1), 'in 1 day');
    assert.equal(formatDaysRemaining(0), 'today');
    assert.equal(formatDaysRemaining(-3), '3 days ago');
    assert.equal(formatDaysRemaining(null), null);
    assert.equal(formatDaysRemaining(Number.NaN), null);
  });

  it('never invents an expiry for an undated document', () => {
    assert.equal(describeExpiry(null, null), 'No expiry date');
    assert.equal(describeExpiry('2026-09-30', 30), 'Expires in 30 days (2026-09-30)');
    assert.equal(describeExpiry('2020-01-01', -240), 'Expires 240 days ago (2020-01-01)');
  });

  it('summarises compliance with non-zero parts only', () => {
    assert.equal(complianceSummaryLine(summary()), '5 valid');
    assert.equal(
      complianceSummaryLine(
        summary({ valid: 3, expiring_soon: 1, missing: 1, is_compliant: false }),
      ),
      '3 valid · 1 expiring soon · 1 missing',
    );
    assert.equal(
      complianceSummaryLine(summary({ valid: 0, required_total: 0 })),
      'No required documents',
    );
  });

  it('flags expiring-soon owners even while they are still compliant', () => {
    assert.equal(needsAttention(summary()), false);
    assert.equal(needsAttention(summary({ valid: 4, expiring_soon: 1 })), true);
    assert.equal(needsAttention(summary({ valid: 4, missing: 1, is_compliant: false })), true);
  });

  it('sorts requirements worst first, then required, then alphabetically', () => {
    const sorted = sortRequirements([
      requirement('insurance', 'VALID', false),
      requirement('permit', 'MISSING'),
      requirement('fitness', 'EXPIRED'),
      requirement('rc', 'EXPIRING_SOON'),
    ]).map((item) => item.document_type);

    assert.deepEqual(sorted, ['fitness', 'permit', 'rc', 'insurance']);
  });

  it('does not mutate the input list while sorting', () => {
    const input = [requirement('rc', 'VALID'), requirement('permit', 'MISSING')];
    const copy = [...input];
    sortRequirements(input);
    assert.deepEqual(input, copy);
  });

  it('routes each owner type to its own document screen', () => {
    assert.equal(ownerTypeLabel('BUS'), 'Bus');
    assert.equal(ownerTypeLabel('DRIVER'), 'Driver');
    assert.equal(documentOwnerRoute('BUS', 'bus-1'), '/manage/documents/bus/bus-1');
    assert.equal(documentOwnerRoute('DRIVER', 'driver-1'), '/manage/documents/driver/driver-1');
  });
});
