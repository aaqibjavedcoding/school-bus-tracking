'use client';

import React, { useState } from 'react';
import {
  TripStatus,
  type TripResponse,
  type TripStatusUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { TRIP_STATUS_TRANSITIONS } from '@school-bus-tracking/validation';
import { apiClient } from '../../services/api';
import { getApiErrorMessage } from '../../lib/errors';
import { tripStatusLabel } from '../../lib/format';
import { Button, Field, Input, Modal, useToast } from '../../components/ui';

const ACTION_VARIANT: Partial<Record<TripStatus, 'primary' | 'success' | 'danger' | 'secondary'>> =
  {
    [TripStatus.BOARDING]: 'secondary',
    [TripStatus.IN_PROGRESS]: 'primary',
    [TripStatus.COMPLETED]: 'success',
    [TripStatus.CANCELLED]: 'danger',
  };

export const TripStatusActions: React.FC<{
  trip: TripResponse;
  large?: boolean;
  allowCancel?: boolean;
  onUpdated: (trip: TripResponse) => void;
}> = ({ trip, large = false, allowCancel = true, onUpdated }) => {
  const toast = useToast();
  const [busy, setBusy] = useState<TripStatus | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  const nextStatuses = TRIP_STATUS_TRANSITIONS[trip.status].filter(
    (status) => allowCancel || status !== TripStatus.CANCELLED,
  );

  const apply = async (status: TripStatus, extra: Partial<TripStatusUpdateRequest> = {}) => {
    setBusy(status);
    try {
      const envelope = await apiClient.updateTripStatus(trip.id, { status, ...extra });
      if (!envelope.data) throw new Error(envelope.message || 'Could not update trip');
      onUpdated(envelope.data);
      toast.push(`Trip is now ${tripStatusLabel(envelope.data.status).toLowerCase()}.`, 'success');
    } catch (error) {
      toast.push(getApiErrorMessage(error), 'danger');
    } finally {
      setBusy(null);
    }
  };

  if (nextStatuses.length === 0) {
    return <p className="muted">This trip is closed.</p>;
  }

  return (
    <>
      <div className={large ? 'crew-actions' : 'row'}>
        {nextStatuses.map((status) => (
          <Button
            key={status}
            variant={ACTION_VARIANT[status] ?? 'secondary'}
            size={large ? 'touch' : 'md'}
            disabled={busy !== null}
            onClick={() => {
              if (status === TripStatus.CANCELLED) {
                setCancelOpen(true);
                return;
              }
              void apply(status);
            }}
          >
            {busy === status ? 'Updating…' : tripStatusLabel(status)}
          </Button>
        ))}
      </div>
      <Modal
        title="Cancel this trip?"
        description="The run will stay in history as cancelled and live tracking will stop."
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
      >
        <Field id="cancel-reason" label="Reason (optional)">
          <Input
            id="cancel-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setCancelOpen(false)} disabled={busy !== null}>
            Keep trip
          </Button>
          <Button
            variant="danger"
            disabled={busy !== null}
            onClick={() => {
              void (async () => {
                await apply(TripStatus.CANCELLED, {
                  cancellation_reason: reason.trim() ? reason.trim() : undefined,
                });
                setCancelOpen(false);
                setReason('');
              })();
            }}
          >
            {busy === TripStatus.CANCELLED ? 'Cancelling…' : 'Cancel trip'}
          </Button>
        </div>
      </Modal>
    </>
  );
};
