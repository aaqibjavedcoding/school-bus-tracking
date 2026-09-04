'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useCallback, useMemo, useState } from 'react';
import {
  AdminSchoolStatus,
  SUBSCRIPTION_STATUS_LABELS,
  type AdminSchoolSummary,
} from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Skeleton,
  useToast,
} from '../../../../components/ui';
import { usePagedResource } from '../../../../hooks/usePagedResource';
import { fullName, formatDateTime } from '../../../../lib/format';
import { getApiErrorMessage, unwrapEnvelope } from '../../../../lib/errors';
import { apiClient } from '../../../../services/api';
import { useManagedSchool } from '../../../../features/managed';
import { subscriptionStatusTone } from '../../../../features/admin/subscriptions/helpers';

type SortKey = 'created_at:desc' | 'created_at:asc' | 'name:asc' | 'name:desc' | 'code:asc';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'created_at:desc', label: 'Newest first' },
  { value: 'created_at:asc', label: 'Oldest first' },
  { value: 'name:asc', label: 'Name (A–Z)' },
  { value: 'name:desc', label: 'Name (Z–A)' },
  { value: 'code:asc', label: 'Code (A–Z)' },
];

const PAGE_SIZES = ['10', '20', '50'];

/**
 * School directory of the Super Admin console (`/admin/schools`).
 *
 * Search, status filter, sorting and page size are all handled by the
 * existing `GET /admin/schools` endpoint (which already returns per-tenant
 * stats, the primary admin and the subscription in bulk), so a page of rows
 * costs a fixed number of queries. Nothing here reads another tenant's
 * internal records — only the platform projection the endpoint returns.
 */
export default function AdminSchoolsPage() {
  const router = useRouter();
  const toast = useToast();
  const { enterSchool, managed } = useManagedSchool();
  const [status, setStatus] = useState<'' | AdminSchoolStatus>('');
  const [sort, setSort] = useState<SortKey>('created_at:desc');
  const [limit, setLimit] = useState(10);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    id: string;
    name: string;
    action: 'activate' | 'deactivate';
  } | null>(null);

  const { items, meta, setPage, search, setSearch, loading, searching, error, reload } =
    usePagedResource<AdminSchoolSummary>(
      async (currentPage, currentSearch) => {
        const [sortColumn, order] = sort.split(':') as [
          'created_at' | 'name' | 'code',
          'asc' | 'desc',
        ];
        const envelope = await apiClient.listAdminSchools({
          page: currentPage,
          limit,
          search: currentSearch || undefined,
          status: status || undefined,
          sort: sortColumn,
          order,
        });
        return unwrapEnvelope(envelope);
      },
      [status, sort, limit],
    );

  const hasFilters = Boolean(search || status) || sort !== 'created_at:desc';

  const clearFilters = useCallback(() => {
    setSearch('');
    setStatus('');
    setSort('created_at:desc');
    setPage(1);
  }, [setPage, setSearch]);

  const runLifecycle = useCallback(
    async (id: string, name: string, action: 'activate' | 'deactivate') => {
      setBusyId(id);
      try {
        if (action === 'deactivate') {
          await apiClient.deactivateAdminSchool(id);
          toast.push(`${name} deactivated — its users can no longer sign in.`, 'danger');
        } else {
          await apiClient.activateAdminSchool(id);
          toast.push(`${name} activated — access restored.`, 'success');
        }
        await reload();
      } catch (caught) {
        toast.push(
          getApiErrorMessage(caught, `Unable to ${action} ${name}. Please try again in a moment.`),
          'danger',
        );
      } finally {
        setBusyId(null);
      }
    },
    [reload, toast],
  );

  const enterManageData = useCallback(
    async (school: AdminSchoolSummary) => {
      try {
        await enterSchool({
          id: school.id,
          name: school.name,
          code: school.code,
          is_active: school.is_active,
        });
      } catch (error) {
        toast.push(
          error instanceof Error ? error.message : `Unable to open ${school.name} for management.`,
          'danger',
        );
      }
    },
    [enterSchool, toast],
  );

  const summary = useMemo(() => {
    if (meta.total === 0) return 'No schools';
    const first = (meta.page - 1) * meta.limit + 1;
    const last = Math.min(meta.total, first + items.length - 1);
    return `Showing ${first}–${last} of ${meta.total} school${meta.total === 1 ? '' : 's'}`;
  }, [items.length, meta]);

  return (
    <div className="page">
      <PageHeader
        title="Schools"
        description="Provision, inspect and suspend the customer school tenants of the platform."
        actions={
          <Link href="/admin/schools/new">
            <Button>Add school</Button>
          </Link>
        }
      />

      <div className="toolbar" style={{ marginBottom: '0.75rem' }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          searching={searching}
          placeholder="Search name, code, subdomain, email or city…"
        />
        <Select
          aria-label="Filter by tenant status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as '' | AdminSchoolStatus);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'active', label: 'Active only' },
            { value: 'inactive', label: 'Inactive only' },
          ]}
          style={{ maxWidth: 190 }}
        />
        <Select
          aria-label="Sort schools"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as SortKey);
            setPage(1);
          }}
          options={SORT_OPTIONS}
          style={{ maxWidth: 190 }}
        />
        <Select
          aria-label="Rows per page"
          value={String(limit)}
          onChange={(event) => {
            setLimit(Number(event.target.value));
            setPage(1);
          }}
          options={PAGE_SIZES.map((size) => ({ value: size, label: `${size} per page` }))}
          style={{ maxWidth: 150 }}
        />
        {hasFilters ? (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {loading && items.length === 0 ? (
        <Skeleton lines={10} />
      ) : error ? (
        <ErrorState title="Unable to load schools" message={error} onRetry={() => void reload()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No schools found"
          description={
            hasFilters
              ? 'No school matches the current search and filters. Try a different term or clear the filters.'
              : 'Provision the first customer school to get started.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Link href="/admin/schools/new">
                <Button>Add school</Button>
              </Link>
            )
          }
        />
      ) : (
        <>
          <p className="result-count" style={{ marginBottom: '0.5rem' }}>
            {summary}
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">School</th>
                  <th scope="col">Status</th>
                  <th scope="col">Subscription</th>
                  <th scope="col">Primary admin</th>
                  <th scope="col">Students</th>
                  <th scope="col">Crew</th>
                  <th scope="col">Buses</th>
                  <th scope="col">Created</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((school) => (
                  <tr key={school.id}>
                    <td>
                      <Link className="linkish" href={`/admin/schools/${school.id}`}>
                        {school.name}
                      </Link>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        <code>{school.code}</code>
                        {school.subdomain ? ` · ${school.subdomain}` : ''}
                        {school.city ? ` · ${school.city}` : ''}
                      </div>
                    </td>
                    <td>
                      <Badge tone={school.is_active ? 'success' : 'warning'}>
                        {school.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td>
                      {/* Bulk-enriched by the list endpoint — never fetched per row. */}
                      <Badge tone={subscriptionStatusTone(school.subscription.status)}>
                        {SUBSCRIPTION_STATUS_LABELS[school.subscription.status]}
                      </Badge>
                      <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
                        {school.subscription.plan ? school.subscription.plan.name : 'No plan'}
                        {school.subscription.current_period_end
                          ? ` · until ${formatDateTime(school.subscription.current_period_end)}`
                          : ''}
                      </div>
                    </td>
                    <td>
                      {school.primary_admin ? fullName(school.primary_admin) : '—'}
                      {school.primary_admin?.email ? (
                        <div className="muted" style={{ fontSize: '0.8rem' }}>
                          {school.primary_admin.email}
                        </div>
                      ) : null}
                    </td>
                    <td>{school.stats.student_count}</td>
                    <td>{school.stats.active_staff_count}</td>
                    <td>{school.stats.bus_count}</td>
                    <td>{formatDateTime(school.created_at)}</td>
                    <td>
                      <div className="table-actions">
                        <Button
                          variant="ghost"
                          onClick={() => router.push(`/admin/schools/${school.id}`)}
                        >
                          Open
                        </Button>
                        {managed?.schoolId === school.id ? (
                          <Button variant="secondary" onClick={() => router.push('/students')}>
                            Managing…
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            disabled={busyId === school.id}
                            onClick={() => void enterManageData(school)}
                          >
                            Manage data
                          </Button>
                        )}
                        {school.is_active ? (
                          <Button
                            variant="danger"
                            disabled={busyId === school.id}
                            onClick={() =>
                              setConfirm({ id: school.id, name: school.name, action: 'deactivate' })
                            }
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            variant="success"
                            disabled={busyId === school.id}
                            onClick={() =>
                              setConfirm({ id: school.id, name: school.name, action: 'activate' })
                            }
                          >
                            Activate
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={meta.page}
            totalPages={meta.totalPages}
            hasNextPage={meta.hasNextPage}
            hasPreviousPage={meta.hasPreviousPage}
            onPage={setPage}
          />
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.action === 'deactivate'
            ? `Deactivate ${confirm?.name}?`
            : `Activate ${confirm?.name}?`
        }
        message={
          confirm?.action === 'deactivate'
            ? 'All users of this school (admins, drivers, conductors and parents) will immediately lose access. No student, staff, bus, route, trip, attendance or GPS data is deleted — reactivation restores everything.'
            : 'Access for this school and all of its users will be restored. No data was removed while inactive.'
        }
        confirmLabel={confirm?.action === 'deactivate' ? 'Deactivate school' : 'Activate school'}
        danger={confirm?.action === 'deactivate'}
        busy={busyId === confirm?.id}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const { id, name, action } = confirm;
          setConfirm(null);
          void runLifecycle(id, name, action);
        }}
      />
    </div>
  );
}
