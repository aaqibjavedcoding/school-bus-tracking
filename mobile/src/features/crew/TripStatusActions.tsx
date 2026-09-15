import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TripStatus, type TripResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../services/api';
import { getApiErrorMessage, unwrapEnvelope } from '../../lib/errors';
import { generateIdempotencyKey } from '../../lib/idempotency';
import { withIdempotencyKey } from '@school-bus-tracking/api-client';
import { Button, Field } from '../../components';
import { nextCrewTransitions, transitionLabel } from './crew-trip';
import { transitionActionMeta } from './crew-action-meta';
import { useOfflineAction } from './offline/useOfflineAction';
import { useAuth } from '../auth/AuthProvider';
import { t } from '../../lib/i18n.ts';
import { feedback, type CrewFeedbackEvent } from './crew-feedback.ts';

/**
 * The spoken/vibration confirmation for a lifecycle transition (Phase 3b).
 * `null` = no confirmation: `SCHEDULED` is never a crew transition and
 * `CANCELLED` is the dispatcher's flow on a screen the crew does not use.
 */
const TRIP_FEEDBACK_EVENT: Record<TripStatus, CrewFeedbackEvent | null> = {
  [TripStatus.SCHEDULED]: null,
  [TripStatus.BOARDING]: 'trip.boarding',
  [TripStatus.IN_PROGRESS]: 'trip.inProgress',
  [TripStatus.COMPLETED]: 'trip.completed',
  [TripStatus.CANCELLED]: null,
};

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
  /**
   * Queue the transition when offline (crew screens). Admin screens leave
   * this off: a dispatcher's status change is not a field action.
   */
  offlineCapable?: boolean;
  onApplied: (trip: TripResponse) => void;
  /** Called instead of `onApplied` when the transition was queued offline. */
  onQueued?: (status: TripStatus) => void;
}> = ({ trip, allowCancel = false, offlineCapable = false, onApplied, onQueued }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedNote, setQueuedNote] = useState<string | null>(null);
  const offline = useOfflineAction();
  const { user } = useAuth();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const terminal = trip.status === TripStatus.COMPLETED || trip.status === TripStatus.CANCELLED;
  const transitions = nextCrewTransitions(trip.status);

  const apply = async (next: TripStatus) => {
    setBusy(true);
    setError(null);
    setQueuedNote(null);
    try {
      if (offlineCapable) {
        // The key comes from the queue reservation so an offline replay is
        // a dedupe hit of this very request, never a second transition.
        // Held on an object so the compiler does not narrow it to `null` at
        // the declaration site — the queue writes it from inside the callback.
        const outcome: { trip: TripResponse | null } = { trip: null };
        const result = await offline.execute(
          { kind: 'trip_status', userId: user?.id ?? null, tripId: trip.id, tripStatus: next },
          async (key) => {
            outcome.trip = unwrapEnvelope(
              await apiClient.updateTripStatus(trip.id, { status: next }, withIdempotencyKey(key)),
            );
          },
        );
        if (result.mode === 'queued') {
          setQueuedNote(t('trip.queuedNote', { action: transitionLabel(next) }));
          onQueued?.(next);
          return;
        }
        if (outcome.trip) {
          // Phase 3b: the transition is the crew's biggest state change, so it
          // gets a medium tap and a spoken line even with the screen face-down.
          const event = TRIP_FEEDBACK_EVENT[outcome.trip.status];
          if (event) feedback.on(event);
          onApplied(outcome.trip);
        }
        return;
      }
      // One key per press: a retried transition (flaky network, the client's
      // own 401-refresh replay) replays instead of double-applying.
      const envelope = await apiClient.updateTripStatus(
        trip.id,
        { status: next },
        withIdempotencyKey(generateIdempotencyKey()),
      );
      const updated = unwrapEnvelope(envelope);
      const event = TRIP_FEEDBACK_EVENT[updated.status];
      if (event) feedback.on(event);
      onApplied(updated);
    } catch (caught) {
      feedback.on('action.failed');
      setError(getApiErrorMessage(caught, t('trip.updateError')));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (reason.trim().length === 0) {
      setError(t('trip.cancel.reasonRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const envelope = await apiClient.cancelTrip(
        trip.id,
        { cancellation_reason: reason.trim() },
        withIdempotencyKey(generateIdempotencyKey()),
      );
      setCancelling(false);
      setReason('');
      onApplied(unwrapEnvelope(envelope));
    } catch (caught) {
      feedback.on('action.failed');
      setError(getApiErrorMessage(caught, t('trip.cancel.failed')));
    } finally {
      setBusy(false);
    }
  };

  if (terminal) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.terminalNote}>
          {trip.status === TripStatus.COMPLETED
            ? t('trip.completedNote')
            : // The reason is data the dispatcher typed — never translated.
              trip.cancellation_reason
              ? t('trip.cancelledReason', { reason: trip.cancellation_reason })
              : t('trip.cancelledNote')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {transitions.map((next) => {
        // The one-tap lifecycle actions are the crew's biggest buttons: 64px,
        // with the stable icon + tone from `crew-action-meta` (green = go).
        const meta = transitionActionMeta(next);
        return (
          <Button
            key={next}
            label={transitionLabel(next)}
            icon={meta.icon}
            tone={meta.tone}
            size="field"
            onPress={() => void apply(next)}
            disabled={busy}
            busy={busy && !cancelling && transitions.length === 1}
            style={styles.action}
          />
        );
      })}

      {allowCancel && !cancelling ? (
        <Button
          label={t('trip.cancel.button')}
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
            label={t('trip.cancel.reasonLabel')}
            value={reason}
            onChangeText={setReason}
            placeholder={t('trip.cancel.reasonPlaceholder')}
            multiline
          />
          <View style={styles.cancelRow}>
            <Button
              label={t('trip.cancel.confirm')}
              variant="danger"
              onPress={() => void cancel()}
              disabled={busy}
              busy={busy}
            />
            <Button
              label={t('trip.cancel.keep')}
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

      {queuedNote ? <Text style={styles.queued}>{queuedNote}</Text> : null}
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
    color: colors.neutral[600],
    fontSize: 16,
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
    fontSize: 16,
    fontWeight: '600',
  },
  queued: {
    color: colors.neutral[700],
    fontSize: 16,
  },
});
