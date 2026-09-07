'use client';

import React from 'react';
import { ExportDataset, ImportModule } from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Skeleton,
} from '../../../components/ui';
import { ListActions } from '../../../features/data-transfer';
import { usePagedResource } from '../../../hooks/usePagedResource';
import { unwrapEnvelope } from '../../../lib/errors';
import { roleLabel } from '../../../lib/format';
import { apiClient } from '../../../services/api';
import Link from 'next/link';

/**
 * Legacy route-assignment roster, retained as a **read-only mirror** of the
 * authoritative run crew (`docs/operating-model.md` §6.3, Phase 4). Writes
 * were retired with 410 Gone; rosters are managed per run under
 * "Shifts & runs". This page stays so operators can inspect historical
 * route-level rosters and keep using the export/import datasets.
 */
export default function AssignmentsPage() {
  const list = usePagedResource(
    async (page) => unwrapEnvelope(await apiClient.listRouteAssignments({ page, limit: 20 })),
    [],
  );

  return (
    <div className="page">
      <PageHeader
        title="Assignments"
        description="Legacy route-level roster — a read-only mirror of run crew."
        actions={
          <ListActions
            dataset={ExportDataset.ROUTE_ASSIGNMENTS}
            importModule={ImportModule.ROUTE_ASSIGNMENTS}
          >
            <Link href="/shifts">
              <Button>Manage runs &amp; crew</Button>
            </Link>
          </ListActions>
        }
      />
      <p className="notice warning">
        Route assignments are retired and read-only. Crew is now rostered per
        run on the <Link href="/shifts">Shifts &amp; runs</Link> page; this table
        remains as a historical mirror.
      </p>
      {list.loading ? (
        <Skeleton lines={8} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={() => void list.reload()} />
      ) : list.items.length === 0 ? (
        <EmptyState
          title="No assignments"
          description="Legacy route-level roster rows will appear here as a read-only mirror."
          action={
            <Link href="/shifts">
              <Button>Go to Shifts &amp; runs</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Route</th>
                  <th>Bus</th>
                  <th>Crew</th>
                  <th>Effective</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((row) => (
                  <tr key={row.id}>
                    <td>{roleLabel(row.role)}</td>
                    <td>
                      {row.route_code ? `${row.route_code} — ` : ''}
                      {row.route_name ?? '—'}
                    </td>
                    <td>{row.bus_number ?? row.bus_registration_number ?? '—'}</td>
                    <td>{row.user_name ?? '—'}</td>
                    <td>
                      {row.effective_from}
                      {row.effective_to ? ` → ${row.effective_to}` : ' → open'}
                    </td>
                    <td>
                      <Badge tone={row.is_active ? 'success' : 'neutral'}>
                        {row.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={list.meta.page}
            totalPages={list.meta.totalPages}
            hasNextPage={list.meta.hasNextPage}
            hasPreviousPage={list.meta.hasPreviousPage}
            onPage={list.setPage}
          />
        </>
      )}
    </div>
  );
}
