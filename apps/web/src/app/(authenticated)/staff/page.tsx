'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import type { StaffCreateRequest, StaffResponse } from '@school-bus-tracking/shared-types';
import { UserRole } from '@school-bus-tracking/shared-types';
import { staffCreateSchema, staffUpdateSchema } from '@school-bus-tracking/validation';
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
  Skeleton,
  useToast,
} from '../../../components/ui';
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

type Tab = 'drivers' | 'conductors';

const emptyForm = {
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  phone: '',
  is_active: true,
};

export default function StaffPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('drivers');
  const list = usePagedResource<StaffResponse>(
    async (page, search) => {
      if (tab === 'drivers') {
        const data = unwrapEnvelope(await apiClient.listDrivers({ page, limit: 20, search }));
        return { items: data.items, meta: data.meta };
      }
      const data = unwrapEnvelope(await apiClient.listConductors({ page, limit: 20, search }));
      return { items: data.items, meta: data.meta };
    },
    [tab],
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StaffResponse | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StaffResponse | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (person: StaffResponse) => {
    setEditing(person);
    setForm({
      first_name: person.first_name,
      last_name: person.last_name,
      email: person.email,
      password: '',
      phone: person.phone ?? '',
      is_active: person.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload: StaffCreateRequest = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      password: form.password,
      phone: emptyToNull(form.phone),
      is_active: form.is_active,
    };
    if (editing) {
      const updateBody = {
        first_name: payload.first_name,
        last_name: payload.last_name,
        email: payload.email,
        phone: payload.phone,
        is_active: payload.is_active,
        ...(form.password ? { password: form.password } : {}),
      };
      const parsed = staffUpdateSchema.safeParse(updateBody);
      if (!parsed.success) {
        setFieldErrors(fieldErrorsFromZod(parsed.error));
        return;
      }
      setBusy(true);
      try {
        if (tab === 'drivers') {
          unwrapEnvelope(await apiClient.updateDriver(editing.id, parsed.data));
        } else {
          unwrapEnvelope(await apiClient.updateConductor(editing.id, parsed.data));
        }
        toast.push('Account updated.', 'success');
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
    const parsed = staffCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      if (tab === 'drivers') {
        unwrapEnvelope(await apiClient.createDriver(parsed.data));
      } else {
        unwrapEnvelope(await apiClient.createConductor(parsed.data));
      }
      toast.push('Account created.', 'success');
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
      if (tab === 'drivers') {
        await apiClient.deleteDriver(pendingDelete.id);
      } else {
        await apiClient.deleteConductor(pendingDelete.id);
      }
      toast.push('Account removed.', 'success');
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
        title="Drivers & conductors"
        description="Crew accounts that can be assigned to routes."
        actions={
          <Button onClick={startCreate}>Add {tab === 'drivers' ? 'driver' : 'conductor'}</Button>
        }
      />
      <div className="tabs" role="tablist">
        <button
          type="button"
          className={`tab ${tab === 'drivers' ? 'active' : ''}`}
          onClick={() => setTab('drivers')}
        >
          Drivers
        </button>
        <button
          type="button"
          className={`tab ${tab === 'conductors' ? 'active' : ''}`}
          onClick={() => setTab('conductors')}
        >
          Conductors
        </button>
      </div>
      <div className="toolbar">
        <Input
          className="search"
          placeholder="Search name or email"
          value={list.search}
          onChange={(event) => list.setSearch(event.target.value)}
        />
      </div>
      {list.loading ? (
        <Skeleton lines={8} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={() => void list.reload()} />
      ) : list.items.length === 0 ? (
        <EmptyState
          title={`No ${tab} yet`}
          description="Create an account, then assign them to a route."
          action={<Button onClick={startCreate}>Add account</Button>}
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
                {list.items.map((person) => (
                  <tr key={person.id}>
                    <td>{fullName(person)}</td>
                    <td>{person.email}</td>
                    <td>{person.phone || '—'}</td>
                    <td>
                      <Badge tone={person.is_active ? 'success' : 'neutral'}>
                        {person.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td>
                      <div className="table-actions">
                        {tab === 'drivers' && person.role === UserRole.DRIVER ? (
                          <Link href={`/drivers/${person.id}/documents`}>
                            <Button variant="secondary">Documents</Button>
                          </Link>
                        ) : null}
                        <Button variant="secondary" onClick={() => startEdit(person)}>
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => setPendingDelete(person)}>
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
        title={editing ? 'Edit account' : `Add ${tab === 'drivers' ? 'driver' : 'conductor'}`}
        open={open}
        onClose={() => setOpen(false)}
      >
        <form className="form-grid" onSubmit={(event) => void save(event)}>
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
            error={fieldErrors.password}
          >
            <Input
              id="password"
              type="password"
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
        title="Delete account?"
        message={
          pendingDelete ? `${fullName(pendingDelete)} will no longer be able to sign in.` : ''
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
