'use client';

import React, { useState } from 'react';
import {
  ExportDataset,
  type ShiftCreateRequest,
  type ShiftResponse,
  type ShiftUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { shiftCreateSchema, shiftUpdateSchema } from '@school-bus-tracking/validation';
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
import { ListActions } from '../../../features/data-transfer';
import { shiftLabel } from '../../../features/runs/helpers';
import {
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../lib/errors';
import { apiClient } from '../../../services/api';

/**
 * Bell windows (`docs/operating-model.md` §3.1). A shift is the clock runs
 * sit in — the conflict engine compares these windows, so this page is where
 * tiering is made possible. Deleting a shift is refused (409) while runs are
 * attached to it; the message comes from the API and is surfaced verbatim.
 */
const emptyForm = {
  name: '',
  start_time: '',
  end_time: '',
  is_active: true,
};

export default function ShiftsPage() {
  const toast = useToast();
  const list = usePagedResource(
    async (page, search) => unwrapEnvelope(await apiClient.listShifts({ page, limit: 20, search })),
    [],
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ShiftResponse | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ShiftResponse | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (shift: ShiftResponse) => {
    setEditing(shift);
    setForm({
      name: shift.name,
      start_time: shift.start_time.slice(0, 5),
      end_time: shift.end_time.slice(0, 5),
      is_active: shift.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload: ShiftCreateRequest = {
      name: form.name.trim(),
      start_time: form.start_time,
      end_time: form.end_time,
      is_active: form.is_active,
    };
    const parsed = editing
      ? shiftUpdateSchema.safeParse(payload satisfies ShiftUpdateRequest)
      : shiftCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        unwrapEnvelope(await apiClient.updateShift(editing.id, parsed.data as ShiftUpdateRequest));
        toast.push('Shift updated.', 'success');
      } else {
        unwrapEnvelope(await apiClient.createShift(parsed.data as ShiftCreateRequest));
        toast.push('Shift added.', 'success');
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
      await apiClient.deleteShift(pendingDelete.id);
      toast.push('Shift removed.', 'success');
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
        title="Shifts"
        description="Bell windows that group runs. Same bus, two windows, one day — tiering lives here."
        actions={
          <ListActions dataset={ExportDataset.SHIFTS}>
            <Button onClick={startCreate}>Add shift</Button>
          </ListActions>
        }
      />
      {list.loading ? (
        <Skeleton lines={6} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={() => void list.reload()} />
      ) : list.items.length === 0 ? (
        <EmptyState
          title="No shifts yet"
          description="Add a bell window (e.g. Morning 07:00–11:00) before scheduling runs onto shifts."
          action={<Button onClick={startCreate}>Add shift</Button>}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Window</th>
                  <th>Runs</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((shift) => (
                  <tr key={shift.id}>
                    <td>{shift.name}</td>
                    <td>{shiftLabel(shift)}</td>
                    <td>{shift.run_count ?? 0}</td>
                    <td>
                      <Badge tone={shift.is_active ? 'success' : 'neutral'}>
                        {shift.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td>
                      <div className="table-actions">
                        <Button variant="secondary" onClick={() => startEdit(shift)}>
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => setPendingDelete(shift)}>
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
      <Modal title={editing ? 'Edit shift' : 'Add shift'} open={open} onClose={() => setOpen(false)}>
        <form className="form-grid" onSubmit={(event) => void save(event)}>
          <Field id="name" label="Name" error={fieldErrors.name}>
            <Input
              id="name"
              value={form.name}
              placeholder="Morning"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field id="start_time" label="Starts" error={fieldErrors.start_time}>
            <Input
              id="start_time"
              type="time"
              value={form.start_time}
              onChange={(event) => setForm({ ...form, start_time: event.target.value })}
            />
          </Field>
          <Field id="end_time" label="Ends" error={fieldErrors.end_time}>
            <Input
              id="end_time"
              type="time"
              value={form.end_time}
              onChange={(event) => setForm({ ...form, end_time: event.target.value })}
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
        title="Delete shift?"
        message={
          pendingDelete
            ? `${pendingDelete.name} will be removed. Shifts that still have runs cannot be deleted.`
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
