'use client';

import React from 'react';
import type {
  DocumentComplianceResponse,
  DocumentComplianceSummary,
  DocumentRequirementStatus,
} from '@school-bus-tracking/shared-types';
import { Badge, Card } from '../../components/ui';
import {
  complianceStateLabel,
  complianceStateTone,
  complianceSummaryLine,
  describeExpiry,
  sortRequirements,
} from './helpers';

/**
 * Requirement / expiry report for one bus or one driver (Task 44).
 *
 * It renders exactly what the API derived: for every required document type,
 * whether it is **missing**, **valid**, **expiring soon** or **expired**, taken
 * from the real dates on file. There is no control here that can change a
 * verdict — the only way to fix a finding is to file or renew the document.
 */
export const CompliancePanel: React.FC<{
  compliance: DocumentComplianceResponse | null;
  loading?: boolean;
}> = ({ compliance, loading }) => {
  if (loading && !compliance) {
    return (
      <Card title="Compliance">
        <p className="muted">Checking required documents…</p>
      </Card>
    );
  }
  if (!compliance) {
    return null;
  }

  return (
    <Card
      title="Required documents"
      description={`${compliance.owner_type === 'BUS' ? 'Vehicle' : 'Crew'} compliance — ${complianceSummaryLine(
        compliance.summary,
      )}.`}
    >
      <div className="row" style={{ marginBottom: '0.85rem' }}>
        <Badge tone={compliance.summary.is_compliant ? 'success' : 'danger'}>
          {compliance.summary.is_compliant ? 'Compliant' : 'Action required'}
        </Badge>
        <Badge tone="neutral">{`${compliance.summary.required_total} required`}</Badge>
        {compliance.summary.missing > 0 ? (
          <Badge tone="neutral">{`${compliance.summary.missing} missing`}</Badge>
        ) : null}
        {compliance.summary.expired > 0 ? (
          <Badge tone="danger">{`${compliance.summary.expired} expired`}</Badge>
        ) : null}
        {compliance.summary.expiring_soon > 0 ? (
          <Badge tone="warning">{`${compliance.summary.expiring_soon} expiring soon`}</Badge>
        ) : null}
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Document</th>
              <th>Requirement</th>
              <th>Status</th>
              <th>Expiry</th>
            </tr>
          </thead>
          <tbody>
            {sortRequirements(compliance.requirements).map((requirement) => (
              <tr key={requirement.document_type}>
                <td>{requirement.document_type_label}</td>
                <td>{requirement.is_required ? 'Required' : 'Optional'}</td>
                <td>
                  <Badge tone={complianceStateTone(requirement.state)}>
                    {complianceStateLabel(requirement.state)}
                  </Badge>
                </td>
                <td>
                  {requirement.state === 'MISSING'
                    ? '—'
                    : describeExpiry(requirement.expiry_date, requirement.days_remaining)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

/** Compact counters used on the school-wide overview page. */
export const ComplianceSummaryBadges: React.FC<{ summary: DocumentComplianceSummary }> = ({
  summary,
}) => (
  <div className="row">
    <Badge tone={summary.is_compliant ? 'success' : 'danger'}>
      {summary.is_compliant ? 'Compliant' : 'Action required'}
    </Badge>
    {summary.missing > 0 ? <Badge tone="neutral">{`${summary.missing} missing`}</Badge> : null}
    {summary.expired > 0 ? <Badge tone="danger">{`${summary.expired} expired`}</Badge> : null}
    {summary.expiring_soon > 0 ? (
      <Badge tone="warning">{`${summary.expiring_soon} expiring soon`}</Badge>
    ) : null}
  </div>
);

/** One findings row ("Insurance — expired 3 days ago"). */
export const IssueLine: React.FC<{ issue: DocumentRequirementStatus }> = ({ issue }) => (
  <span>
    <strong>{issue.document_type_label}</strong>{' '}
    {issue.state === 'MISSING'
      ? '— not on file'
      : `— ${describeExpiry(issue.expiry_date, issue.days_remaining)}`}
    {issue.is_required ? '' : ' (optional)'}
  </span>
);
