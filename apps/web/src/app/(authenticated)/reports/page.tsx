'use client';

import Link from 'next/link';
import React from 'react';
import type {
  ReportCategory,
  ReportDescriptor,
  ReportSummaryCard,
} from '@school-bus-tracking/shared-types';
import { Card, ErrorState, PageHeader, Skeleton } from '../../../components/ui';
import { useLoad } from '../../../hooks/useLoad';
import { unwrapEnvelope } from '../../../lib/errors';
import { apiClient } from '../../../services/api';

/**
 * Reports landing page.
 *
 * Two things, deliberately: the numbers a head teacher wants without clicking
 * anything, and a directory of the reports that answer the follow-up questions.
 * Every figure comes from a live query — there is no cached or seeded data
 * anywhere in this feature.
 */

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  students: 'Students',
  transport: 'Transport',
  trips: 'Trips & communication',
  attendance: 'Attendance',
  compliance: 'Compliance',
};

const CATEGORY_ORDER: ReportCategory[] = [
  'students',
  'transport',
  'trips',
  'attendance',
  'compliance',
];

export default function ReportsPage() {
  const overview = useLoad(async () => unwrapEnvelope(await apiClient.getReportOverview()), []);
  const catalogue = useLoad(async () => unwrapEnvelope(await apiClient.listReports()).items, []);

  const grouped = (catalogue.data ?? []).reduce<Record<string, ReportDescriptor[]>>(
    (accumulator, report) => {
      const list = accumulator[report.category] ?? [];
      list.push(report);
      accumulator[report.category] = list;
      return accumulator;
    },
    {},
  );

  return (
    <div className="page">
      <PageHeader
        title="Reports"
        description="Live figures from your school's data. Every report can be filtered and downloaded as a spreadsheet."
      />

      {overview.loading ? (
        <Skeleton lines={6} />
      ) : overview.error ? (
        <ErrorState message={overview.error} onRetry={() => void overview.reload()} />
      ) : overview.data ? (
        <>
          <SummarySection title="Students" cards={overview.data.students} />
          <SummarySection title="Transport" cards={overview.data.transport} />
          <SummarySection title="Operations (last 30 days)" cards={overview.data.operations} />
          <SummarySection title="Compliance" cards={overview.data.compliance} />
          <p className="muted small">
            Generated {new Date(overview.data.generated_at).toLocaleString()}
          </p>
        </>
      ) : null}

      {catalogue.loading ? (
        <Skeleton lines={8} />
      ) : catalogue.error ? (
        <ErrorState message={catalogue.error} onRetry={() => void catalogue.reload()} />
      ) : (
        CATEGORY_ORDER.filter((category) => (grouped[category] ?? []).length > 0).map(
          (category) => (
            <Card key={category} title={CATEGORY_LABELS[category]}>
              <div className="report-grid">
                {(grouped[category] ?? []).map((report) => (
                  <Link
                    key={report.report}
                    className="report-choice"
                    href={`/reports/${report.report}`}
                  >
                    <strong>{report.label}</strong>
                    <span className="muted">{report.description}</span>
                  </Link>
                ))}
              </div>
            </Card>
          ),
        )
      )}
    </div>
  );
}

const SummarySection: React.FC<{ title: string; cards: ReportSummaryCard[] }> = ({
  title,
  cards,
}) => (
  <Card title={title}>
    <div className="stat-grid">
      {cards.map((card) => (
        <div key={card.key} className="stat">
          <span className="stat-value">{card.value.toLocaleString()}</span>
          <span className="stat-label">{card.label}</span>
          {card.hint ? <span className="stat-hint muted small">{card.hint}</span> : null}
        </div>
      ))}
    </div>
  </Card>
);
