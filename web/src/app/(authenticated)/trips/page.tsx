'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { ExportDataset, TripStatus, type TripResponse } from '@school-bus-tracking/shared-types';
import { tripCreateSchema } from '@school-bus-tracking/validation';
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
  Select,
  Skeleton,
  useToast,
} from '../../../components/ui';
import { ExportButton } from '../../../features/data-transfer';
import { useLoad } from '../../../hooks/useLoad';
import { usePagedResource } from '../../../hooks/usePagedResource';
import { dispatchableRuns, runLabel, tripRunBadge } from '../../../features/runs/helpers';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../lib/errors';
import {
  formatDateTime,
  fromDateTimeLocalValue,
  tripStatusLabel,
  tripStatusTone,
  utcDateOnly,
} from '../../../lib/format';
import { apiClient } from '../../../services/api';

export default function TripsPage() {
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState(utcDateOnly());
  const [open, setOpen] = useState(false);
  // The assignment/run pickers are only rendered inside the "Schedule trip"
  // modal — gate the lookup on it instead of fetching on every page mount.
  // Data stays cached in the hook once fetched.
  const lookups = useLoad(
    async () => {
      const [assignments, runs] = await Promise.all([
        apiClient.listRouteAssignments({ page: 1, limit: 100, is_active: true }),
        apiClient.listRuns({ page: 1, limit: 100 }),
      ]);
      return {
        assignments: unwrapEnvelope(assignments).items,
        runs: dispatchableRuns(unwrapEnvelope(runs).items),
      };
    },
    [],
    { enabled: open },
  );
  const list = usePagedResource(
    async (page, search) =>
      unwrapEnvelope(
        await apiClient.listTrips({
          page,
          limit: 20,
          search,
          status: statusFilter ? (statusFilter as TripStatus) : undefined,
          date: dateFilter || undefined,
        }),
      ),
    [statusFilter, dateFilter],
  );
  const [form, setForm] = useState({
    route_assignment_id: '',
    run_id: '',
    scheduled_start_at: '',
    scheduled_end_at: '',
  });
  // Dispatch source (§8.4): runs are the preferred path, legacy assignments
  // remain available verbatim. A tenant without runs simply never sees the
  // Run option enabled, so nothing changes for existing schedules.
  const [source, setSource] = useState<'run' | 'legacy'>('run');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TripResponse | null>(null);
  const runs = lookups.data?.runs ?? [];

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const effectiveSource = source === 'run' && runs.length > 0 ? 'run' : 'legacy';
    const payload = {
      // Exactly one source key survives — the create schema is strict and
      // rejects payloads carrying both.
      ...(effectiveSource === 'run'
        ? form.run_id
          ? { run_id: form.run_id }
          : {}
        : form.route_assignment_id
          ? { route_assignment_id: form.route_assignment_id }
          : {}),
      scheduled_start_at: form.scheduled_start_at
        ? fromDateTimeLocalValue(form.scheduled_start_at)
        : '',
      scheduled_end_at: form.scheduled_end_at
        ? fromDateTimeLocalValue(form.scheduled_end_at)
        : null,
    };
    const parsed = tripCreateSchema.safeParse({
      ...payload,
      scheduled_end_at: emptyToNull(payload.scheduled_end_at ?? ''),
    });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      unwrapEnvelope(await apiClient.createTrip(parsed.data));
      toast.push('Trip scheduled.', 'success');
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
      await apiClient.deleteTrip(pendingDelete.id);
      toast.push('Trip deleted.', 'success');
      setPendingDelete(null);
      await list.reload();
    } catch (error) {
      toast.push(getApiErrorMessage(error), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const routeName = (trip: TripResponse) =>
    trip.route_name ? `${trip.route_code ?? ''} — ${trip.route_name}`.replace(/^ — /, '') : 'Route unavailable';
  const busLabel = (trip: TripResponse) =>
    trip.bus_number ?? trip.registration_number ?? 'No bus';
  const crewLabel = (driver: string | null | undefined, conductor: string | null | undefined) => {
    if (driver && conductor) return `${driver} · ${conductor}`;
    return driver ?? conductor ?? '—';
  };

  return (
    <div className="page">
      <PageHeader
        title="Trips"
        description="Dispatch a run from an active assignment."
        actions={
          <>
            <Button onClick={() => setOpen(true)}>Schedule trip</Button>
            <ExportButton
              dataset={ExportDataset.TRIPS}
              query={{
                search: list.search || undefined,
                status: statusFilter || undefined,
                date_from: dateFilter || undefined,
                date_to: dateFilter || undefined,
              }}
            />
          </>
        }
      />
      <div className="toolbar">
        <SearchInput
          value={list.search}
          searching={list.searching}
          onChange={list.setSearch}
          placeholder="Search route, bus or crew"
        />
        <Input
          type="date"
          value={dateFilter}
          onChange={(event) => setDateFilter(event.target.value)}
        />
        <Select
          value={statusFilter}
          placeholder="All statuses"
          onChange={(event) => setStatusFilter(event.target.value)}
          options={Object.values(TripStatus).map((status) => ({
            value: status,
            label: tripStatusLabel(status),
          }))}
        />
      </div>
      {list.loading ? (
        <Skeleton lines={8} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={() => void list.reload()} />
      ) : list.items.length === 0 ? (
        <EmptyState
          title={list.search ? 'No matching trips' : 'No trips'}
          description={
            list.search
              ? 'No trips match your search. Try a different term or clear it.'
              : 'Schedule a trip from an active driver or conductor assignment.'
          }
          action={
            list.search ? (
              <Button variant="secondary" onClick={() => list.setSearch('')}>
                Clear search
              </Button>
            ) : (
              <Button onClick={() => setOpen(true)}>Schedule trip</Button>
            )
          }
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Start</th>
                  <th>Route</th>
                  <th>Bus</th>
                  <th>Driver · Conductor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((trip) => (
                  <tr key={trip.id}>
                    <td>
                      <Badge tone={tripStatusTone(trip.status)}>
                        {tripStatusLabel(trip.status)}
                      </Badge>
                    </td>
                    <td>{formatDateTime(trip.scheduled_start_at)}</td>
                    <td>
                      {routeName(trip)}{' '}
                      {tripRunBadge(trip) ? <Badge tone="neutral">{tripRunBadge(trip)}</Badge> : null}
                    </td>
                    <td>{busLabel(trip)}</td>
                    <td>{crewLabel(trip.driver_name, trip.conductor_name)}</td>
                    <td>
                      <div className="table-actions">
                        <Link className="btn btn-secondary" href={`/trips/${trip.id}`}>
                          Open
                        </Link>
                        <Button variant="ghost" onClick={() => setPendingDelete(trip)}>
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
      <Modal title="Schedule trip" open={open} onClose={() => setOpen(false)}>
        <form className="form-grid" onSubmit={(event) => void save(event)}>
          <div className="table-actions" role="radiogroup" aria-label="Dispatch source">
            <Button
              variant={source === 'run' ? 'primary' : 'secondary'}
              type="button"
              disabled={runs.length === 0}
              onClick={() => setSource('run')}
            >
              From a run
            </Button>
            <Button
              variant={source === 'legacy' ? 'primary' : 'secondary'}
              type="button"
              onClick={() => setSource('legacy')}
            >
              From an assignment (legacy)
            </Button>
          </div>
          {source === 'run' && runs.length === 0 ? (
            <p className="muted" role="status">
              This school has no active runs yet, so scheduling falls back to a legacy
              route assignment.
            </p>
          ) : null}
          {source === 'run' && runs.length > 0 ? (
            <Field id="run_id" label="Run" error={fieldErrors.run_id}>
              <Select
                id="run_id"
                placeholder="Select run"
                value={form.run_id}
                onChange={(event) => setForm({ ...form, run_id: event.target.value })}
                options={runs.map((run) => ({ value: run.id, label: runLabel(run) }))}
              />
            </Field>
          ) : (
            <Field
              id="route_assignment_id"
              label="Assignment"
              error={fieldErrors.route_assignment_id}
            >
              <Select
                id="route_assignment_id"
                placeholder="Select assignment"
                value={form.route_assignment_id}
                onChange={(event) => setForm({ ...form, route_assignment_id: event.target.value })}
                options={(lookups.data?.assignments ?? []).map((assignment) => ({
                  value: assignment.id,
                  label: `${assignment.route_code ?? 'Route'} — ${assignment.route_name ?? ''} · ${assignment.bus_number ?? assignment.bus_registration_number ?? 'No bus'} · ${assignment.role.toLowerCase()}`,
                }))}
              />
            </Field>
          )}
          <Field
            id="scheduled_start_at"
            label="Scheduled start"
            error={fieldErrors.scheduled_start_at}
          >
            <Input
              id="scheduled_start_at"
              type="datetime-local"
              value={form.scheduled_start_at}
              onChange={(event) => setForm({ ...form, scheduled_start_at: event.target.value })}
            />
          </Field>
          <Field id="scheduled_end_at" label="Scheduled end" error={fieldErrors.scheduled_end_at}>
            <Input
              id="scheduled_end_at"
              type="datetime-local"
              value={form.scheduled_end_at}
              onChange={(event) => setForm({ ...form, scheduled_end_at: event.target.value })}
            />
          </Field>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Schedule'}
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete trip?"
        message="Open trips are cancelled first, then removed from the active list."
        confirmLabel="Delete"
        danger
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
