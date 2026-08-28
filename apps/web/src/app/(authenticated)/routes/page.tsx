'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import type {
  RouteCreateRequest,
  RouteResponse,
  RouteUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { routeCreateSchema, routeUpdateSchema } from '@school-bus-tracking/validation';
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
  Textarea,
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
import { apiClient } from '../../../services/api';

const emptyForm = { name: '', code: '', description: '', is_active: true };

export default function RoutesPage() {
  const toast = useToast();
  const list = usePagedResource(
    async (page, search) => unwrapEnvelope(await apiClient.listRoutes({ page, limit: 20, search })),
    [],
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RouteResponse | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RouteResponse | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (route: RouteResponse) => {
    setEditing(route);
    setForm({
      name: route.name,
      code: route.code,
      description: route.description ?? '',
      is_active: route.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload: RouteCreateRequest = {
      name: form.name.trim(),
      code: form.code.trim(),
      description: emptyToNull(form.description),
      is_active: form.is_active,
    };
    const parsed = editing
      ? routeUpdateSchema.safeParse(payload)
      : routeCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        unwrapEnvelope(await apiClient.updateRoute(editing.id, parsed.data as RouteUpdateRequest));
        toast.push('Route updated.', 'success');
      } else {
        unwrapEnvelope(await apiClient.createRoute(parsed.data as RouteCreateRequest));
        toast.push('Route created.', 'success');
      }
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
      await apiClient.deleteRoute(pendingDelete.id);
      toast.push('Route removed.', 'success');
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
        title="Routes"
        description="Named runs and their ordered boarding stops."
        actions={<Button onClick={startCreate}>Add route</Button>}
      />
      <div className="toolbar">
        <Input
          className="search"
          placeholder="Search routes"
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
          title="No routes yet"
          description="Create a route, then add stops in sequence."
          action={<Button onClick={startCreate}>Add route</Button>}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((route) => (
                  <tr key={route.id}>
                    <td>
                      <Link className="linkish" href={`/routes/${route.id}`}>
                        {route.name}
                      </Link>
                    </td>
                    <td>{route.code}</td>
                    <td>
                      <Badge tone={route.is_active ? 'success' : 'neutral'}>
                        {route.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td>
                      <div className="table-actions">
                        <Button variant="secondary" onClick={() => startEdit(route)}>
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => setPendingDelete(route)}>
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
        title={editing ? 'Edit route' : 'Add route'}
        open={open}
        onClose={() => setOpen(false)}
      >
        <form className="form-grid" onSubmit={(event) => void save(event)}>
          <Field id="name" label="Name" error={fieldErrors.name}>
            <Input
              id="name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field id="code" label="Code" error={fieldErrors.code}>
            <Input
              id="code"
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          </Field>
          <Field id="description" label="Description" error={fieldErrors.description}>
            <Textarea
              id="description"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
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
        title="Delete route?"
        message={pendingDelete ? `${pendingDelete.name} and its stop plan will be removed.` : ''}
        confirmLabel="Delete"
        danger
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
