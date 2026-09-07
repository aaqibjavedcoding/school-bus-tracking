'use client';

import React, { useState } from 'react';
import {
  ExportDataset,
  RunCrewRole,
  type BusResponse,
  type RunCrewResponse,
  type RunResponse,
  type ShiftResponse,
} from '@school-bus-tracking/shared-types';
import { routeRunCreateSchema, runUpdateSchema } from '@school-bus-tracking/validation';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  Select,
  useToast,
} from '../../components/ui';
import {
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../lib/errors';
import { apiClient } from '../../services/api';
import { ListActions } from '../data-transfer';
import { runLabel, shiftWindowLabel, windowsOverlapPreview } from './helpers';

/**
 * Runs management inside the route detail page
 * (`docs/operating-model.md` Phase 3). One card per route: list the runs,
 * add/edit/retire a run, and roster bus crew per run.
 *
 * All validation is delegated to the shared zod schemas (mirrors of the DTOs);
 * the §4 conflict rules (same bus / same person in overlapping windows, the
 * undeletable default run, the 409 codes) live server-side and their
 * messages surface verbatim in the toast — the UI never re-implements a
 * verdict, it only *pre-warns* (the bus-window note) so a common mistake
 * shows up before the save.
 */

interface RunsPanelProps {
  routeId: string;
  runs: RunResponse[];
  shifts: ShiftResponse[];
  buses: BusResponse[];
  onChanged: () => Promise<unknown> | void;
}

const emptyRunForm = { code: '', shift_id: '', bus_id: '', is_active: true };

interface CrewFormState {
  user_id: string;
  role: RunCrewRole;
  effective_from: string;
  effective_to: string;
}

const emptyCrewForm: CrewFormState = {
  user_id: '',
  role: RunCrewRole.DRIVER,
  effective_from: '',
  effective_to: '',
};

export const RunsPanel: React.FC<RunsPanelProps> = ({
  routeId,
  runs,
  shifts,
  buses,
  onChanged,
}) => {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RunResponse | null>(null);
  const [form, setForm] = useState(emptyRunForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RunResponse | null>(null);

  // Crew editing state for one run at a time.
  const [crewRun, setCrewRun] = useState<RunResponse | null>(null);
  const [crewRows, setCrewRows] = useState<RunCrewResponse[]>([]);
  const [crewForm, setCrewForm] = useState<CrewFormState>(emptyCrewForm);
  const [crewStaff, setCrewStaff] = useState<Array<{ id: string; name: string }>>([]);
  const [crewBusy, setCrewBusy] = useState(false);
  const [pendingCrewDelete, setPendingCrewDelete] = useState<RunCrewResponse | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(emptyRunForm);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (run: RunResponse) => {
    setEditing(run);
    setForm({
      code: run.code,
      shift_id: run.shift_id ?? '',
      bus_id: run.bus_id ?? '',
      is_active: run.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (editing) {
        const parsed = runUpdateSchema.safeParse({
          code: form.code.trim() || undefined,
          shift_id: form.shift_id || null,
          bus_id: form.bus_id || null,
          is_active: form.is_active,
        });
        if (!parsed.success) {
          setFieldErrors(fieldErrorsFromZod(parsed.error));
          return;
        }
        unwrapEnvelope(await apiClient.updateRun(editing.id, parsed.data));
        toast.push('Run updated.', 'success');
      } else {
        const parsed = routeRunCreateSchema.safeParse({
          ...(form.code.trim() ? { code: form.code.trim() } : {}),
          shift_id: form.shift_id || null,
          bus_id: form.bus_id || null,
          is_active: form.is_active,
        });
        if (!parsed.success) {
          setFieldErrors(fieldErrorsFromZod(parsed.error));
          return;
        }
        unwrapEnvelope(await apiClient.createRouteRun(routeId, parsed.data));
        toast.push('Run added.', 'success');
      }
      setOpen(false);
      await onChanged();
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
      await apiClient.deleteRun(pendingDelete.id);
      toast.push('Run retired.', 'success');
      setPendingDelete(null);
      await onChanged();
    } catch (error) {
      toast.push(getApiErrorMessage(error), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const selectedBusRuns = form.bus_id
    ? runs.filter(
        (run) =>
          run.bus_id === form.bus_id &&
          run.id !== editing?.id &&
          windowsOverlapPreview(
            {
              start_time: shifts.find((s) => s.id === form.shift_id)?.start_time ?? null,
              end_time: shifts.find((s) => s.id === form.shift_id)?.end_time ?? null,
            },
            { start_time: run.shift_start_time ?? null, end_time: run.shift_end_time ?? null },
          ),
      )
    : [];

  const openCrew = async (run: RunResponse) => {
    setCrewRun(run);
    setCrewForm({ ...emptyCrewForm, effective_from: '' });
    setFieldErrors({});
    try {
      const [crew, drivers, conductors] = await Promise.all([
        apiClient.listRunCrew(run.id, { limit: 100 }),
        apiClient.listDrivers({ limit: 100 }),
        apiClient.listConductors({ limit: 100 }),
      ]);
      setCrewRows(unwrapEnvelope(crew).items);
      setCrewStaff([
        ...unwrapEnvelope(drivers).items.map((d) => ({
          id: d.id,
          name: `${d.first_name} ${d.last_name} · driver`,
        })),
        ...unwrapEnvelope(conductors).items.map((c) => ({
          id: c.id,
          name: `${c.first_name} ${c.last_name} · conductor`,
        })),
      ]);
    } catch (error) {
      toast.push(getApiErrorMessage(error), 'danger');
    }
  };

  const saveCrew = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!crewRun) return;
    setCrewBusy(true);
    try {
      unwrapEnvelope(
        await apiClient.createRunCrew(crewRun.id, {
          user_id: crewForm.user_id,
          role: crewForm.role,
          effective_from: crewForm.effective_from || new Date().toISOString().slice(0, 10),
          effective_to: crewForm.effective_to || null,
        }),
      );
      toast.push('Crew rostered.', 'success');
      const crew = await apiClient.listRunCrew(crewRun.id, { limit: 100 });
      setCrewRows(unwrapEnvelope(crew).items);
      setCrewForm({ ...emptyCrewForm });
      await onChanged();
    } catch (error) {
      toast.push(getApiErrorMessage(error), 'danger');
    } finally {
      setCrewBusy(false);
    }
  };

  const removeCrew = async () => {
    if (!pendingCrewDelete || !crewRun) return;
    setCrewBusy(true);
    try {
      await apiClient.deleteRunCrew(pendingCrewDelete.id);
      toast.push('Roster row removed.', 'success');
      setPendingCrewDelete(null);
      const crew = await apiClient.listRunCrew(crewRun.id, { limit: 100 });
      setCrewRows(unwrapEnvelope(crew).items);
      await onChanged();
    } catch (error) {
      toast.push(getApiErrorMessage(error), 'danger');
    } finally {
      setCrewBusy(false);
    }
  };

  return (
    <Card title="Runs" description="One vehicle's timed pass over this route — bus, crew and bell window per run.">
      <div className="table-actions" style={{ marginBottom: 8 }}>
        <ListActions dataset={ExportDataset.RUNS} query={{ route_id: routeId }}>
          <Button onClick={startCreate}>Add run</Button>
        </ListActions>
      </div>
      {runs.length === 0 ? (
        <p className="muted">
          No runs yet. Until one exists this route behaves exactly like before the runs model.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Bus</th>
                <th>Window</th>
                <th>Crew</th>
                <th>Riders</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    {run.code}
                    {run.is_default ? <Badge tone="neutral"> default</Badge> : null}
                  </td>
                  <td>{run.bus_number ?? run.bus_registration_number ?? '—'}</td>
                  <td>{shiftWindowLabel(run)}</td>
                  <td>
                    {[run.driver_name, run.conductor_name].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td>{run.student_count ?? 0}</td>
                  <td>
                    <Badge tone={run.is_active ? 'success' : 'neutral'}>
                      {run.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td>
                    <div className="table-actions">
                      <Button variant="secondary" onClick={() => startEdit(run)}>
                        Edit
                      </Button>
                      <Button variant="secondary" onClick={() => void openCrew(run)}>
                        Crew
                      </Button>
                      <Button variant="ghost" onClick={() => setPendingDelete(run)}>
                        Retire
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal title={editing ? `Edit run ${editing.code}` : 'Add run'} open={open} onClose={() => setOpen(false)}>
        <form className="form-grid" onSubmit={(event) => void save(event)}>
          {!editing ? (
            <p className="muted">
              Leave the code empty to derive it from the route, and pick nothing to leave
              bus/shift open — an unshifted run occupies the whole day.
            </p>
          ) : null}
          <Field id="run_code" label="Code" error={fieldErrors.code}>
            <Input
              id="run_code"
              value={form.code}
              placeholder="R-02"
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          </Field>
          <Field id="run_shift" label="Shift" error={fieldErrors.shift_id}>
            <Select
              id="run_shift"
              placeholder="No shift (whole day)"
              value={form.shift_id}
              onChange={(event) => setForm({ ...form, shift_id: event.target.value })}
              options={shifts.map((shift) => ({
                value: shift.id,
                label: `${shift.name} (${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)})`,
              }))}
            />
          </Field>
          <Field id="run_bus" label="Bus" error={fieldErrors.bus_id}>
            <Select
              id="run_bus"
              placeholder="No bus yet"
              value={form.bus_id}
              onChange={(event) => setForm({ ...form, bus_id: event.target.value })}
              options={buses.map((bus) => ({
                value: bus.id,
                label: `${bus.bus_number ?? 'Bus'} · ${bus.registration_number}`,
              }))}
            />
          </Field>
          {selectedBusRuns.length > 0 ? (
            <p className="muted" role="status">
              Heads-up: this bus already runs {selectedBusRuns.map((run) => run.code).join(', ')}{' '}
              in an overlapping window — the server will reject that combination until the shift
              windows are disjoint.
            </p>
          ) : null}
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

      <Modal
        title={crewRun ? `Crew — run ${crewRun.code}` : 'Crew'}
        open={Boolean(crewRun)}
        onClose={() => setCrewRun(null)}
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Role</th>
                <th>Name</th>
                <th>Effective</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {crewRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.role === RunCrewRole.DRIVER ? 'Driver' : 'Conductor'}</td>
                  <td>{row.user_name ?? '—'}</td>
                  <td>
                    {row.effective_from}
                    {row.effective_to ? ` → ${row.effective_to}` : ' →'}
                  </td>
                  <td>
                    <Button variant="ghost" onClick={() => setPendingCrewDelete(row)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
              {crewRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    Nobody rostered on this run yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <form className="form-grid" onSubmit={(event) => void saveCrew(event)}>
          <Field id="crew_role" label="Role" error={fieldErrors.role}>
            <Select
              id="crew_role"
              value={crewForm.role}
              onChange={(event) =>
                setCrewForm({ ...crewForm, role: event.target.value as RunCrewRole })
              }
              options={[
                { value: RunCrewRole.DRIVER, label: 'Driver' },
                { value: RunCrewRole.CONDUCTOR, label: 'Conductor' },
              ]}
            />
          </Field>
          <Field id="crew_user" label="Person" error={fieldErrors.user_id}>
            <Select
              id="crew_user"
              placeholder="Select staff member"
              value={crewForm.user_id}
              onChange={(event) => setCrewForm({ ...crewForm, user_id: event.target.value })}
              options={crewStaff.map((staff) => ({ value: staff.id, label: staff.name }))}
            />
          </Field>
          <Field id="crew_from" label="Effective from" error={fieldErrors.effective_from}>
            <Input
              id="crew_from"
              type="date"
              value={crewForm.effective_from}
              onChange={(event) => setCrewForm({ ...crewForm, effective_from: event.target.value })}
            />
          </Field>
          <Field id="crew_to" label="Effective to" error={fieldErrors.effective_to}>
            <Input
              id="crew_to"
              type="date"
              value={crewForm.effective_to}
              onChange={(event) => setCrewForm({ ...crewForm, effective_to: event.target.value })}
            />
          </Field>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setCrewRun(null)} disabled={crewBusy}>
              Close
            </Button>
            <Button type="submit" disabled={crewBusy || !crewForm.user_id}>
              {crewBusy ? 'Saving…' : 'Roster'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Retire run?"
        message={
          pendingDelete
            ? `${pendingDelete.code} (${runLabel(pendingDelete)}) is removed from scheduling; riders fall back to the route default run. The default run itself cannot be retired.`
            : ''
        }
        confirmLabel="Retire"
        danger
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
      />
      <ConfirmDialog
        open={Boolean(pendingCrewDelete)}
        title="Remove roster row?"
        message="The mirrored route assignment is removed too."
        confirmLabel="Remove"
        danger
        busy={crewBusy}
        onCancel={() => setPendingCrewDelete(null)}
        onConfirm={() => void removeCrew()}
      />
    </Card>
  );
};
