import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  DocumentStatus,
  type DocumentComplianceSummary,
  type DocumentRequirementStatus,
} from '@school-bus-tracking/shared-types';
import {
  complianceStateLabel,
  complianceStateTone,
  complianceSummaryLine,
  describeExpiry,
  documentOwnerPath,
  documentStatusLabel,
  documentStatusTone,
  formatDaysRemaining,
  needsAttention,
  ownerTypeLabel,
  sortRequirements,
} from './helpers.ts';

/**
 * Presentation rules of the compliance-document screens (Task 44).
 *
 * Nothing here computes validity — that is the backend's job, from real
 * dates. These helpers only decide how an already-derived state is shown.
 */

describe('document status presentation', () => {
  it('maps each derived validity to its badge tone', () => {
    assert.equal(documentStatusTone(DocumentStatus.VALID), 'success');
    assert.equal(documentStatusTone(DocumentStatus.EXPIRING_SOON), 'warning');
    assert.equal(documentStatusTone(DocumentStatus.EXPIRED), 'danger');
  });

  it('uses the shared catalogue labels', () => {
    assert.equal(documentStatusLabel(DocumentStatus.VALID), 'Valid');
    assert.equal(documentStatusLabel(DocumentStatus.EXPIRING_SOON), 'Expiring soon');
    assert.equal(documentStatusLabel(DocumentStatus.EXPIRED), 'Expired');
  });
});

describe('compliance state presentation', () => {
  it('renders MISSING neutrally and EXPIRED dangerously', () => {
    assert.equal(complianceStateTone('MISSING'), 'neutral');
    assert.equal(complianceStateTone('EXPIRED'), 'danger');
    assert.equal(complianceStateLabel('MISSING'), 'Missing');
  });
});

describe('formatDaysRemaining', () => {
  it('describes future, present and past horizons', () => {
    assert.equal(formatDaysRemaining(12), 'in 12 days');
    assert.equal(formatDaysRemaining(1), 'in 1 day');
    assert.equal(formatDaysRemaining(0), 'today');
    assert.equal(formatDaysRemaining(-1), '1 day ago');
    assert.equal(formatDaysRemaining(-30), '30 days ago');
  });

  it('returns nothing when there is no expiry to count', () => {
    assert.equal(formatDaysRemaining(null), null);
  });
});

describe('describeExpiry', () => {
  it('says so plainly when a document never expires', () => {
    assert.equal(describeExpiry(null, null), 'No expiry date');
  });

  it('combines the relative horizon with the real date', () => {
    assert.equal(describeExpiry('2026-09-12', 12), 'Expires in 12 days (2026-09-12)');
    assert.equal(describeExpiry('2026-08-31', 0), 'Expires today (2026-08-31)');
  });
});

describe('complianceSummaryLine', () => {
  it('lists only the non-zero counters', () => {
    const summary: DocumentComplianceSummary = {
      required_total: 6,
      valid: 4,
      expiring_soon: 1,
      expired: 0,
      missing: 1,
      is_compliant: false,
    };
    assert.equal(complianceSummaryLine(summary), '4 valid · 1 expiring soon · 1 missing');
  });

  it('has a sensible empty state', () => {
    const summary: DocumentComplianceSummary = {
      required_total: 0,
      valid: 0,
      expiring_soon: 0,
      expired: 0,
      missing: 0,
      is_compliant: true,
    };
    assert.equal(complianceSummaryLine(summary), 'No required documents');
  });
});

describe('needsAttention', () => {
  it('treats an expiring document as attention-worthy even when compliant', () => {
    const expiring: DocumentComplianceSummary = {
      required_total: 1,
      valid: 1,
      expiring_soon: 1,
      expired: 0,
      missing: 0,
      is_compliant: true,
    };
    assert.equal(needsAttention(expiring), true);
  });

  it('leaves a fully valid resource alone', () => {
    const clean: DocumentComplianceSummary = {
      required_total: 1,
      valid: 1,
      expiring_soon: 0,
      expired: 0,
      missing: 0,
      is_compliant: true,
    };
    assert.equal(needsAttention(clean), false);
  });
});

describe('sortRequirements', () => {
  const requirement = (
    type: string,
    state: DocumentRequirementStatus['state'],
    isRequired = true,
  ): DocumentRequirementStatus => ({
    owner_type: 'BUS',
    document_type: type,
    document_type_label: type,
    is_required: isRequired,
    state,
    document_id: null,
    expiry_date: null,
    days_remaining: null,
  });

  it('puts the findings an operator must fix first', () => {
    const sorted = sortRequirements([
      requirement('INSURANCE', 'VALID'),
      requirement('PERMIT', 'EXPIRING_SOON'),
      requirement('FITNESS_CERTIFICATE', 'EXPIRED'),
      requirement('PUC', 'MISSING'),
    ]);
    assert.deepEqual(
      sorted.map((item) => item.state),
      ['EXPIRED', 'MISSING', 'EXPIRING_SOON', 'VALID'],
    );
  });

  it('ranks required entries above optional ones of the same state', () => {
    const sorted = sortRequirements([
      requirement('MEDICAL_CERTIFICATE', 'VALID', false),
      requirement('DRIVING_LICENSE', 'VALID', true),
    ]);
    assert.equal(sorted[0].document_type, 'DRIVING_LICENSE');
  });

  it('does not mutate the input', () => {
    const input = [requirement('INSURANCE', 'VALID'), requirement('PUC', 'EXPIRED')];
    sortRequirements(input);
    assert.equal(input[0].document_type, 'INSURANCE');
  });
});

describe('documentOwnerPath', () => {
  it('routes to the bus and driver document screens', () => {
    assert.equal(documentOwnerPath('BUS', 'bus-1'), '/buses/bus-1/documents');
    assert.equal(documentOwnerPath('DRIVER', 'driver-1'), '/drivers/driver-1/documents');
    assert.equal(ownerTypeLabel('BUS'), 'Bus');
    assert.equal(ownerTypeLabel('DRIVER'), 'Crew');
  });
});
