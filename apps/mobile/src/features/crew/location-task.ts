import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import {
  LIVE_TRACKING_EVENTS,
  type TripLocationUpdateAck,
  type TripLocationUpdatePayload,
} from '@school-bus-tracking/shared-types';
import { getLiveTrackingSocket } from '../../services/live-tracking-socket';
import { buildLocationPayload, type DeviceLocationFix } from '../../lib/geo';

/**
 * Crew GPS channel (shared by the DRIVER and CONDUCTOR experience).
 *
 * This module is the single pipe between native location events and the
 * existing `/live-tracking` Socket.IO namespace:
 *
 * - fixes come **only** from expo-location (foreground watch or the
 *   background task) — nothing here fabricates a coordinate, a speed or a
 *   timestamp;
 * - each fix is mapped to the exact shared `trip:location:update` contract
 *   and validated client-side with the same Zod schema the API uses, so a
 *   malformed device reading is dropped instead of being repaired;
 * - fixes are never queued or replayed: if the socket is down the fix is
 *   honestly dropped (`not-connected`) — the next real fix re-establishes the
 *   stream, and the server stays the only source of truth for history;
 * - the active trip id is persisted so the background task keeps working
 *   after the OS has relaunched the app headlessly (nothing else is stored).
 */

export const CREW_LOCATION_TASK = 'school-bus-crew-location';

const ACTIVE_TRIP_KEY = '@sbt/crew-active-trip-id';

export interface CrewLocationStats {
  activeTripId: string | null;
  /** Fixes handed to the socket (server may still throttle/reject). */
  emittedCount: number;
  /** Fixes the client dropped (malformed device reading). */
  invalidCount: number;
  /** Fixes dropped because the socket was not connected. */
  disconnectedCount: number;
  /** Fixes the server rejected (ack status `rejected`). */
  rejectedCount: number;
  lastReason: string | null;
  lastAckAt: string | null;
  lastFix: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    recorded_at: string;
  } | null;
}

const initialStats: CrewLocationStats = {
  activeTripId: null,
  emittedCount: 0,
  invalidCount: 0,
  disconnectedCount: 0,
  rejectedCount: 0,
  lastReason: null,
  lastAckAt: null,
  lastFix: null,
};

let stats: CrewLocationStats = { ...initialStats };
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeCrewLocationStats(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCrewLocationStats(): CrewLocationStats {
  return stats;
}

function resetStats(tripId: string | null): void {
  stats = { ...initialStats, activeTripId: tripId };
  publish();
}

/** Persists the active trip for the headless background task, then resets counters. */
export async function setActiveCrewTrip(tripId: string | null): Promise<void> {
  if (tripId === null) {
    await AsyncStorage.removeItem(ACTIVE_TRIP_KEY);
  } else {
    await AsyncStorage.setItem(ACTIVE_TRIP_KEY, tripId);
  }
  resetStats(tripId);
}

/** Restores the persisted active trip (headless relaunch of the app). */
export async function restoreActiveCrewTrip(): Promise<string | null> {
  if (stats.activeTripId !== null) {
    return stats.activeTripId;
  }
  try {
    const persisted = await AsyncStorage.getItem(ACTIVE_TRIP_KEY);
    if (persisted) {
      stats = { ...stats, activeTripId: persisted };
      publish();
      return persisted;
    }
  } catch {
    // Storage unavailable — fixes are dropped until the UI sets the trip.
  }
  return null;
}

export type PushFixResult = 'emitted' | 'no-trip' | 'invalid' | 'not-connected';

/**
 * Pushes one native fix to the trip room. Returns what happened so both the
 * UI and the background task can report honestly.
 */
export function pushCrewDeviceFix(fix: DeviceLocationFix): PushFixResult {
  const tripId = stats.activeTripId;
  if (!tripId) {
    return 'no-trip';
  }

  const payload: TripLocationUpdatePayload | null = buildLocationPayload(tripId, fix);
  if (!payload) {
    stats = { ...stats, invalidCount: stats.invalidCount + 1 };
    publish();
    return 'invalid';
  }

  stats = {
    ...stats,
    lastFix: {
      latitude: payload.latitude,
      longitude: payload.longitude,
      accuracy: payload.accuracy ?? null,
      recorded_at: payload.recorded_at,
    },
  };

  const socket = getLiveTrackingSocket();
  if (!socket.connected) {
    // Never queue: a replayed fix would misrepresent where the bus is now.
    stats = { ...stats, disconnectedCount: stats.disconnectedCount + 1 };
    publish();
    return 'not-connected';
  }

  socket.emit(LIVE_TRACKING_EVENTS.locationUpdate, payload, (ack: TripLocationUpdateAck) => {
    if (ack.status === 'accepted') {
      stats = {
        ...stats,
        emittedCount: stats.emittedCount + 1,
        lastAckAt: ack.received_at ?? new Date().toISOString(),
        lastReason: null,
      };
    } else {
      stats = {
        ...stats,
        rejectedCount: stats.rejectedCount + 1,
        lastReason: ack.reason ?? 'rejected',
      };
    }
    publish();
  });
  return 'emitted';
}

/** Stops the OS-level background update task and forgets the active trip. */
export async function stopCrewLocationTask(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(CREW_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(CREW_LOCATION_TASK);
    }
  } catch {
    // The task was never started (or the OS already stopped it).
  }
  await setActiveCrewTrip(null);
}

if (!TaskManager.isTaskDefined(CREW_LOCATION_TASK)) {
  TaskManager.defineTask(CREW_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      return;
    }
    const { locations } = (data ?? {}) as { locations?: DeviceLocationFix[] };
    if (!locations || locations.length === 0) {
      return;
    }
    if (stats.activeTripId === null) {
      await restoreActiveCrewTrip();
    }
    for (const fix of locations) {
      pushCrewDeviceFix(fix);
    }
  });
}
