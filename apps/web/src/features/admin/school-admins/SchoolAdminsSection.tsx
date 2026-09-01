'use client';

import React, { useCallback, useState } from 'react';
import {
  type AdminSchoolAdminCreateRequest,
  type AdminSchoolAdminResponse,
  type AdminSchoolAdminResetPasswordRequest,
  type AdminSchoolAdminUpdateRequest,
} from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  Skeleton,
  useToast,
} from '../../../components/ui';
import { useLoad } from '../../../hooks/useLoad';
import { getApiErrorMessage, unwrapEnvelope } from '../../../lib/errors';
import { fullName, formatDateTime } from '../../../lib/format';
import { apiClient } from '../../../services/api';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { SchoolAdminFormDialog, type SubmitResult } from './SchoolAdminFormDialog';

interface Filters {
  page: number;
  limit: number;
  search: string;
}

type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; admin: AdminSchoolAdminResponse }
  | { kind: 'reset'; admin: AdminSchoolAdminResponse }
  | { kind: 'activate'; admin: AdminSchoolAdminResponse }
  | { kind: 'deactivate'; admin: AdminSchoolAdminResponse }
  | null;

/**
 * Production management surface of a tenant's SCHOOL_ADMIN accounts.
 *
 * Owns its own data so the rest of the school page never blocks on it and
 * so a mutation only refreshes this list. Every status-changing action goes
 * through a confirmation dialog; buttons are disabled while a request is in
 * flight to prevent accidental double submissions. Only SUPER_ADMIN can reach
 * this page (route guard + API role checks); a school user would get 403.
 */
export const SchoolAdminsSection = React.memo(function SchoolAdminsSection({
  schoolId,
  schoolName,
}: {
  schoolId: string;
  schoolName: string;
}) {
  const toast = useToast();
  const [filters, setFilters] = useState<Filters>({ page: 1, limit: 10, search: '' });
  const [searchInput, setSearchInput] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, loading, error, reload, setData } = useLoad(async () => {
    const envelope = await apiClient.listSchoolAdmins(schoolId, {
      page: filters.page,
      limit: filters.limit,
      search: filters.search || undefined,
    });
    return unwrapEnvelope(envelope);
  }, [schoolId, filters.page, filters.limit, filters.search]);

  const applySearch = useCallback(() => {
    setFilters((current) => ({ ...current, search: searchInput.trim(), page: 1 }));
  }, [searchInput]);

  const afterMutation = useCallback(async () => {
    setData(null);
    await reload();
  }, [reload, setData]);

  const submitAdmin = useCallback(
    async (
      body: AdminSchoolAdminCreateRequest | AdminSchoolAdminUpdateRequest,
    ): Promise<SubmitResult> => {
      setBusy(true);
      try {
        if (dialog?.kind === 'create') {
          await apiClient.createSchoolAdmin(schoolId, body as AdminSchoolAdminCreateRequest);
          toast.push('School admin added', 'success');
        } else if (dialog?.kind === 'edit') {
          await apiClient.updateSchoolAdmin(
            schoolId,
            dialog.admin.id,
            body as AdminSchoolAdminUpdateRequest,
          );
          toast.push('School admin updated', 'success');
        }
        setDialog(null);
        await afterMutation();
        return null;
      } catch (caught) {
        return { message: getApiErrorMessage(caught, 'Could not save school admin'), error: caught };
      } finally {
        setBusy(false);
      }
    },
    [afterMutation, dialog, schoolId, toast],
  );

  const submitReset = useCallback(
    async (body: AdminSchoolAdminResetPasswordRequest): Promise<SubmitResult> => {
      if (!dialog || dialog.kind !== 'reset') return null;
      setBusy(true);
      try {
        await apiClient.resetSchoolAdminPassword(schoolId, dialog.admin.id, body);
        toast.push('Password updated for ' + fullName(dialog.admin), 'success');
        setDialog(null);
        return null;
      } catch (caught) {
        return { message: getApiErrorMessage(caught, 'Could not reset password'), error: caught };
      } finally {
        setBusy(false);
      }
    },
    [dialog, schoolId, toast],
  );

  const runLifecycle = useCallback(
    async (admin: AdminSchoolAdminResponse, isActive: boolean) => {
      setBusyId(admin.id);
      try {
        if (isActive) {
          await apiClient.setSchoolAdminActive(schoolId, admin.id, true);
          toast.push(`${fullName(admin)} activated`, 'success');
        } else {
          await apiClient.setSchoolAdminActive(schoolId, admin.id, false);
          toast.push(`${fullName(admin)} deactivated`, 'info');
        }
        setDialog(null);
        await afterMutation();
      } catch (caught) {
        setDialog(null);
        toast.push(getApiErrorMessage(caught, 'Lifecycle action failed'), 'danger');
      } finally {
        setBusyId(null);
      }
    },
    [afterMutation, schoolId, toast],
  );

  const admins = data?.items ?? [];
  const lifecycle =
    dialog && (dialog.kind === 'deactivate' || dialog.kind === 'activate') ? dialog : null;

  return (
    <>
      <Card
        title="School administrators"
        description="Accounts allowed to operate this tenant. Credentials are never shown."
        className=""
      >
        <div className="toolbar" style={{ marginBottom: '1rem' }}>
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              applySearch();
            }}
          >
            <Input
              name="admin-search"
              placeholder="Search name or email…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              style={{ minWidth: 240 }}
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
          <Button onClick={() => setDialog({ kind: 'create' })}>Add admin</Button>
        </div>

        {loading && !data ? (
          <Skeleton lines={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void reload()} />
        ) : admins.length === 0 ? (
          <EmptyState
            title="No administrators"
            description={
              filters.search
                ? 'No admin matches this search.'
                : 'Add the first school administrator for this tenant.'
            }
            action={
              <Button onClick={() => setDialog({ kind: 'create' })}>Add admin</Button>
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map((admin) => (
                    <tr key={admin.id}>
                      <td>{fullName(admin)}</td>
                      <td>{admin.email}</td>
                      <td>{admin.phone ?? '—'}</td>
                      <td>
                        <Badge tone={admin.is_active ? 'success' : 'warning'}>
                          {admin.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td>{formatDateTime(admin.created_at)}</td>
                      <td>
                        <div className="table-actions">
                          <Button
                            variant="ghost"
                            disabled={busy || busyId === admin.id}
                            onClick={() => setDialog({ kind: 'edit', admin })}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy || busyId === admin.id}
                            onClick={() => setDialog({ kind: 'reset', admin })}
                          >
                            Reset password
                          </Button>
                          {admin.is_active ? (
                            <Button
                              variant="danger"
                              disabled={busy || busyId === admin.id}
                              onClick={() => setDialog({ kind: 'deactivate', admin })}
                            >
                              Deactivate
                            </Button>
                          ) : (
                            <Button
                              variant="success"
                              disabled={busy || busyId === admin.id}
                              onClick={() => setDialog({ kind: 'activate', admin })}
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
              page={data?.meta.page ?? 1}
              totalPages={data?.meta.totalPages ?? 1}
              hasNextPage={Boolean(data?.meta.hasNextPage)}
              hasPreviousPage={Boolean(data?.meta.hasPreviousPage)}
              onPage={(page) => setFilters((current) => ({ ...current, page }))}
            />
          </>
        )}
      </Card>

      <SchoolAdminFormDialog
        open={dialog?.kind === 'create' || dialog?.kind === 'edit'}
        mode={dialog?.kind === 'edit' ? 'edit' : 'create'}
        schoolName={schoolName}
        admin={dialog?.kind === 'edit' ? dialog.admin : null}
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={submitAdmin}
      />

      <ResetPasswordDialog
        open={dialog?.kind === 'reset'}
        schoolName={schoolName}
        admin={
          dialog?.kind === 'reset'
            ? dialog.admin
            : { id: '', first_name: '', last_name: '' }
        }
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={submitReset}
      />

      <ConfirmDialog
        open={lifecycle !== null}
        title={
          lifecycle?.kind === 'deactivate'
            ? `Deactivate ${lifecycle.admin.first_name} ${lifecycle.admin.last_name}?`
            : `Activate ${lifecycle?.admin.first_name ?? ''} ${lifecycle?.admin.last_name ?? ''}?`
        }
        message={
          lifecycle?.kind === 'deactivate'
            ? 'This school admin will immediately lose access, including any session already signed in. Their account, history and records are preserved — activation restores access.'
            : 'This school admin will regain full access to the tenant workspace.'
        }
        confirmLabel={lifecycle?.kind === 'deactivate' ? 'Deactivate admin' : 'Activate admin'}
        danger={lifecycle?.kind === 'deactivate'}
        busy={busyId === lifecycle?.admin.id}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (lifecycle?.kind === 'deactivate') {
            void runLifecycle(lifecycle.admin, false);
          } else if (lifecycle?.kind === 'activate') {
            void runLifecycle(lifecycle.admin, true);
          }
        }}
      />
    </>
  );
});
