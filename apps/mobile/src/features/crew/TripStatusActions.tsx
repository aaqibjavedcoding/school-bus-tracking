import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TripStatus, type TripResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../services/api';
import { getApiErrorMessage, unwrapEnvelope } from '../../lib/errors';
import { Button, Field } from '../../components';
import { nextCrewTransitions, transitionLabel } from './crew-trip';

/**
 * Trip lifecycle actions (crew + admin).
 *
 * One request performs exactly one validated transition on the existing
 * `PATCH /trips/:id/status` endpoint; the server stamps times and notifies
 * parents. Crew only sees the forward path; `allowCancel` additionally
 * exposes the dispatcher's cancel flow with a reason.
 */
export const TripStatusActions: React.FC<{
  trip: TripResponse;
  allowCancel?: boolean;
  onApplied: (trip: TripResponse) => void;
}> = ({ trip, allowCancel = false, onApplied }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const terminal = trip.status === TripStatus.COMPLETED || trip.status === TripStatus.CANCELLED;
  const transitions = nextCrewTransitions(trip.status);

  const apply = async (next: TripStatus) => {
    setBusy(true);
    setError(null);
    try {
      const envelope = await apiClient.updateTripStatus(trip.id, { status: next });
      onApplied(unwrapEnvelope(envelope));
    } catch (caught) {
      setError(getApiErrorMessage(caught, 'Could not update the trip.'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (reason.trim().length === 0) {
      setError('A cancellation reason is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const envelope = await apiClient.cancelTrip(trip.id, { cancellation_reason: reason.trim() });
      setCancelling(false);
      setReason('');
      onApplied(unwrapEnvelope(envelope));
    } catch (caught) {
      setError(getApiErrorMessage(caught, 'Could not cancel the trip.'));
    } finally {
      setBusy(false);
    }
  };

  if (terminal) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.terminalNote}>
          {trip.status === TripStatus.COMPLETED
            ? 'This trip is completed.'
            : `This trip was cancelled${trip.cancellation_reason ? `: ${trip.cancellation_reason}` : '.'}`}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {transitions.map((next) => (
        <Button
          key={next}
          label={transitionLabel(next)}
          onPress={() => void apply(next)}
          disabled={busy}
          busy={busy && !cancelling && transitions.length === 1}
          style={styles.action}
        />
      ))}

      {allowCancel && !cancelling ? (
        <Button
          label="Cancel trip…"
          variant="ghost"
          small
          onPress={() => setCancelling(true)}
          disabled={busy}
          style={styles.action}
        />
      ) : null}

      {cancelling ? (
        <View style={styles.cancelBox}>
          <Field
            label="Cancellation reason"
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Vehicle fault"
            multiline
          />
          <View style={styles.cancelRow}>
            <Button
              label="Confirm cancellation"
              variant="danger"
              onPress={() => void cancel()}
              disabled={busy}
              busy={busy}
            />
            <Button
              label="Keep trip"
              variant="secondary"
              onPress={() => {
                setCancelling(false);
                setReason('');
              }}
              disabled={busy}
            />
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  action: {
    flexGrow: 1,
  },
  terminalNote: {
    color: colors.neutral[500],
    fontSize: 14,
    textAlign: 'center',
  },
  cancelBox: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cancelRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  error: {
    color: colors.status.danger,
    fontSize: 13,
  },
});
