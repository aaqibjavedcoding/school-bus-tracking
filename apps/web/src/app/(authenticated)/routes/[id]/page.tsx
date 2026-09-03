'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useState } from 'react';
import {
  ExportDataset,
  ImportModule,
  type StopCreateRequest,
  type StopResponse,
  type StopUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { stopCreateSchema, stopUpdateSchema } from '@school-bus-tracking/validation';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Skeleton,
  useToast,
} from '../../../../components/ui';
import { ListActions } from '../../../../features/data-transfer';
import { useLoad } from '../../../../hooks/useLoad';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../../lib/errors';
import { stopCode } from '../../../../lib/format';
import { apiClient } from '../../../../services/api';

const emptyStop = {
  name: '',
  address: '',
  latitude: '',
  longitude: '',
  geofence_radius_meters: '100',
  estimated_arrival_time: '',
  is_active: true,
};

export default function RouteDetailPage() {
  const params = useParams<{ id: string }>();
  const toast = useToast();
  const { data, loading, error, reload, setData } = useLoad(async () => {
    const [route, stops] = await Promise.all([
      apiClient.getRoute(params.id),
      apiClient.listRouteStops(params.id),
    ]);
    return { route: unwrapEnvelope(route), stops: unwrapEnvelope(stops).items };
  }, [params.id]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StopResponse | null>(null);
  const [form, setForm] = useState(emptyStop);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StopResponse | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(emptyStop);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (stop: StopResponse) => {
    setEditing(stop);
    setForm({
      name: stop.name,
      address: stop.address ?? '',
      latitude: stop.latitude == null ? '' : String(stop.latitude),
      longitude: stop.longitude == null ? '' : String(stop.longitude),
      geofence_radius_meters: String(stop.geofence_radius_meters),
      estimated_arrival_time: stop.estimated_arrival_time ?? '',
      is_active: stop.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const toStopBody = (): StopCreateRequest => ({
    route_id: params.id,
    name: form.name.trim(),
    address: emptyToNull(form.address),
    latitude: form.latitude.trim() ? Number(form.latitude) : null,
    longitude: form.longitude.trim() ? Number(form.longitude) : null,
    geofence_radius_meters: form.geofence_radius_meters
      ? Number(form.geofence_radius_meters)
      : undefined,
    estimated_arrival_time: emptyToNull(form.estimated_arrival_time),
    is_active: form.is_active,
  });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = toStopBody();
    const parsed = editing
      ? stopUpdateSchema.safeParse(payload)
      : stopCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        unwrapEnvelope(await apiClient.updateStop(editing.id, parsed.data as StopUpdateRequest));
        toast.push('Stop updated.', 'success');
      } else {
        unwrapEnvelope(await apiClient.createStop(parsed.data as StopCreateRequest));
        toast.push('Stop added.', 'success');
      }
      setOpen(false);
      await reload();
    } catch (caught) {
      setFieldErrors(fieldErrorsFromUnknown(caught));
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    if (!data) return;
    const snapshot = data;
    const next = snapshot.stops.slice();
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [removed] = next.splice(index, 1);
    next.splice(target, 0, removed);
    setData({ ...snapshot, stops: next });
    try {
      const envelope = await apiClient.reorderRouteStops(params.id, {
        stop_ids: next.map((stop) => stop.id),
      });
      setData((prev) => (prev ? { ...prev, stops: unwrapEnvelope(envelope).items } : prev));
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
      setData(snapshot);
      await reload();
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await apiClient.deleteStop(pendingDelete.id);
      toast.push('Stop removed.', 'success');
      setPendingDelete(null);
      await reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="page">
        <Skeleton lines={8} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <ErrorState message={error || 'Route not found'} onRetry={() => void reload()} />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title={data.route.name}
        description={`Code ${data.route.code}${data.route.description ? ` · ${data.route.description}` : ''}`}
        actions={
          <>
            <Link className="btn btn-secondary" href="/routes">
              All routes
            </Link>
            <ListActions
              dataset={ExportDataset.STOPS}
              importModule={ImportModule.STOPS}
              query={{ route_id: data.route.id }}
            >
              <Button onClick={startCreate}>Add stop</Button>
            </ListActions>
          </>
        }
      />
      <Card title="Stops" description="Order is the boarding sequence used for trip manifests.">
        {data.stops.length === 0 ? (
          <p className="muted">No stops yet. Add the first boarding point.</p>
        ) : (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Coordinates</th>
                  <th>ETA</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.stops.map((stop, index) => (
                  <tr key={stop.id}>
                    <td>{stop.sequence_number}</td>
                    <td>{stopCode(data.route.code, stop.sequence_number)}</td>
                    <td>
                      {stop.name} {!stop.is_active ? <Badge tone="neutral">Inactive</Badge> : null}
                    </td>
                    <td>
                      {stop.latitude != null && stop.longitude != null
                        ? `${stop.latitude.toFixed(5)}, ${stop.longitude.toFixed(5)}`
                        : '—'}
                    </td>
                    <td>{stop.estimated_arrival_time || '—'}</td>
                    <td>
                      <div className="table-actions">
                        <Button
                          variant="secondary"
                          onClick={() => void move(index, -1)}
                          disabled={index === 0}
                        >
                          Up
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void move(index, 1)}
                          disabled={index === data.stops.length - 1}
                        >
                          Down
                        </Button>
                        <Button variant="ghost" onClick={() => startEdit(stop)}>
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => setPendingDelete(stop)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal title={editing ? 'Edit stop' : 'Add stop'} open={open} onClose={() => setOpen(false)}>
        <form className="form-grid" onSubmit={(event) => void save(event)}>
          <Field id="stop_name" label="Name" error={fieldErrors.name}>
            <Input
              id="stop_name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field id="address" label="Address" error={fieldErrors.address}>
            <Input
              id="address"
              value={form.address}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
            />
          </Field>
          <div className="grid grid-2">
            <Field id="latitude" label="Latitude" error={fieldErrors.latitude}>
              <Input
                id="latitude"
                value={form.latitude}
                onChange={(event) => setForm({ ...form, latitude: event.target.value })}
              />
            </Field>
            <Field id="longitude" label="Longitude" error={fieldErrors.longitude}>
              <Input
                id="longitude"
                value={form.longitude}
                onChange={(event) => setForm({ ...form, longitude: event.target.value })}
              />
            </Field>
          </div>
          <Field
            id="geofence"
            label="Geofence radius (m)"
            error={fieldErrors.geofence_radius_meters}
          >
            <Input
              id="geofence"
              type="number"
              value={form.geofence_radius_meters}
              onChange={(event) => setForm({ ...form, geofence_radius_meters: event.target.value })}
            />
          </Field>
          <Field
            id="eta"
            label="Estimated arrival (HH:MM)"
            error={fieldErrors.estimated_arrival_time}
          >
            <Input
              id="eta"
              value={form.estimated_arrival_time}
              onChange={(event) => setForm({ ...form, estimated_arrival_time: event.target.value })}
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
        title="Delete stop?"
        message={pendingDelete ? `${pendingDelete.name} will be removed from this route.` : ''}
        confirmLabel="Delete"
        danger
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
