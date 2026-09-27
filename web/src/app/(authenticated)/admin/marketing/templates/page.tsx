'use client';

import Link from 'next/link';
import React, { useCallback, useState } from 'react';
import {
  MarketingTemplateStatus,
  type MarketingTemplateSummary,
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
  describeTemplateVersions,
  marketingTemplateStatusLabel,
  marketingTemplateStatusTone,
} from '../../../../../features/marketing/helpers';

/**
 * Email templates — the reusable content behind every campaign.
 *
 * Discovery only: creating and editing live on their own pages, because a
 * template edit is a versioned operation with a publish step and putting that
 * behind an inline row control would make it far too easy to publish by
 * accident.
 *
 * Data comes through the shared `apiClient` (never `fetch`), so the auth
 * refresh, CSRF header and error envelope handling are the same ones the rest
 * of the console uses.
 */
export default function AdminMarketingTemplatesPage() {
  const [status, setStatus] = useState<'' | MarketingTemplateStatus>('');

  const { items, meta, setPage, search, setSearch, loading, searching, error, reload } =
    usePagedResource<MarketingTemplateSummary>(
      async (currentPage, currentSearch) => {
        const envelope = await apiClient.listMarketingTemplates({
          page: currentPage,
          limit: 12,
          search: currentSearch || undefined,
          status: status || undefined,
          sort: 'created_at',
          order: 'desc',
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
        title="Email templates"
        description="Reusable marketing content. Publishing freezes a version so a campaign always sends exactly what was approved."
        actions={
          <Link href="/admin/marketing/templates/new">
            <Button>Create template</Button>
          </Link>
        }
      />

      <div className="toolbar" style={{ marginBottom: '1rem' }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          searching={searching}
          placeholder="Search template name or slug…"
        />
        <Select
          aria-label="Filter by template status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as '' | MarketingTemplateStatus);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All statuses' },
            { value: MarketingTemplateStatus.DRAFT, label: 'Draft' },
            { value: MarketingTemplateStatus.PUBLISHED, label: 'Published' },
            { value: MarketingTemplateStatus.ARCHIVED, label: 'Archived' },
          ]}
          style={{ maxWidth: 200 }}
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
          title="Unable to load templates"
          message={error}
          onRetry={() => void reload()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No templates yet"
          description={
            hasFilters
              ? 'No template matches the current search and filters.'
              : 'Create a template to write the content a campaign will send.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Link href="/admin/marketing/templates/new">
                <Button>Create template</Button>
              </Link>
            )
          }
        />
      ) : (
        <>
          <p className="result-count" style={{ marginBottom: '0.5rem' }}>
            {meta.total} template{meta.total === 1 ? '' : 's'}
          </p>
          <div className="card-grid" style={{ marginBottom: '1rem' }}>
            {items.map((template) => (
              <Card key={template.id}>
                <div className="row" style={{ justifyContent: 'space-between', gap: '0.75rem' }}>
                  <div>
                    <Link href={`/admin/marketing/templates/${template.id}`}>
                      <strong>{template.name}</strong>
                    </Link>
                    <div className="muted" style={{ fontSize: '0.82rem' }}>
                      {template.slug}
                    </div>
                  </div>
                  <Badge tone={marketingTemplateStatusTone(template.status)}>
                    {marketingTemplateStatusLabel(template.status)}
                  </Badge>
                </div>
                <p className="muted" style={{ margin: '0.75rem 0 0', fontSize: '0.85rem' }}>
                  {template.version_count} version{template.version_count === 1 ? '' : 's'} ·{' '}
                  {describeTemplateVersions(template)}
                </p>
                <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>
                  Updated {formatDateTime(template.updated_at)}
                </p>
              </Card>
            ))}
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
