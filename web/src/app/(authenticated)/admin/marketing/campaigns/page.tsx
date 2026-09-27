'use client';

import Link from 'next/link';
import React, { useCallback, useState } from 'react';
import {
  MarketingCampaignStatus,
  type MarketingCampaignSummary,
} from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
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
  campaignCompletionPercent,
  campaignProgressSegments,
  marketingCampaignStatusLabel,
  marketingCampaignStatusTone,
} from '../../../../../features/marketing/helpers';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: MarketingCampaignStatus.DRAFT, label: 'Draft' },
  { value: MarketingCampaignStatus.SCHEDULED, label: 'Scheduled' },
  { value: MarketingCampaignStatus.SENDING, label: 'Sending' },
  { value: MarketingCampaignStatus.PAUSED, label: 'Paused' },
  { value: MarketingCampaignStatus.COMPLETED, label: 'Completed' },
  { value: MarketingCampaignStatus.PARTIALLY_FAILED, label: 'Completed with failures' },
  { value: MarketingCampaignStatus.FAILED, label: 'Failed' },
  { value: MarketingCampaignStatus.CANCELLED, label: 'Cancelled' },
];

/**
 * Campaigns — one row per send, with live progress.
 *
 * The bar on each card is the same computation the detail page uses, so a
 * campaign never looks finished here and unfinished there: both read the
 * counters the delivery worker maintains, and both treat "outstanding" the
 * same way.
 */
export default function AdminMarketingCampaignsPage() {
  const [status, setStatus] = useState<'' | MarketingCampaignStatus>('');

  const { items, meta, setPage, search, setSearch, loading, searching, error, reload } =
    usePagedResource<MarketingCampaignSummary>(
      async (currentPage, currentSearch) => {
        const envelope = await apiClient.listMarketingCampaigns({
          page: currentPage,
          limit: 12,
          search: currentSearch || undefined,
          status: status || undefined,
        });
        return unwrapEnvelope(envelope);
      },
      [status],
    );

  const hasFilters = Boolean(search || status);

  const clearFilters = useCallback(() => {
    setSearch('');
    setStatus('');
    setPage(1);
  }, [setPage, setSearch]);

  return (
    <div className="page">
      <PageHeader
        title="Campaigns"
        description="Send a published template to a filtered set of schools. Delivery runs in the background and is paced — scheduling a campaign never sends mail inside the request."
        actions={
          <Link href="/admin/marketing/campaigns/new">
            <Button>Create campaign</Button>
          </Link>
        }
      />

      <div className="toolbar" style={{ marginBottom: '1rem' }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          searching={searching}
          placeholder="Search campaign name…"
        />
        <Select
          aria-label="Filter by campaign status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as '' | MarketingCampaignStatus);
            setPage(1);
          }}
          options={STATUS_OPTIONS}
          style={{ maxWidth: 230 }}
        />
        {hasFilters ? (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {loading && items.length === 0 ? (
        <Skeleton lines={8} />
      ) : error ? (
        <ErrorState
          title="Unable to load campaigns"
          message={error}
          onRetry={() => void reload()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description={
            hasFilters
              ? 'No campaign matches the current search and filters.'
              : 'Create a campaign to send a published template to a group of schools.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Link href="/admin/marketing/campaigns/new">
                <Button>Create campaign</Button>
              </Link>
            )
          }
        />
      ) : (
        <>
          <p className="result-count" style={{ marginBottom: '0.5rem' }}>
            {meta.total} campaign{meta.total === 1 ? '' : 's'}
          </p>
          <div className="card-grid" style={{ marginBottom: '1rem' }}>
            {items.map((campaign) => {
              const segments = campaignProgressSegments(campaign);
              return (
                <Card key={campaign.id}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: '0.75rem' }}>
                    <div>
                      <Link href={`/admin/marketing/campaigns/${campaign.id}`}>
                        <strong>{campaign.name}</strong>
                      </Link>
                      <div className="muted" style={{ fontSize: '0.82rem' }}>
                        {campaign.template_name ?? 'Template removed'}
                        {campaign.template_version === null
                          ? ''
                          : ` · v${campaign.template_version}`}
                      </div>
                    </div>
                    <Badge tone={marketingCampaignStatusTone(campaign.status)}>
                      {marketingCampaignStatusLabel(campaign.status)}
                    </Badge>
                  </div>

                  <div
                    className="marketing-progress"
                    style={{ marginTop: '0.85rem' }}
                    role="img"
                    aria-label={`${campaignCompletionPercent(campaign)}% processed of ${
                      campaign.recipient_count
                    } recipients`}
                  >
                    {segments.map((segment) => (
                      <span
                        key={segment.key}
                        className={`marketing-progress__segment marketing-progress__segment--${segment.tone}`}
                        style={{ width: `${segment.percent}%` }}
                        title={`${segment.label}: ${segment.count}`}
                      />
                    ))}
                  </div>

                  <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.82rem' }}>
                    {campaign.sent_count} sent of {campaign.recipient_count} ·{' '}
                    {campaignCompletionPercent(campaign)}% processed
                  </p>
                  <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>
                    {campaign.scheduled_at
                      ? `Scheduled ${formatDateTime(campaign.scheduled_at)}`
                      : `Created ${formatDateTime(campaign.created_at)}`}
                  </p>
                </Card>
              );
            })}
          </div>
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
