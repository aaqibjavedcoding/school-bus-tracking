import { UserRole } from '@school-bus-tracking/shared-types';

/**
 * Pure deep-link routing for push notifications (no native imports).
 *
 * The API puts a string-only `data` payload on every FCM message
 * (`type`, `school_id`, `user_id`, optional `trip_id` / `student_id` /
 * `stop_id` / `emergency_id`). This module turns that payload plus the
 * signed-in user into the expo-router path to open when the notification is
 * tapped — or `null` when the notification is not for this user (a device
 * that changed hands, a stale message from a previous session) or the role
 * has no screen for it.
 */

/** `data.type` values the server sends (parent inbox types + role pushes). */
export const PUSH_EVENT_TYPES = {
  studentBoarded: 'STUDENT_BOARDED',
  studentDropped: 'STUDENT_DROPPED',
  tripBoarding: 'TRIP_BOARDING',
  tripInProgress: 'TRIP_IN_PROGRESS',
  tripCompleted: 'TRIP_COMPLETED',
  tripCancelled: 'TRIP_CANCELLED',
  stopArrived: 'STOP_ARRIVED',
  emergencySos: 'EMERGENCY_SOS',
  emergencyStatus: 'EMERGENCY_STATUS',
  crewTripCancelled: 'CREW_TRIP_CANCELLED',
} as const;

export interface PushData {
  type?: string;
  school_id?: string;
  user_id?: string;
  trip_id?: string;
  student_id?: string;
  stop_id?: string;
  emergency_id?: string;
  id?: string;
}

/** Narrows an unknown notification `data` bag into {@link PushData}. */
export function readPushData(raw: unknown): PushData {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const source = raw as Record<string, unknown>;
  // expo-notifications on Android nests FCM data under `body` in some
  // versions; accept both shapes.
  const nested =
    source.body && typeof source.body === 'object' ? (source.body as Record<string, unknown>) : null;
  const pick = (key: keyof PushData): string | undefined => {
    const value = source[key] ?? nested?.[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };
  return {
    type: pick('type'),
    school_id: pick('school_id'),
    user_id: pick('user_id'),
    trip_id: pick('trip_id'),
    student_id: pick('student_id'),
    stop_id: pick('stop_id'),
    emergency_id: pick('emergency_id'),
    id: pick('id'),
  };
}

/**
 * True when a push addressed to `(school_id, user_id)` belongs to the user
 * currently signed in. Messages for anyone else are ignored — never routed.
 */
export function isPushForUser(
  data: PushData,
  user: { id: string; school_id: string | null } | null,
): boolean {
  if (!user) {
    return false;
  }
  if (data.user_id && data.user_id !== user.id) {
    return false;
  }
  if (data.school_id && user.school_id && data.school_id !== user.school_id) {
    return false;
  }
  return true;
}

/**
 * The route to open for a tapped notification, per role.
 *
 * - Parent: attendance / trip / stop events → live tracking of that child
 *   (`/tracking?child=`) when a student is known, else the notification inbox.
 * - Crew: trip cancellation → today's trip; SOS status → emergency tab.
 * - School admin: SOS → emergencies screen; trip events → trip detail.
 */
export function resolvePushRoute(
  data: PushData,
  user: { id: string; school_id: string | null; role: UserRole } | null,
): string | null {
  if (!isPushForUser(data, user) || !user) {
    return null;
  }
  const type = data.type ?? '';

  switch (user.role) {
    case UserRole.PARENT: {
      if (
        type === PUSH_EVENT_TYPES.studentBoarded ||
        type === PUSH_EVENT_TYPES.studentDropped ||
        type === PUSH_EVENT_TYPES.stopArrived ||
        type === PUSH_EVENT_TYPES.tripBoarding ||
        type === PUSH_EVENT_TYPES.tripInProgress
      ) {
        return data.student_id
          ? `/tracking?child=${encodeURIComponent(data.student_id)}`
          : '/tracking';
      }
      return '/notifications';
    }
    case UserRole.DRIVER:
    case UserRole.CONDUCTOR: {
      if (type === PUSH_EVENT_TYPES.emergencySos || type === PUSH_EVENT_TYPES.emergencyStatus) {
        return '/sos';
      }
      return '/trip';
    }
    case UserRole.SCHOOL_ADMIN: {
      if (type === PUSH_EVENT_TYPES.emergencySos || type === PUSH_EVENT_TYPES.emergencyStatus) {
        return '/emergencies';
      }
      if (data.trip_id) {
        return `/trips/${encodeURIComponent(data.trip_id)}`;
      }
      return '/dashboard';
    }
    default:
      return null;
  }
}

/**
 * Decides whether a foreground push should be shown as an in-app banner.
 * Messages for another account (device handed over) are suppressed.
 */
export function shouldPresentForeground(
  data: PushData,
  user: { id: string; school_id: string | null } | null,
): boolean {
  return isPushForUser(data, user);
}
