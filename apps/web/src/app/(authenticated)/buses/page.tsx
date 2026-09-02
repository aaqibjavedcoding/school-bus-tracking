'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import {
  ExportDataset,
  ImportModule,
  type BusCreateRequest,
  type BusResponse,
  type BusUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { busCreateSchema, busUpdateSchema } from '@school-bus-tracking/validation';
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
import { ListActions } from '../../../features/data-transfer';
import { usePagedResource } from '../../../hooks/usePagedResource';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../lib/errors';
import { apiClient } from '../../../services/api';

const emptyForm = {
  registration_number: '',
  bus_number: '',
  capacity: '40',
  is_active: true,
};

export default function BusesPage() {
  const toast = useToast();
  const list = usePagedResource(
    async (page, search) => unwrapEnvelope(await apiClient.listBuses({ page, limit: 20, search })),
    [],
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BusResponse | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BusResponse | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (bus: BusResponse) => {
    setEditing(bus);
    setForm({
      registration_number: bus.registration_number,
      bus_number: bus.bus_number ?? '',
      capacity: String(bus.capacity),
      is_active: bus.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload: BusCreateRequest = {
      registration_number: form.registration_number.trim(),
      bus_number: emptyToNull(form.bus_number),
      capacity: Number(form.capacity),
      is_active: form.is_active,
    };
    const parsed = editing
      ? busUpdateSchema.safeParse(payload)
      : busCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        unwrapEnvelope(await apiClient.updateBus(editing.id, parsed.data as BusUpdateRequest));
        toast.push('Bus updated.', 'success');
      } else {
        unwrapEnvelope(await apiClient.createBus(parsed.data as BusCreateRequest));
        toast.push('Bus added.', 'success');
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
      await apiClient.deleteBus(pendingDelete.id);
      toast.push('Bus removed.', 'success');
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
        title="Buses"
        description="School fleet vehicles used on routes."
        actions={
          <ListActions
            dataset={ExportDataset.BUSES}
            importModule={ImportModule.BUSES}
            query={{ search: list.search || undefined }}
          >
            <Button onClick={startCreate}>Add bus</Button>
          </ListActions>
        }
      />
      <div className="toolbar">
        <Input
          className="search"
          placeholder="Search registration or fleet number"
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
          title="No buses yet"
          description="Add a vehicle before creating route assignments."
          action={<Button onClick={startCreate}>Add bus</Button>}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Registration</th>
                  <th>Fleet no.</th>
                  <th>Capacity</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((bus) => (
                  <tr key={bus.id}>
                    <td>{bus.registration_number}</td>
                    <td>{bus.bus_number || '—'}</td>
                    <td>{bus.capacity}</td>
                    <td>
                      <Badge tone={bus.is_active ? 'success' : 'neutral'}>
                        {bus.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td>
                      <div className="table-actions">
                        <Link className="btn btn-secondary" href={`/buses/${bus.id}/documents`}>
                          Documents
                        </Link>
                        <Button variant="secondary" onClick={() => startEdit(bus)}>
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => setPendingDelete(bus)}>
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
      <Modal title={editing ? 'Edit bus' : 'Add bus'} open={open} onClose={() => setOpen(false)}>
        <form className="form-grid" onSubmit={(event) => void save(event)}>
          <Field
            id="registration_number"
            label="Registration number"
            error={fieldErrors.registration_number}
          >
            <Input
              id="registration_number"
              value={form.registration_number}
              onChange={(event) => setForm({ ...form, registration_number: event.target.value })}
            />
          </Field>
          <Field id="bus_number" label="Fleet number" error={fieldErrors.bus_number}>
            <Input
              id="bus_number"
              value={form.bus_number}
              onChange={(event) => setForm({ ...form, bus_number: event.target.value })}
            />
          </Field>
          <Field id="capacity" label="Capacity" error={fieldErrors.capacity}>
            <Input
              id="capacity"
              type="number"
              min={1}
              value={form.capacity}
              onChange={(event) => setForm({ ...form, capacity: event.target.value })}
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
        title="Delete bus?"
        message={
          pendingDelete
            ? `${pendingDelete.registration_number} will be removed from the fleet.`
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
