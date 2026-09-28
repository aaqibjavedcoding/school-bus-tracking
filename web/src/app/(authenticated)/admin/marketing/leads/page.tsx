'use client';

import Link from 'next/link';
import React, { useCallback, useEffect, useState } from 'react';
import {
  MarketingLeadSource,
  MarketingLeadStatus,
  type MarketingLeadMetricsResponse,
  type MarketingLeadSummary,
} from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Skeleton,
} from '../../../../../components/ui';
import { usePagedResource } from '../../../../../hooks/usePagedResource';
import { formatDateTime } from '../../../../../lib/format';
import { unwrapEnvelope } from '../../../../../lib/errors';
import { apiClient } from '../../../../../services/api';
import {
  marketingLeadSourceLabel,
  marketingLeadStatusLabel,
  marketingLeadStatusTone,
} from '../../../../../features/marketing/helpers';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...Object.values(MarketingLeadStatus).map((status) => ({
    value: status,
    label: marketingLeadStatusLabel(status),
  })),
];

const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: MarketingLeadSource.LANDING_PAGE, label: 'Landing page' },
  { value: MarketingLeadSource.CAMPAIGN_REPLY, label: 'Campaign reply' },
  { value: MarketingLeadSource.MANUAL, label: 'Manual entry' },
];

/**
 * Demo leads — the pipeline captured by the public "Request a Demo" form.
 *
 * List views deliberately minimize what they show: name, email, institution,
 * status and source. Phone numbers, the free-text message and the consent
 * record live only on the detail page — 20 leads on a screen should not be
 * 20 phone numbers.
 */
export default function AdminMarketingLeadsPage() {
  const [status, setStatus] = useState<'' | MarketingLeadStatus>('');
  const [source, setSource] = useState<'' | MarketingLeadSource>('');
  const [campaignId, setCampaignId] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [metrics, setMetrics] = useState<MarketingLeadMetricsResponse | null>(null);

  const { items, meta, setPage, search, setSearch, loading, searching, error, reload } =
    usePagedResource<MarketingLeadSummary>(
      async (currentPage, currentSearch) => {
        const envelope = await apiClient.listMarketingLeads({
          page: currentPage,
          limit: 20,
          search: currentSearch || undefined,
          status: status || undefined,
          source: source || undefined,
          campaign_id: campaignId || undefined,
          created_from: createdFrom || undefined,
          created_to: createdTo || undefined,
        });
        return unwrapEnvelope(envelope);
      },
      [status, source, campaignId, createdFrom, createdTo],
    );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = unwrapEnvelope(await apiClient.getMarketingLeadMetrics());
        if (!cancelled) {
          setMetrics(data);
        }
      } catch {
        // Metrics are decorative here; the list is the deliverable. A
        // metrics hiccup must not block lead handling.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasFilters = Boolean(search || status || source || campaignId || createdFrom || createdTo);

  const clearFilters = useCallback(() => {
    setSearch('');
    setStatus('');
    setSource('');
    setCampaignId('');
    setCreatedFrom('');
    setCreatedTo('');
    setPage(1);
  }, [setPage, setSearch]);

  return (
    <div className="page">
      <PageHeader
        title="Demo leads"
        description="Demo requests from the public landing page and campaign attribution. Contact details are volunteered for a sales conversation — handle them accordingly."
      />

      {metrics ? (
        <section aria-label="Marketing lead metrics" className="stat-grid">
          <div className="stat">
            <span className="stat-label">New (7 days)</span>
            <span className="stat-value">{metrics.new_leads_last_7_days}</span>
            <span className="stat-hint muted">
              {metrics.new_leads_last_30_days} in the last 30 days
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Total leads</span>
            <span className="stat-value">{metrics.total_leads}</span>
            <span className="stat-hint muted">
              {metrics.leads_by_status.CONVERTED} converted · {metrics.leads_by_status.LOST} lost
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Unique clicks</span>
            <span className="stat-value">{metrics.unique_clicks}</span>
            <span className="stat-hint muted">{metrics.total_clicks} total campaign clicks</span>
          </div>
          <div className="stat">
            <span className="stat-label">Click-to-lead</span>
            <span className="stat-value">
              {metrics.click_to_lead_rate === null ? '—' : `${metrics.click_to_lead_rate}%`}
            </span>
            <span className="stat-hint muted">Attribution is best-effort, not identity</span>
          </div>
          <div className="stat">
            <span className="stat-label">Unsubscribed</span>
            <span className="stat-value">{metrics.unsubscribed_total}</span>
            <span className="stat-hint muted">Suppressed from marketing email</span>
          </div>
        </section>
      ) : null}

      <div className="toolbar" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          searching={searching}
          placeholder="Search name, email or institution…"
        />
        <Select
          aria-label="Filter by lead status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as '' | MarketingLeadStatus);
            setPage(1);
          }}
          options={STATUS_OPTIONS}
          style={{ maxWidth: 190 }}
        />
        <Select
          aria-label="Filter by lead source"
          value={source}
          onChange={(event) => {
            setSource(event.target.value as '' | MarketingLeadSource);
            setPage(1);
          }}
          options={SOURCE_OPTIONS}
          style={{ maxWidth: 190 }}
        />
        <Input
          aria-label="Created from"
          type="date"
          value={createdFrom}
          onChange={(event) => {
            setCreatedFrom(event.target.value);
            setPage(1);
          }}
          style={{ maxWidth: 170 }}
        />
        <Input
          aria-label="Created to"
          type="date"
          value={createdTo}
          onChange={(event) => {
            setCreatedTo(event.target.value);
            setPage(1);
          }}
          style={{ maxWidth: 170 }}
        />
        {hasFilters ? (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {metrics && metrics.leads_by_campaign.length > 0 ? (
        <div className="toolbar" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.4rem' }}>
          <span className="muted">Top campaigns:</span>
          {metrics.leads_by_campaign.map((bucket) => (
            <Button
              key={bucket.campaign_id}
              variant={campaignId === bucket.campaign_id ? 'secondary' : 'ghost'}
              onClick={() => {
                setCampaignId((current) =>
                  current === bucket.campaign_id ? '' : bucket.campaign_id,
                );
                setPage(1);
              }}
            >
              {bucket.campaign_name ?? 'Untitled campaign'} ({bucket.leads})
            </Button>
          ))}
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <Skeleton lines={8} />
      ) : error ? (
        <ErrorState title="Unable to load leads" message={error} onRetry={() => void reload()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No leads yet"
          description={
            hasFilters
              ? 'No lead matches the current search and filters.'
              : 'Demo requests from the public landing page form will appear here.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="result-count" style={{ marginBottom: '0.5rem' }}>
            {meta.total} lead{meta.total === 1 ? '' : 's'}
          </p>
          <Card>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Work email</th>
                    <th scope="col">Institution</th>
                    <th scope="col">Status</th>
                    <th scope="col">Source</th>
                    <th scope="col">Received</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((lead) => (
                    <tr key={lead.id}>
                      <td>{lead.full_name}</td>
                      <td>{lead.email}</td>
                      <td>{lead.institution_name ?? '—'}</td>
                      <td>
                        <Badge tone={marketingLeadStatusTone(lead.status)}>
                          {marketingLeadStatusLabel(lead.status)}
                        </Badge>
                      </td>
                      <td>
                        {marketingLeadSourceLabel(lead.source)}
                        {lead.campaign_id ? ' · campaign' : ''}
                      </td>
                      <td>{formatDateTime(lead.created_at)}</td>
                      <td>
                        <Link href={`/admin/marketing/leads/${lead.id}`}>
                          <Button variant="ghost">Open</Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Pagination
            page={meta.page}
            totalPages={meta.totalPages}
            hasNextPage={meta.hasNextPage}
            hasPreviousPage={meta.hasPreviousPage}
            onPage={(next) => setPage(next)}
          />
        </>
      )}
    </div>
  );
}
