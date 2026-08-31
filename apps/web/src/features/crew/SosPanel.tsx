'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  EMERGENCY_EVENTS,
  EMERGENCY_STATUS_LABELS,
  EMERGENCY_TYPE_LABELS,
  EMERGENCY_TYPE_VALUES,
  EmergencyStatus,
  EmergencyType,
  type EmergencyEventResponse,
} from '@school-bus-tracking/shared-types';
import { emergencySosSchema } from '@school-bus-tracking/validation';
import { Badge, Button, Card, Field, Modal, Select, Textarea, useToast } from '../../components/ui';
import { getApiErrorMessage, unwrapEnvelope } from '../../lib/errors';
import { formatRelative } from '../../lib/format';
import { apiClient } from '../../services/api';
import { getEmergenciesSocket } from '../../services/emergencies-socket';

/**
 * Crew emergency panel (Task 44) — the web counterpart of the mobile SOS tab.
 *
 * A driver or conductor raises an SOS here; the backend records it with its
 * own clock and broadcasts it to the school's Socket.IO room, so the admin
 * console sees it immediately. Delivery is entirely self-hosted: no SMS
 * gateway, WhatsApp or push vendor is involved anywhere in the flow.
 *
 * The position is **optional and never invented**: the browser's geolocation
 * is used when the crew grants it, otherwise the alert is recorded without
 * coordinates. An alert must always be possible, even without a fix.
 */

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
    default:
      return 'neutral';
  }
}

export const SosPanel: React.FC<{ tripId: string | null }> = ({ tripId }) => {
  const toast = useToast();
  const [history, setHistory] = useState<EmergencyEventResponse[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [type, setType] = useState<EmergencyType>(EmergencyType.ACCIDENT);
  const [message, setMessage] = useState('');

  const reload = useCallback(async () => {
    try {
      const list = unwrapEnvelope(await apiClient.listMyEmergencies({ limit: 5 }));
      setHistory(list.items);
    } catch {
      // The panel is an emergency affordance; a failed history load must never
      // block raising an alert, so it degrades to an empty list.
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Live status: the school acknowledging or resolving an alert shows up here
  // without a refresh (the gateway puts this socket in the tenant room).
  useEffect(() => {
    const socket = getEmergenciesSocket();
    socket.connect();
    socket.on(EMERGENCY_EVENTS.updated, () => void reload());
    return () => {
      socket.off(EMERGENCY_EVENTS.updated);
    };
  }, [reload]);

  const raise = () => {
    setBusy(true);
    void (async () => {
      try {
        const coordinates = await readPosition();
        const parsed = emergencySosSchema.safeParse({
          trip_id: tripId,
          type,
          message: message.trim() || null,
          ...coordinates,
        });
        if (!parsed.success) {
          toast.push(parsed.error.issues[0]?.message ?? 'Invalid emergency', 'danger');
          return;
        }
        unwrapEnvelope(await apiClient.raiseSos(parsed.data));
        toast.push('SOS sent. The school has been alerted.', 'success');
        setConfirming(false);
        setMessage('');
        await reload();
      } catch (caught) {
        toast.push(getApiErrorMessage(caught), 'danger');
      } finally {
        setBusy(false);
      }
    })();
  };

  const cancel = (event: EmergencyEventResponse) => {
    setBusy(true);
    void (async () => {
      try {
        unwrapEnvelope(await apiClient.cancelMyEmergency(event.id));
        toast.push('Alert cancelled.', 'success');
        await reload();
      } catch (caught) {
        toast.push(getApiErrorMessage(caught), 'danger');
      } finally {
        setBusy(false);
      }
    })();
  };

  const open = history.filter(
    (event) =>
      event.status === EmergencyStatus.OPEN || event.status === EmergencyStatus.ACKNOWLEDGED,
  );

  return (
    <Card
      title="Emergency SOS"
      description="Alerts the school office immediately. Use it for accidents, breakdowns, medical incidents or anything that puts students at risk."
    >
      {open.length > 0 ? (
        <div className="row" style={{ marginBottom: '0.75rem' }}>
          <Badge tone={statusTone(open[0].status)}>{EMERGENCY_STATUS_LABELS[open[0].status]}</Badge>
          <span className="muted">
            {EMERGENCY_TYPE_LABELS[open[0].type]} · {formatRelative(open[0].triggered_at)}
          </span>
          <Button variant="ghost" onClick={() => cancel(open[0])} disabled={busy}>
            Cancel alert
          </Button>
        </div>
      ) : null}

      <Button onClick={() => setConfirming(true)} disabled={busy}>
        Send SOS
      </Button>

      {history.length > 0 ? (
        <div style={{ marginTop: '1rem' }}>
          <h3 style={{ fontSize: '0.9rem' }}>Your recent alerts</h3>
          <ul className="muted" style={{ paddingLeft: '1.1rem', marginTop: '0.4rem' }}>
            {history.map((event) => (
              <li key={event.id}>
                {EMERGENCY_TYPE_LABELS[event.type]} · {EMERGENCY_STATUS_LABELS[event.status]} ·{' '}
                {formatRelative(event.triggered_at)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Modal
        open={confirming}
        title="Send an emergency alert?"
        onClose={() => setConfirming(false)}
      >
        <p className="muted">
          The school is notified instantly and can see the alert, the trip and your last known
          position.
        </p>
        <Field id="sos-type" label="What is happening?">
          <Select
            id="sos-type"
            value={type}
            options={EMERGENCY_TYPE_VALUES.map((value) => ({
              value,
              label: EMERGENCY_TYPE_LABELS[value],
            }))}
            onChange={(event) => setType(event.target.value as EmergencyType)}
          />
        </Field>
        <Field
          id="sos-message"
          label="Message"
          hint="Optional — anything the school should know straight away."
        >
          <Textarea
            id="sos-message"
            rows={3}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="e.g. Bus hit a divider, all students safe."
          />
        </Field>
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={raise} disabled={busy}>
            {busy ? 'Sending…' : 'Send SOS'}
          </Button>
        </div>
      </Modal>
    </Card>
  );
};

/**
 * Best-effort browser position.
 *
 * Resolves to `{}` when geolocation is unavailable, denied or too slow — an
 * SOS must never be blocked by a missing fix, and a fallback coordinate is
 * never invented.
 */
async function readPosition(): Promise<{
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return {};
  }
  return new Promise((resolve) => {
    const done = (value: { latitude?: number; longitude?: number; accuracy?: number }) =>
      resolve(value);
    const timer = setTimeout(() => done({}), 5_000);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        done({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      () => {
        clearTimeout(timer);
        done({});
      },
      { enableHighAccuracy: true, timeout: 5_000, maximumAge: 30_000 },
    );
  });
}
