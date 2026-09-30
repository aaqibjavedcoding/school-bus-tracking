import { useState } from 'react';
import { withIdempotencyKey } from '@school-bus-tracking/api-client';
import type { TripStopCrewMarkResponse } from '@school-bus-tracking/shared-types';
import { apiClient } from '../../services/api';
import { getApiErrorMessage, unwrapEnvelope } from '../../lib/errors';
import { t } from '../../lib/i18n.ts';
import { useAuth } from '../auth/AuthProvider';
import { feedback } from './crew-feedback.ts';
import { useOfflineAction } from './offline/useOfflineAction';

/** The stop a crew mark applies to. */
export interface CrewMarkStop {
  id: string;
  name: string;
  sequence_number: number;
}

/**
 * The crew's manual stop-marking call, extracted so more than one surface can
 * offer it: the dedicated "Arrived / Skip stop" card **and** the one-tap
 * "I'm at this stop" hold button on the next-stop card.
 *
 * The behaviour is unchanged and deliberate (see `StopMarkActions`):
 *
 * - it goes through the offline queue, with the idempotency key reserved
 *   *before* the request, so a lost answer replays as a dedupe hit rather
 *   than a second arrival;
 * - the written note and the spoken receipt fire only after the SERVER
 *   answered, and read their numbers off the server's response;
 * - the queued path stays silent and says "saved on this phone".
 */
export function useCrewStopMark(
  tripId: string,
  stop: CrewMarkStop | null,
  onMarked?: () => void,
  /** Surface the confirmation as a toast as well (the dedicated card does). */
  onNote?: (message: string, tone: 'success' | 'info') => void,
): {
  busy: boolean;
  error: string | null;
  note: string | null;
  reset: () => void;
  mark: (action: 'arrive' | 'skip', skipReason?: string) => Promise<void>;
} {
  const { user } = useAuth();
  const offline = useOfflineAction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const confirm = (result: TripStopCrewMarkResponse, action: 'arrive' | 'skip'): void => {
    const number = result.stop_sequence_number;
    const count = result.students_expected;

    if (action === 'skip') {
      const message = t('trip.stopMark.skipped', { number });
      setNote(message);
      onNote?.(message, 'info');
      feedback.on({ type: 'stop.skipped', sequenceNumber: number });
      return;
    }

    // `created: false` — the stop was already recorded (the geofence caught
    // up, or this tap replayed). Not an error, but not news: no announcement.
    if (!result.created) {
      const already = t('trip.stopMark.alreadyRecorded', { number });
      setNote(already);
      onNote?.(already, 'info');
      return;
    }

    const message =
      count > 0
        ? t('trip.stopMark.recorded', { number, count })
        : t('trip.stopMark.recordedNoKids', { number });
    setNote(message);
    onNote?.(message, 'success');
    feedback.on({ type: 'stop.recorded', sequenceNumber: number, studentCount: count });
  };

  const mark = async (action: 'arrive' | 'skip', skipReason?: string): Promise<void> => {
    if (!stop) return;
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
        setNote(t('trip.stopMark.queued'));
        return;
      }
      if (result) {
        confirm(result, action);
        onMarked?.();
      }
    } catch (caught) {
      feedback.on({ type: 'action.rejected' });
      setError(getApiErrorMessage(caught, t('trip.stopMark.failed')));
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    error,
    note,
    reset: () => {
      setError(null);
      setNote(null);
    },
    mark,
  };
}
