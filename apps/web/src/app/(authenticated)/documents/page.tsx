'use client';

import Link from 'next/link';
import React, { useCallback, useState } from 'react';
import {
  DOCUMENT_OWNER_TYPE_VALUES,
  type DocumentComplianceSummary,
  type DocumentOverviewItem,
  type DocumentOwnerType,
  type DocumentRequirement,
} from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  CheckboxRow,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
  SearchInput,
  Skeleton,
  useToast,
} from '../../../components/ui';
import {
  ComplianceSummaryBadges,
  IssueLine,
} from '../../../features/documents/CompliancePanel';
import {
  complianceSummaryLine,
  documentOwnerPath,
  needsAttention,
  ownerTypeLabel,
} from '../../../features/documents/helpers';
import { useLoad } from '../../../hooks/useLoad';
import { getApiErrorMessage, unwrapEnvelope } from '../../../lib/errors';
import { apiClient } from '../../../services/api';

/**
 * School-wide document compliance (Task 44).
 *
 * The screen an operator opens in the morning: every bus and every driver with
 * the requirement entries that need attention, plus the required/optional
 * configuration of the two catalogues. It is read-only with respect to
 * documents themselves (those live on the bus and driver screens) — here the
 * school decides **which** documents it enforces.
 */
export default function DocumentsPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [ownerType, setOwnerType] = useState<DocumentOwnerType | ''>('');
  const [compliance, setCompliance] = useState<'' | 'compliant' | 'attention'>('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  // Debounced so typing does not fire a request per keystroke.
  const [activeSearch, setActiveSearch] = useState('');

  const load = useCallback(async () => {
    const query: Parameters<typeof apiClient.getDocumentOverview>[0] = {
      page,
      limit: 20,
    };
    if (ownerType) query.owner_type = ownerType;
    if (compliance) query.compliance = compliance;
    if (activeSearch) query.search = activeSearch;
    const [overview, busRequirements, driverRequirements] = await Promise.all([
      apiClient.getDocumentOverview(query),
      apiClient.getDocumentRequirements({ owner_type: 'BUS' }),
      apiClient.getDocumentRequirements({ owner_type: 'DRIVER' }),
    ]);
    return {
      overview: unwrapEnvelope(overview),
      busRequirements: unwrapEnvelope(busRequirements),
      driverRequirements: unwrapEnvelope(driverRequirements),
    };
  }, [page, ownerType, compliance, activeSearch]);

  const { data, loading, error, reload } = useLoad(load, [load]);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setActiveSearch(search.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const toggleRequirement = (requirement: DocumentRequirement, isRequired: boolean) => {
    setBusy(true);
    void (async () => {
      try {
        unwrapEnvelope(
          await apiClient.updateDocumentRequirements({
            owner_type: requirement.owner_type,
            items: [{ document_type: requirement.document_type, is_required: isRequired }],
          }),
        );
        toast.push(
          `${requirement.document_type_label} is now ${isRequired ? 'required' : 'optional'}.`,
          'success',
        );
        await reload();
      } catch (caught) {
        toast.push(getApiErrorMessage(caught), 'danger');
      } finally {
        setBusy(false);
      }
    })();
  };

  if (loading && !data) {
    return (
      <div className="page">
        <Skeleton lines={12} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <ErrorState
          message={error || 'Could not load document compliance'}
          onRetry={() => void reload()}
        />
      </div>
    );
  }

  const overview = data.overview;
  const summary = overview.summary as DocumentComplianceSummary;

  return (
    <div className="page">
      <PageHeader
        title="Documents"
        description="Fleet and crew compliance in one place — missing, expiring and expired documents across every bus and driver."
      />

      <Card
        title="School summary"
        description="Totals across every bus and driver of the school."
      >
        <ComplianceSummaryBadges summary={summary} />
        <p className="muted" style={{ marginTop: '0.6rem' }}>
          {complianceSummaryLine(summary)} across {overview.meta.total} bus
          {overview.meta.total === 1 ? '' : 'es'} and drivers.
        </p>
      </Card>

      <Card title="Compliance by vehicle and crew">
        <div className="row" style={{ marginBottom: '0.85rem' }}>
          <Field id="document-search" label="Search">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Bus number or driver name…"
              searching={loading && activeSearch !== search.trim()}
            />
          </Field>
          <Field id="owner-filter" label="Resource">
            <select
              id="owner-filter"
              className="select"
              value={ownerType}
              onChange={(event) => {
                setPage(1);
                setOwnerType(event.target.value as DocumentOwnerType | '');
              }}
            >
              <option value="">Buses and drivers</option>
              {DOCUMENT_OWNER_TYPE_VALUES.map((value) => (
                <option key={value} value={value}>
                  {ownerTypeLabel(value)}s
                </option>
              ))}
            </select>
          </Field>
          <Field id="compliance-filter" label="State">
            <select
              id="compliance-filter"
              className="select"
              value={compliance}
              onChange={(event) => {
                setPage(1);
                setCompliance(event.target.value as '' | 'compliant' | 'attention');
              }}
            >
              <option value="">All</option>
              <option value="attention">Needs attention</option>
              <option value="compliant">Fully compliant</option>
            </select>
          </Field>
        </div>

        {overview.items.length === 0 ? (
          <EmptyState
            title="Nothing to show"
            description="No bus or driver matches the current filters."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Findings</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {overview.items.map((item: DocumentOverviewItem) => (
                  <tr key={`${item.owner_type}:${item.owner_id}`}>
                    <td>
                      <strong>{item.owner_label}</strong>
                    </td>
                    <td>{ownerTypeLabel(item.owner_type)}</td>
                    <td>
                      <Badge
                        tone={
                          item.summary.is_compliant
                            ? item.summary.expiring_soon > 0
                              ? 'warning'
                              : 'success'
                            : 'danger'
                        }
                      >
                        {needsAttention(item.summary) ? 'Needs attention' : 'Compliant'}
                      </Badge>
                    </td>
                    <td>
                      {item.issues.length === 0 ? (
                        <span className="muted">None</span>
                      ) : (
                        item.issues.map((issue) => (
                          <div key={issue.document_type}>
                            <IssueLine issue={issue} />
                          </div>
                        ))
                      )}
                    </td>
                    <td>
                      <Link href={documentOwnerPath(item.owner_type, item.owner_id)}>
                        <Button variant="ghost">Manage</Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={overview.meta.page}
          totalPages={overview.meta.totalPages}
          hasNextPage={overview.meta.hasNextPage}
          hasPreviousPage={overview.meta.hasPreviousPage}
          onPage={setPage}
        />
      </Card>

      <RequirementCatalogue
        title="Bus document requirements"
        description="Which documents this school enforces for its vehicles, and how early it wants to be warned before an expiry."
        items={data.busRequirements.items}
        busy={busy}
        onToggle={toggleRequirement}
      />

      <RequirementCatalogue
        title="Driver document requirements"
        description="Which documents this school enforces for its drivers. The driving licence is required by default."
        items={data.driverRequirements.items}
        busy={busy}
        onToggle={toggleRequirement}
      />
    </div>
  );
}

/** Required/optional configuration of one catalogue. */
const RequirementCatalogue: React.FC<{
  title: string;
  description: string;
  items: DocumentRequirement[];
  busy: boolean;
  onToggle: (requirement: DocumentRequirement, isRequired: boolean) => void;
}> = ({ title, description, items, busy, onToggle }) => (
  <Card title={title} description={description}>
    {items.map((requirement) => (
      <CheckboxRow
        key={requirement.document_type}
        id={`${requirement.owner_type}-${requirement.document_type}`}
        label={requirement.document_type_label}
        hint={`Warn ${requirement.expiry_warning_days} days before expiry${
          requirement.is_customized ? ' · customized for this school' : ' · default'
        }`}
        checked={requirement.is_required}
        onChange={(checked) => onToggle(requirement, checked)}
      />
    ))}
    {busy ? <p className="muted">Saving…</p> : null}
  </Card>
);
