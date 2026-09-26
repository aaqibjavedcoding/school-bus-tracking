import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { withIdempotencyKey } from '@school-bus-tracking/api-client';
import type { TripStopCrewMarkResponse } from '@school-bus-tracking/shared-types';
import { isValidStopSkipReason } from '@school-bus-tracking/validation';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../services/api';
import { getApiErrorMessage, unwrapEnvelope } from '../../lib/errors';
import { Button, Field, useToast } from '../../components';
import { t } from '../../lib/i18n.ts';
import { useTranslation } from '../../lib/i18n-provider';
import { useAuth } from '../auth/AuthProvider';
import { feedback } from './crew-feedback.ts';
import { useOfflineAction } from './offline/useOfflineAction';

/**
 * "Arrived" / "Skip stop" — the crew's hand on the stop record.
 *
 * ### Why this exists
 *
 * A stop only became "reached" when the GPS pipeline saw a fix inside its
 * 100 m geofence. In the field that fails for reasons the crew cannot fix
 * from the driver's seat — permission killed by a battery optimiser, no sky
 * view, the bus parked across the road — and when it fails the whole run
 * sticks: the next-stop card never advances and the parents further down the
 * route hear nothing. The crew could see the problem and had no button. This
 * is the button.
 *
 * ### Offline-first, because the failure mode *is* bad coverage
 *
 * The tap goes through the same offline queue as attendance
 * (`useOfflineAction`): the item — and its idempotency key — is reserved
 * **before** the request, so "request reached the server but the answer was
 * lost" replays as a dedupe hit rather than a second arrival. A tap with no
 * network is not an error; it is saved and synced later, and the crew is told
 * so in those words.
 *
 * ### The confirmation is a *receipt*, not an optimistic flourish
 *
 * The written note and the spoken line ("Stop 3 recorded, 5 children board
 * here") fire **only** after the server answered, and they read their numbers
 * off the server's own response — never off the phone's possibly-stale
 * manifest slice. A bus full of people must not hear a stop announced as
 * recorded because a button was pressed; the queued path stays deliberately
 * silent and says "saved on this phone" instead.
 *
 * A skip demands a reason (≥ 3 characters, checked here with the same shared
 * predicate the server's DTO uses, so the crew learns it without a round
 * trip) and never notifies a parent — nobody's child was served.
 */
export interface StopMarkActionsProps {
  tripId: string;
  /** The stop the run is currently working; `null` hides the block. */
  stop: { id: string; name: string; sequence_number: number } | null;
  /** Called after a server-confirmed mark, so the screen can reload. */
  onMarked?: () => void;
}

export const StopMarkActions: React.FC<StopMarkActionsProps> = ({ tripId, stop, onMarked }) => {
  useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const offline = useOfflineAction();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState('');

  if (!stop) {
    return null;
  }

  /**
   * Reports a **server-confirmed** mark: a short written confirmation plus
   * the spoken receipt. Never called on the queued path.
   */
  const confirm = (result: TripStopCrewMarkResponse, action: 'arrive' | 'skip'): void => {
    const number = result.stop_sequence_number;
    const count = result.students_expected;

    if (action === 'skip') {
      const message = t('trip.stopMark.skipped', { number });
      setNote(message);
      toast.push(message, 'info');
      feedback.on({ type: 'stop.skipped', sequenceNumber: number });
      return;
    }

    // `created: false` means the stop was already recorded (the geofence
    // caught up, or this very tap was replayed). The stop *is* recorded, so
    // this is not an error — but it is not news either, so it gets the
    // written line without the announcement.
    if (!result.created) {
      const message = t('trip.stopMark.alreadyRecorded', { number });
      setNote(message);
      toast.push(message, 'info');
      return;
    }

    const message =
      count > 0
        ? t('trip.stopMark.recorded', { number, count })
        : t('trip.stopMark.recordedNoKids', { number });
    setNote(message);
    toast.push(message, 'success');
    feedback.on({ type: 'stop.recorded', sequenceNumber: number, studentCount: count });
  };

  const mark = async (action: 'arrive' | 'skip', skipReason?: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      let result: TripStopCrewMarkResponse | null = null;
      const outcome = await offline.execute(
        {
          kind: 'stop_mark',
          userId: user?.id ?? null,
          tripId,
          stopId: stop.id,
          stopAction: action,
          ...(skipReason === undefined ? {} : { skipReason }),
        },
        async (key) => {
          // The key is the queue reservation's, so a later replay of this very
          // item is a dedupe hit rather than a second stop record.
          const envelope =
            action === 'skip'
              ? await apiClient.skipTripStop(
                  tripId,
                  stop.id,
                  { reason: skipReason ?? '' },
                  withIdempotencyKey(key),
                )
              : await apiClient.markTripStopArrived(tripId, stop.id, withIdempotencyKey(key));
          result = unwrapEnvelope(envelope);
        },
      );

      if (outcome.mode === 'queued') {
        // No voice: the bus has not been told anything by the server yet.
        setNote(t('trip.stopMark.queued'));
        setSkipping(false);
        setReason('');
        return;
      }
      if (result) {
        confirm(result, action);
        setSkipping(false);
        setReason('');
        onMarked?.();
      }
    } catch (caught) {
      feedback.on({ type: 'action.rejected' });
      setError(getApiErrorMessage(caught, t('trip.stopMark.failed')));
    } finally {
      setBusy(false);
    }
  };

  const confirmSkip = (): void => {
    const trimmed = reason.trim();
    if (!isValidStopSkipReason(trimmed)) {
      // The server enforces the same rule; refusing here saves the crew a
      // round trip to be told something the phone already knew.
      setError(t('trip.stopMark.reasonTooShort'));
      return;
    }
    void mark('skip', trimmed);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('trip.stopMark.title')}</Text>
      <Text style={styles.hint}>{t('trip.stopMark.hint')}</Text>
      <Text style={styles.stop}>
        {t('map.stopLabel', { number: stop.sequence_number, name: stop.name })}
      </Text>

      {skipping ? (
        <View style={styles.skipBox}>
          <Field
            label={t('trip.stopMark.reasonLabel')}
            value={reason}
            onChangeText={setReason}
            placeholder={t('trip.stopMark.reasonPlaceholder')}
            multiline
          />
          <View style={styles.row}>
            <Button
              label={t('trip.stopMark.confirmSkip')}
              variant="danger"
              onPress={confirmSkip}
              disabled={busy}
              busy={busy}
            />
            <Button
              label={t('trip.stopMark.cancel')}
              variant="ghost"
              onPress={() => {
                setSkipping(false);
                setReason('');
                setError(null);
              }}
              disabled={busy}
            />
          </View>
        </View>
      ) : (
        <>
          <Button
            label={t('trip.stopMark.arrived')}
            icon="checkmark-circle"
            tone="success"
            size="field"
            onPress={() => void mark('arrive')}
            disabled={busy}
            busy={busy}
            style={styles.action}
          />
          <Button
            label={t('trip.stopMark.skip')}
            icon="play-skip-forward"
            variant="secondary"
            size="field"
            onPress={() => {
              setError(null);
              setNote(null);
              setSkipping(true);
            }}
            disabled={busy}
            style={styles.action}
          />
        </>
      )}

      {note ? <Text style={styles.note}>{note}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  title: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  hint: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
  },
  stop: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[800],
    marginTop: spacing.xs,
  },
  action: {
    marginTop: spacing.sm,
    borderRadius: borderRadius.md,
  },
  skipBox: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  note: {
    marginTop: spacing.sm,
    fontSize: typography.fontSizes.base,
    fontWeight: '600',
    color: colors.secondary[700],
  },
  error: {
    marginTop: spacing.sm,
    fontSize: typography.fontSizes.base,
    fontWeight: '600',
    color: colors.status.danger,
  },
});
