'use client';

import React, { useState } from 'react';
import {
  ExportDataset,
  ImportModule,
  type ParentCreateRequest,
  type ParentResponse,
  type ParentUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { parentCreateSchema, parentUpdateSchema } from '@school-bus-tracking/validation';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Skeleton,
  useToast,
} from '../../../components/ui';
import { ListActions } from '../../../features/data-transfer';
import { usePagedResource } from '../../../hooks/usePagedResource';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../lib/errors';
import { fullName } from '../../../lib/format';
import { apiClient } from '../../../services/api';

const emptyForm = {
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  phone: '',
  is_active: true,
};

/**
 * Parents / Guardians section (`/parents`).
 *
 * The landing page of the "Parents / Guardians" sidebar entry, which is part
 * of both the school workspace surface and the Super Admin assisted-management
 * ("Manage Data") navigation. It is a plain tenant screen: every call goes
 * through the shared {@link apiClient}, so while an assisted-management
 * context is active the very same requests are transparently remapped onto
 * `/admin/schools/:id/manage/parents` and authorised there against the managed
 * school. Nothing on this page ever sends a tenant id of its own — the server
 * derives it from the JWT (school user) or from the managed route (Super
 * Admin), which is what keeps tenants isolated.
 *
 * Guardian ↔ student links are owned by the student detail screen
 * (Students → a student → Guardians); this page manages the parent accounts
 * themselves so the two surfaces never duplicate the same logic.
 */
export default function ParentsPage() {
  const toast = useToast();
  const list = usePagedResource<ParentResponse>(
    async (page, search) =>
      unwrapEnvelope(await apiClient.listParents({ page, limit: 20, search })),
    [],
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ParentResponse | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ParentResponse | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (parent: ParentResponse) => {
    setEditing(parent);
    setForm({
      first_name: parent.first_name,
      last_name: parent.last_name,
      email: parent.email,
      // Never prefill a password: an edit that leaves this blank keeps the
      // guardian's current credentials untouched.
      password: '',
      phone: parent.phone ?? '',
      is_active: parent.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (editing) {
      const body: ParentUpdateRequest = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        phone: emptyToNull(form.phone),
        is_active: form.is_active,
        ...(form.password ? { password: form.password } : {}),
      };
      const parsed = parentUpdateSchema.safeParse(body);
      if (!parsed.success) {
        setFieldErrors(fieldErrorsFromZod(parsed.error));
        return;
      }
      setBusy(true);
      try {
        unwrapEnvelope(await apiClient.updateParent(editing.id, parsed.data));
        toast.push('Guardian updated.', 'success');
        setOpen(false);
        await list.reload();
      } catch (error) {
        setFieldErrors(fieldErrorsFromUnknown(error));
        toast.push(getApiErrorMessage(error), 'danger');
      } finally {
        setBusy(false);
      }
      return;
    }

    const body: ParentCreateRequest = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      password: form.password,
      phone: emptyToNull(form.phone),
      is_active: form.is_active,
    };
    const parsed = parentCreateSchema.safeParse(body);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      unwrapEnvelope(await apiClient.createParent(parsed.data));
      toast.push('Guardian account created.', 'success');
      setOpen(false);
      await list.reload();
    } catch (error) {
      setFieldErrors(fieldErrorsFromUnknown(error));
      toast.push(getApiErrorMessage(error), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await apiClient.deleteParent(pendingDelete.id);
      toast.push('Guardian removed.', 'success');
      setPendingDelete(null);
      await list.reload();
    } catch (error) {
      toast.push(getApiErrorMessage(error), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Parents / Guardians"
        description="Guardian accounts that can follow their children's trips. Link a guardian to a child from the student's profile."
        actions={
          <ListActions
            dataset={ExportDataset.PARENTS}
            importModule={ImportModule.PARENTS}
            query={{ search: list.search || undefined }}
          >
            <Button onClick={startCreate}>Add guardian</Button>
          </ListActions>
        }
      />
      <div className="toolbar">
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          searching={list.searching}
          placeholder="Search name or email"
        />
      </div>
      {list.loading ? (
        <Skeleton lines={8} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={() => void list.reload()} />
      ) : list.items.length === 0 ? (
        <EmptyState
          title={list.search ? 'No guardians match this search' : 'No guardians yet'}
          description={
            list.search
              ? 'Try a different name or email address.'
              : 'Add a guardian account, then link it to a student from the student profile.'
          }
          action={<Button onClick={startCreate}>Add guardian</Button>}
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((parent) => (
                  <tr key={parent.id}>
                    <td>{fullName(parent)}</td>
                    <td>{parent.email}</td>
                    <td>{parent.phone || '—'}</td>
                    <td>
                      <Badge tone={parent.is_active ? 'success' : 'neutral'}>
                        {parent.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td>
                      <div className="table-actions">
                        <Button variant="secondary" onClick={() => startEdit(parent)}>
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => setPendingDelete(parent)}>
                          Delete
                        </Button>
                      </div>
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

      <Modal
        title={editing ? 'Edit guardian' : 'Add guardian'}
        open={open}
        onClose={() => setOpen(false)}
      >
        <form className="form-grid" onSubmit={(event) => void save(event)}>
          <div className="grid grid-2">
            <Field id="first_name" label="First name" error={fieldErrors.first_name}>
              <Input
                id="first_name"
                value={form.first_name}
                onChange={(event) => setForm({ ...form, first_name: event.target.value })}
              />
            </Field>
            <Field id="last_name" label="Last name" error={fieldErrors.last_name}>
              <Input
                id="last_name"
                value={form.last_name}
                onChange={(event) => setForm({ ...form, last_name: event.target.value })}
              />
            </Field>
          </div>
          <Field id="email" label="Email" error={fieldErrors.email}>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>
          <Field
            id="password"
            label={editing ? 'New password (optional)' : 'Password'}
            hint={editing ? 'Leave blank to keep the current password.' : undefined}
            error={fieldErrors.password}
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </Field>
          <Field id="phone" label="Phone" error={fieldErrors.phone}>
            <Input
              id="phone"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
          </Field>
          <label className="row">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
            />
            Active
          </label>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete guardian?"
        message={
          pendingDelete
            ? `${fullName(pendingDelete)} will no longer be able to sign in, and their links to students are removed. Student records are not deleted.`
            : ''
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
