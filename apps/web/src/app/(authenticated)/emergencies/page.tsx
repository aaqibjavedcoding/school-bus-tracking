'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  EMERGENCY_EVENTS,
  EMERGENCY_STATUS_LABELS,
  EMERGENCY_STATUS_VALUES,
  EMERGENCY_TYPE_LABELS,
  EMERGENCY_TYPE_VALUES,
  EmergencyStatus,
  EmergencyType,
  type EmergencyEventResponse,
} from '@school-bus-tracking/shared-types';
import { emergencyStatusUpdateSchema } from '@school-bus-tracking/validation';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Pagination,
  Skeleton,
  Textarea,
  useToast,
} from '../../../components/ui';
import { useLoad } from '../../../hooks/useLoad';
import { getApiErrorMessage, unwrapEnvelope } from '../../../lib/errors';
import { formatDateTime, formatRelative } from '../../../lib/format';
import { apiClient } from '../../../services/api';
import { getEmergenciesSocket } from '../../../services/emergencies-socket';
import { connectAuthenticatedSocket } from '../../../services/socket-auth';
import {
  describeEmergencyAlarm,
  normalizeEmergencyEvent,
} from '../../../features/emergencies/helpers';

/**
 * School-admin emergency console (Task 44).
 *
 * Every SOS a driver or conductor raises from the mobile app lands here: the
 * open incidents first, then the full history with who handled what and when.
 *
 * The list refreshes live over the self-hosted `/emergencies` Socket.IO
 * namespace (the gateway places this socket in the school's own room), and
 * falls back to the persisted rows when the socket is unavailable — the REST
 * record is always the source of truth.
 *
 * No SMS gateway, push vendor or any other paid third party is involved:
 * delivery is first-party (database + Socket.IO) end to end.
 */

type Transition = 'ACKNOWLEDGED' | 'RESOLVED' | 'CANCELLED';

/** Badge tone of an emergency lifecycle state. */
function statusTone(
  status: EmergencyStatus,
): 'neutral' | 'info' | 'warning' | 'success' | 'danger' {
  switch (status) {
    case EmergencyStatus.OPEN:
      return 'danger';
    case EmergencyStatus.ACKNOWLEDGED:
      return 'warning';
    case EmergencyStatus.RESOLVED:
      return 'success';
    case EmergencyStatus.CANCELLED:
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** Transitions the school may still apply to an event. */
function nextTransitions(status: EmergencyStatus): Transition[] {
  switch (status) {
    case EmergencyStatus.OPEN:
      return ['ACKNOWLEDGED', 'RESOLVED', 'CANCELLED'];
    case EmergencyStatus.ACKNOWLEDGED:
      return ['RESOLVED', 'CANCELLED'];
    default:
      return [];
  }
}

export default function EmergenciesPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<EmergencyStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<EmergencyType | ''>('');
  const [live, setLive] = useState(false);
  const [pending, setPending] = useState<{
    event: EmergencyEventResponse;
    status: Transition;
  } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const query: Parameters<typeof apiClient.listEmergencies>[0] = { page, limit: 20 };
    if (statusFilter) query.status = statusFilter;
    if (typeFilter) query.type = typeFilter;
    const [history, active] = await Promise.all([
      apiClient.listEmergencies(query),
      apiClient.listActiveEmergencies(),
    ]);
    return {
      history: unwrapEnvelope(history),
      active: unwrapEnvelope(active),
    };
  }, [page, statusFilter, typeFilter]);

  const { data, loading, error, reload } = useLoad(load, [load]);

  // Live refresh: the gateway pushes every new SOS and every status change to
  // this school's room, so the console updates without a page reload.
  useEffect(() => {
    const socket = getEmergenciesSocket();
    const onConnect = () => setLive(true);
    const onDisconnect = () => setLive(false);
    // A new SOS is the alarm case. The top-bar siren
    // (`features/emergencies`) sounds it wherever the admin is; here the
    // console says *what* was raised instead of a generic "updated" line.
    const onNew = (payload: unknown) => {
      void reload();
      const event = normalizeEmergencyEvent(payload);
      toast.push(
        event ? `SOS — ${describeEmergencyAlarm(event)}` : 'A new emergency was raised.',
        'danger',
      );
    };
    const onUpdated = () => {
      void reload();
      toast.push('An emergency event was updated.', 'info');
    };
    connectAuthenticatedSocket(socket);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(EMERGENCY_EVENTS.new, onNew);
    socket.on(EMERGENCY_EVENTS.updated, onUpdated);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(EMERGENCY_EVENTS.new, onNew);
      socket.off(EMERGENCY_EVENTS.updated, onUpdated);
    };
  }, [reload, toast]);

  const applyTransition = () => {
    if (!pending) return;
    const parsed = emergencyStatusUpdateSchema.safeParse({
      status: pending.status,
      note: note.trim() || null,
    });
    if (!parsed.success) {
      toast.push(parsed.error.issues[0]?.message ?? 'Invalid status change', 'danger');
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        unwrapEnvelope(await apiClient.updateEmergencyStatus(pending.event.id, parsed.data));
        toast.push(
          `Marked as ${EMERGENCY_STATUS_LABELS[pending.status].toLowerCase()}.`,
          'success',
        );
        setPending(null);
        setNote('');
        await reload();
      } catch (caught) {
        toast.push(getApiErrorMessage(caught), 'danger');
      } finally {
        setBusy(false);
      }
    })();
  };

  if (loading && !data) {
    return (
      <div className="page">
        <Skeleton lines={12} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <ErrorState
          message={error || 'Could not load emergency events'}
          onRetry={() => void reload()}
        />
      </div>
    );
  }

  const active = data.active.items;

  return (
    <div className="page">
      <PageHeader
        title="Emergencies"
        description="SOS alerts raised by your drivers and conductors. Delivery is first-party — in-app socket and database only, no paid SMS or push provider."
        actions={<Badge tone={live ? 'success' : 'neutral'}>{live ? 'Live' : 'Offline'}</Badge>}
      />

      <Card title="Needs attention" description="Everything still open or acknowledged.">
        {active.length === 0 ? (
          <EmptyState
            title="No open emergencies"
            description="When a crew member raises an SOS it appears here immediately."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Raised</th>
                  <th>Crew</th>
                  <th>Type</th>
                  <th>Bus / route</th>
                  <th>Message</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {active.map((event) => (
                  <tr key={event.id}>
                    <td>{formatRelative(event.triggered_at)}</td>
                    <td>
                      <strong>{event.raised_by_name ?? 'Crew member'}</strong>
                      <span className="muted"> · {event.raised_by_role ?? '—'}</span>
                    </td>
                    <td>{EMERGENCY_TYPE_LABELS[event.type]}</td>
                    <td>
                      {event.bus_registration_number ?? '—'}
                      {event.route_name ? ` · ${event.route_name}` : ''}
                    </td>
                    <td>{event.message || '—'}</td>
                    <td>
                      <Badge tone={statusTone(event.status)}>
                        {EMERGENCY_STATUS_LABELS[event.status]}
                      </Badge>
                    </td>
                    <td>
                      <div className="row">
                        {nextTransitions(event.status).map((status) => (
                          <Button
                            key={status}
                            variant={status === 'ACKNOWLEDGED' ? 'primary' : 'ghost'}
                            onClick={() => {
                              setNote('');
                              setPending({ event, status });
                            }}
                          >
                            {EMERGENCY_STATUS_LABELS[status]}
                          </Button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="History" description="Every emergency event of the school, newest first.">
        <div className="row" style={{ marginBottom: '0.85rem' }}>
          <Field id="status-filter" label="Status">
            <select
              id="status-filter"
              className="select"
              value={statusFilter}
              onChange={(event) => {
                setPage(1);
                setStatusFilter(event.target.value as EmergencyStatus | '');
              }}
            >
              <option value="">All statuses</option>
              {EMERGENCY_STATUS_VALUES.map((value) => (
                <option key={value} value={value}>
                  {EMERGENCY_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="type-filter" label="Type">
            <select
              id="type-filter"
              className="select"
              value={typeFilter}
              onChange={(event) => {
                setPage(1);
                setTypeFilter(event.target.value as EmergencyType | '');
              }}
            >
              <option value="">All types</option>
              {EMERGENCY_TYPE_VALUES.map((value) => (
                <option key={value} value={value}>
                  {EMERGENCY_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {data.history.items.length === 0 ? (
          <EmptyState title="No emergency events" description="Nothing has been raised yet." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Raised</th>
                  <th>Crew</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Handled</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {data.history.items.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.triggered_at)}</td>
                    <td>{event.raised_by_name ?? 'Crew member'}</td>
                    <td>{EMERGENCY_TYPE_LABELS[event.type]}</td>
                    <td>
                      <Badge tone={statusTone(event.status)}>
                        {EMERGENCY_STATUS_LABELS[event.status]}
                      </Badge>
                    </td>
                    <td>
                      {event.acknowledged_at
                        ? `Acknowledged ${formatRelative(event.acknowledged_at)}`
                        : '—'}
                      {event.resolved_at ? ` · Closed ${formatRelative(event.resolved_at)}` : ''}
                      {event.acknowledged_by_name || event.resolved_by_name
                        ? ` by ${event.resolved_by_name ?? event.acknowledged_by_name}`
                        : ''}
                    </td>
                    <td>{event.resolution_note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={data.history.meta.page}
          totalPages={data.history.meta.totalPages}
          hasNextPage={data.history.meta.hasNextPage}
          hasPreviousPage={data.history.meta.hasPreviousPage}
          onPage={setPage}
        />
      </Card>

      <Modal
        open={Boolean(pending)}
        title={pending ? `${EMERGENCY_STATUS_LABELS[pending.status]} this emergency?` : ''}
        onClose={() => setPending(null)}
      >
        <p className="muted">
          {pending
            ? `${EMERGENCY_TYPE_LABELS[pending.event.type]} raised by ${
                pending.event.raised_by_name ?? 'a crew member'
              } on ${formatDateTime(pending.event.triggered_at)}.`
            : ''}
        </p>
        <Field
          id="emergency-note"
          label="Note"
          hint="Recorded with the status change and visible in the history."
        >
          <Textarea
            id="emergency-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. School van dispatched, all students safe."
          />
        </Field>
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={applyTransition} disabled={busy}>
            {busy ? 'Saving…' : 'Confirm'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
