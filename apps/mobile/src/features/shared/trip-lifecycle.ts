import { TripStatus, type TripResponse } from '@school-bus-tracking/shared-types';
import { isTripStatusTransitionAllowed } from '@school-bus-tracking/validation';
import type { ApiClient } from '@school-bus-tracking/api-client';
import { apiErrorStatus, getApiErrorMessage } from '../../utils/errors';

/**
 * Trip lifecycle affordances.
 *
 * The transition table imported from `@school-bus-tracking/validation` is the
 * *same* table the API service uses, but on mobile it only decides which
 * buttons to render. Every change is still applied via
 * `PATCH /trips/:id/status` and validated (again) by the backend — including
 * "is this caller the rostered crew?" — so the client can never authorise a
 * transition the server would reject.
 */

export const ALL_TRIP_STATUSES: TripStatus[] = [
  TripStatus.SCHEDULED,
  TripStatus.BOARDING,
  TripStatus.IN_PROGRESS,
  TripStatus.COMPLETED,
  TripStatus.CANCELLED,
];

export function allowedTransitionsFrom(status: TripStatus): TripStatus[] {
  return ALL_TRIP_STATUSES.filter((next) => isTripStatusTransitionAllowed(status, next));
}

export function isTripOpen(status: TripStatus): boolean {
  return (
    status === TripStatus.SCHEDULED ||
    status === TripStatus.BOARDING ||
    status === TripStatus.IN_PROGRESS
  );
}

export interface TransitionResult {
  ok: boolean;
  trip?: TripResponse;
  message?: string;
  /** True when the server refused because of the *current* state (409/400). */
  stale?: boolean;
}

export async function transitionTrip(
  api: ApiClient,
  tripId: string,
  next: TripStatus,
  cancellationReason?: string | null,
): Promise<TransitionResult> {
  try {
    const envelope = await api.updateTripStatus(tripId, {
      status: next,
      ...(next === TripStatus.CANCELLED && cancellationReason
        ? { cancellation_reason: cancellationReason }
        : {}),
    });
    if (!envelope.data) {
      return {
        ok: false,
        message: envelope.error?.message || 'The server did not return the updated trip.',
      };
    }
    return { ok: true, trip: envelope.data };
  } catch (error) {
    const status = apiErrorStatus(error);
    return {
      ok: false,
      stale: status === 400 || status === 409,
      message: getApiErrorMessage(error, 'Trip update failed.'),
    };
  }
}

export const TRANSCTION_LABELS: Record<TripStatus, string> = {
  [TripStatus.SCHEDULED]: 'Back to scheduled',
  [TripStatus.BOARDING]: 'Start boarding',
  [TripStatus.IN_PROGRESS]: 'Depart (start trip)',
  [TripStatus.COMPLETED]: 'Complete trip',
  [TripStatus.CANCELLED]: 'Cancel trip',
};

export const TRANSITION_CONFIRMATIONS: Record<TripStatus, { title: string; message: string }> = {
  [TripStatus.SCHEDULED]: {
    title: 'Reopen for boarding?',
    message: 'This only applies if the trip was reopened by the school.',
  },
  [TripStatus.BOARDING]: {
    title: 'Start boarding?',
    message: 'Students can now be marked as boarding the bus.',
  },
  [TripStatus.IN_PROGRESS]: {
    title: 'Depart with this trip?',
    message: 'The trip moves to IN_PROGRESS and live tracking begins for parents.',
  },
  [TripStatus.COMPLETED]: {
    title: 'Complete the trip?',
    message: 'Finalises the run. GPS updates and boarding stop; this cannot be undone.',
  },
  [TripStatus.CANCELLED]: {
    title: 'Cancel this trip?',
    message: 'The trip will be cancelled and parents are notified. This cannot be undone.',
  },
};
