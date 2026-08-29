'use client';

import React, { useState } from 'react';
import {
  RouteAssignmentRole,
  type RouteAssignmentCreateRequest,
  type RouteAssignmentResponse,
} from '@school-bus-tracking/shared-types';
import {
  routeAssignmentCreateSchema,
  routeAssignmentUpdateSchema,
} from '@school-bus-tracking/validation';
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
  Select,
  Skeleton,
  useToast,
} from '../../../components/ui';
import { useLoad } from '../../../hooks/useLoad';
import { usePagedResource } from '../../../hooks/usePagedResource';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../lib/errors';
import { fullName, roleLabel } from '../../../lib/format';
import { apiClient } from '../../../services/api';

const emptyForm = {
  route_id: '',
  bus_id: '',
  user_id: '',
  role: RouteAssignmentRole.DRIVER as string,
  effective_from: '',
  effective_to: '',
  is_active: true,
};

export default function AssignmentsPage() {
  const toast = useToast();
  const lookups = useLoad(async () => {
    const [routes, buses, drivers, conductors] = await Promise.all([
      apiClient.listRoutes({ page: 1, limit: 100 }),
      apiClient.listBuses({ page: 1, limit: 100 }),
      apiClient.listDrivers({ page: 1, limit: 100 }),
      apiClient.listConductors({ page: 1, limit: 100 }),
    ]);
    return {
      routes: unwrapEnvelope(routes).items,
      buses: unwrapEnvelope(buses).items,
      drivers: unwrapEnvelope(drivers).items,
      conductors: unwrapEnvelope(conductors).items,
    };
  }, []);
  const list = usePagedResource(
    async (page) => unwrapEnvelope(await apiClient.listRouteAssignments({ page, limit: 20 })),
    [],
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RouteAssignmentResponse | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RouteAssignmentResponse | null>(null);

  const staffOptions = () => {
    if (!lookups.data) return [];
    const people =
      form.role === RouteAssignmentRole.CONDUCTOR ? lookups.data.conductors : lookups.data.drivers;
    return people.map((person) => ({
      value: person.id,
      label: `${fullName(person)} (${person.email})`,
    }));
  };

  const startCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (row: RouteAssignmentResponse) => {
    setEditing(row);
    setForm({
      route_id: row.route_id,
      bus_id: row.bus_id ?? '',
      user_id: row.user_id,
      role: row.role,
      effective_from: row.effective_from,
      effective_to: row.effective_to ?? '',
      is_active: row.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload: RouteAssignmentCreateRequest = {
      route_id: form.route_id,
      bus_id: form.bus_id,
      user_id: form.user_id,
      role: form.role as RouteAssignmentRole,
      effective_from: form.effective_from,
      effective_to: emptyToNull(form.effective_to),
      is_active: form.is_active,
    };
    const parsed = editing
      ? routeAssignmentUpdateSchema.safeParse(payload)
      : routeAssignmentCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        unwrapEnvelope(await apiClient.updateRouteAssignment(editing.id, parsed.data));
        toast.push('Assignment updated.', 'success');
      } else {
        unwrapEnvelope(
          await apiClient.createRouteAssignment(parsed.data as RouteAssignmentCreateRequest),
        );
        toast.push('Assignment created.', 'success');
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
      await apiClient.deleteRouteAssignment(pendingDelete.id);
      toast.push('Assignment removed.', 'success');
      setPendingDelete(null);
      await list.reload();
    } catch (error) {
      toast.push(getApiErrorMessage(error), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const routeLabel = (id: string) => {
    const route = lookups.data?.routes.find((item) => item.id === id);
    return route ? `${route.code} — ${route.name}` : 'Route unavailable';
  };
  const busLabel = (id: string | null) =>
    lookups.data?.buses.find((bus) => bus.id === id)?.registration_number ??
    (id ? 'Bus unavailable' : '—');

  return (
    <div className="page">
      <PageHeader
        title="Assignments"
        description="Pair a driver or conductor with a bus and route."
        actions={<Button onClick={startCreate}>New assignment</Button>}
      />
      {list.loading ? (
        <Skeleton lines={8} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={() => void list.reload()} />
      ) : list.items.length === 0 ? (
        <EmptyState
          title="No assignments"
          description="Create a roster row before dispatching trips."
          action={<Button onClick={startCreate}>New assignment</Button>}
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
                  <th>Effective</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((row) => (
                  <tr key={row.id}>
                    <td>{roleLabel(row.role)}</td>
                    <td>{routeLabel(row.route_id)}</td>
                    <td>{busLabel(row.bus_id)}</td>
                    <td>
                      {row.effective_from}
                      {row.effective_to ? ` → ${row.effective_to}` : ' → open'}
                    </td>
                    <td>
                      <Badge tone={row.is_active ? 'success' : 'neutral'}>
                        {row.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td>
                      <div className="table-actions">
                        <Button variant="secondary" onClick={() => startEdit(row)}>
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => setPendingDelete(row)}>
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
        title={editing ? 'Edit assignment' : 'New assignment'}
        open={open}
        onClose={() => setOpen(false)}
      >
        <form className="form-grid" onSubmit={(event) => void save(event)}>
          <Field id="role" label="Role" error={fieldErrors.role}>
            <Select
              id="role"
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value, user_id: '' })}
              options={[
                { value: RouteAssignmentRole.DRIVER, label: 'Driver' },
                { value: RouteAssignmentRole.CONDUCTOR, label: 'Conductor' },
              ]}
            />
          </Field>
          <Field id="route_id" label="Route" error={fieldErrors.route_id}>
            <Select
              id="route_id"
              placeholder="Select route"
              value={form.route_id}
              onChange={(event) => setForm({ ...form, route_id: event.target.value })}
              options={(lookups.data?.routes ?? []).map((route) => ({
                value: route.id,
                label: `${route.name} (${route.code})`,
              }))}
            />
          </Field>
          <Field id="bus_id" label="Bus" error={fieldErrors.bus_id}>
            <Select
              id="bus_id"
              placeholder="Select bus"
              value={form.bus_id}
              onChange={(event) => setForm({ ...form, bus_id: event.target.value })}
              options={(lookups.data?.buses ?? []).map((bus) => ({
                value: bus.id,
                label: bus.registration_number,
              }))}
            />
          </Field>
          <Field id="user_id" label="Crew member" error={fieldErrors.user_id}>
            <Select
              id="user_id"
              placeholder="Select person"
              value={form.user_id}
              onChange={(event) => setForm({ ...form, user_id: event.target.value })}
              options={staffOptions()}
            />
          </Field>
          <div className="grid grid-2">
            <Field id="effective_from" label="From" error={fieldErrors.effective_from}>
              <Input
                id="effective_from"
                type="date"
                value={form.effective_from}
                onChange={(event) => setForm({ ...form, effective_from: event.target.value })}
              />
            </Field>
            <Field id="effective_to" label="To" error={fieldErrors.effective_to}>
              <Input
                id="effective_to"
                type="date"
                value={form.effective_to}
                onChange={(event) => setForm({ ...form, effective_to: event.target.value })}
              />
            </Field>
          </div>
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
        title="Delete assignment?"
        message="This roster row will no longer be available for new trips."
        confirmLabel="Delete"
        danger
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
