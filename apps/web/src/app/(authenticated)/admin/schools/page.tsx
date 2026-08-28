'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useCallback, useState } from 'react';
import { AdminSchoolStatus } from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  useToast,
} from '../../../../components/ui';
import { useLoad } from '../../../../hooks/useLoad';
import { fullName, formatDateTime } from '../../../../lib/format';
import { getApiErrorMessage, unwrapEnvelope } from '../../../../lib/errors';
import { apiClient } from '../../../../services/api';

interface ListState {
  page: number;
  limit: number;
  search: string;
  status: '' | AdminSchoolStatus;
}

const INITIAL_STATE: ListState = { page: 1, limit: 10, search: '', status: '' };

export default function AdminSchoolsPage() {
  const router = useRouter();
  const toast = useToast();
  const [filters, setFilters] = useState<ListState>(INITIAL_STATE);
  const [searchInput, setSearchInput] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    id: string;
    name: string;
    action: 'activate' | 'deactivate';
  } | null>(null);

  const { data, loading, error, reload, setData } = useLoad(async () => {
    const envelope = await apiClient.listAdminSchools({
      page: filters.page,
      limit: filters.limit,
      search: filters.search || undefined,
      status: filters.status || undefined,
    });
    return unwrapEnvelope(envelope);
  }, [filters.page, filters.limit, filters.search, filters.status]);

  const applySearch = useCallback(() => {
    setFilters((current) => ({ ...current, search: searchInput.trim(), page: 1 }));
  }, [searchInput]);

  const runLifecycle = useCallback(
    async (id: string, action: 'activate' | 'deactivate') => {
      setBusyId(id);
      try {
        if (action === 'deactivate') {
          await apiClient.deactivateAdminSchool(id);
          toast.push('School deactivated — its users can no longer sign in', 'danger');
        } else {
          await apiClient.activateAdminSchool(id);
          toast.push('School activated — access restored', 'success');
        }
        setData(null);
        await reload();
      } catch (caught) {
        toast.push(getApiErrorMessage(caught, 'Lifecycle action failed'), 'danger');
      } finally {
        setBusyId(null);
      }
    },
    [reload, setData, toast],
  );

  return (
    <div className="page">
      <PageHeader
        title="Schools"
        description="Provision, inspect and suspend customer school tenants."
        actions={
          <Link href="/admin/schools/new">
            <Button>Add school</Button>
          </Link>
        }
      />

      <div className="toolbar" style={{ marginBottom: '1rem' }}>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            applySearch();
          }}
        >
          <Input
            name="search"
            placeholder="Search name, code, city…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            style={{ minWidth: 260 }}
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <Select
          aria-label="Status filter"
          value={filters.status}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              status: event.target.value as '' | AdminSchoolStatus,
              page: 1,
            }))
          }
          options={[
            { value: '', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
          style={{ maxWidth: 200 }}
        />
      </div>

      {loading && !data ? (
        <Skeleton lines={10} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No schools found"
          description={
            filters.search || filters.status
              ? 'Try a different search or filter.'
              : 'Provision the first customer school to get started.'
          }
          action={
            <Link href="/admin/schools/new">
              <Button>Add school</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>School</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Admin</th>
                  <th>Students</th>
                  <th>Staff</th>
                  <th>Buses</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((school) => (
                  <tr key={school.id}>
                    <td>
                      <Link className="linkish" href={`/admin/schools/${school.id}`}>
                        {school.name}
                      </Link>
                      {school.city ? (
                        <div className="muted" style={{ fontSize: '0.8rem' }}>
                          {school.city}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <code>{school.code}</code>
                    </td>
                    <td>
                      <Badge tone={school.is_active ? 'success' : 'warning'}>
                        {school.status === 'active' ? 'Active' : 'Inactive'}
                      </Badge>
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
                          View
                        </Button>
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
            page={data.meta.page}
            totalPages={data.meta.totalPages}
            hasNextPage={data.meta.hasNextPage}
            hasPreviousPage={data.meta.hasPreviousPage}
            onPage={(page) => setFilters((current) => ({ ...current, page }))}
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
          if (confirm) {
            void runLifecycle(confirm.id, confirm.action);
            setConfirm(null);
          }
        }}
      />
    </div>
  );
}
