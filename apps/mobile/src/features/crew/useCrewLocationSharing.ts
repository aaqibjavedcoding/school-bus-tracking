import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { TripStatus, type TripResponse } from '@school-bus-tracking/shared-types';
import { getLiveTrackingSocket } from '../../services/live-tracking-socket';
import { connectAuthenticatedSocket } from '../../services/socket-auth';
import {
  CREW_LOCATION_TASK,
  getCrewLocationStats,
  pushCrewDeviceFix,
  setActiveCrewTrip,
  stopCrewLocationTask,
  subscribeCrewLocationStats,
  type CrewLocationStats,
} from './location-task';

/**
 * Crew GPS sharing (DRIVER + CONDUCTOR).
 *
 * Wraps native location handling around the existing live-tracking socket:
 * a foreground `watchPositionAsync` while the app is open, and — after an
 * explicit opt-in with the OS background permission — an expo-location
 * background task (`startLocationUpdatesAsync`) that keeps delivering real
 * device fixes while the screen is off. Every fix flows through
 * `pushCrewDeviceFix`, which only ever forwards what the device reported.
 */

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export interface CrewLocationSharing {
  foregroundPermission: PermissionState;
  backgroundPermission: PermissionState;
  sharing: boolean;
  backgroundActive: boolean;
  stats: CrewLocationStats;
  busy: boolean;
  message: string | null;
  canShare: boolean;
  startSharing: () => Promise<void>;
  stopSharing: () => Promise<void>;
  enableBackground: () => Promise<void>;
  disableBackground: () => Promise<void>;
}

/** Trips that accept GPS fixes (mirrors the server's tracking-active rule). */
export function isTripShareable(trip: TripResponse | null | undefined): boolean {
  return trip?.status === TripStatus.BOARDING || trip?.status === TripStatus.IN_PROGRESS;
}

const WATCH_INTERVAL_MS = 4000; // server throttle floor is 2500 ms
const WATCH_DISTANCE_METERS = 10;

export function useCrewLocationSharing(trip: TripResponse | null): CrewLocationSharing {
  const [foregroundPermission, setForegroundPermission] = useState<PermissionState>('undetermined');
  const [backgroundPermission, setBackgroundPermission] = useState<PermissionState>('undetermined');
  const [sharing, setSharing] = useState(false);
  const [backgroundActive, setBackgroundActive] = useState(false);
  const [stats, setStats] = useState<CrewLocationStats>(getCrewLocationStats());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const tripRef = useRef<TripResponse | null>(trip);
  tripRef.current = trip;

  // Counters/last-fix live in the channel module so the background task can
  // update them while no screen is mounted.
  useEffect(() => subscribeCrewLocationStats(() => setStats(getCrewLocationStats())), []);

  useEffect(() => {
    void (async () => {
      const foreground = await Location.getForegroundPermissionsAsync();
      setForegroundPermission(
        foreground.granted ? 'granted' : foreground.canAskAgain ? 'undetermined' : 'denied',
      );
      const background = await Location.getBackgroundPermissionsAsync().catch(() => null);
      if (!background) {
        setBackgroundPermission('unavailable');
      } else {
        setBackgroundPermission(
          background.granted ? 'granted' : background.canAskAgain ? 'undetermined' : 'denied',
        );
      }
      try {
        setBackgroundActive(await Location.hasStartedLocationUpdatesAsync(CREW_LOCATION_TASK));
      } catch {
        setBackgroundActive(false);
      }
    })();
  }, []);

  const clearWatch = useCallback(async () => {
    const watch = watchRef.current;
    watchRef.current = null;
    if (watch) {
      await watch.remove();
    }
  }, []);

  const stopEverything = useCallback(
    async (note: string | null) => {
      await clearWatch();
      await stopCrewLocationTask();
      setSharing(false);
      setBackgroundActive(false);
      if (note !== undefined) {
        setMessage(note);
      }
    },
    [clearWatch],
  );

  // The trip closing (completed/cancelled) or the screen losing its trip ends
  // sharing — the server would reject every fix anyway.
  useEffect(() => {
    if (trip && isTripShareable(trip)) {
      return undefined;
    }
    if (sharing || backgroundActive) {
      void stopEverything(trip ? 'Trip closed — GPS sharing stopped.' : null);
    }
    return undefined;
  }, [trip?.id, trip?.status]);

  const startSharing = useCallback(async () => {
    const currentTrip = tripRef.current;
    if (!currentTrip || !isTripShareable(currentTrip)) {
      setMessage('Start boarding or the trip first — GPS is only accepted then.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      setForegroundPermission(
        permission.granted ? 'granted' : permission.canAskAgain ? 'undetermined' : 'denied',
      );
      if (!permission.granted) {
        setMessage('Location permission is required to share GPS with the school.');
        return;
      }

      await setActiveCrewTrip(currentTrip.id);
      const socket = getLiveTrackingSocket();
      connectAuthenticatedSocket(socket);

      await clearWatch();
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: WATCH_INTERVAL_MS,
          distanceInterval: WATCH_DISTANCE_METERS,
        },
        (fix) => {
          pushCrewDeviceFix(fix);
        },
      );
      setSharing(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start GPS sharing.');
    } finally {
      setBusy(false);
    }
  }, [clearWatch]);

  const stopSharing = useCallback(async () => {
    setBusy(true);
    try {
      await stopEverything(null);
    } finally {
      setBusy(false);
    }
  }, [stopEverything]);

  const enableBackground = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Location.requestBackgroundPermissionsAsync().catch(() => null);
      if (!permission) {
        setBackgroundPermission('unavailable');
        setMessage('Background location is not available on this device.');
        return;
      }
      setBackgroundPermission(
        permission.granted ? 'granted' : permission.canAskAgain ? 'undetermined' : 'denied',
      );
      if (!permission.granted) {
        setMessage('Allow "Always" location access to keep sharing with the screen off.');
        return;
      }

      const currentTrip = tripRef.current;
      if (!currentTrip || !isTripShareable(currentTrip)) {
        setMessage('Background sharing needs an active trip.');
        return;
      }
      if (stats.activeTripId === null) {
        await setActiveCrewTrip(currentTrip.id);
      }

      await Location.startLocationUpdatesAsync(CREW_LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: WATCH_INTERVAL_MS,
        distanceInterval: WATCH_DISTANCE_METERS,
        deferredUpdatesInterval: 15_000,
        deferredUpdatesDistance: 25,
        // Keep the OS from suspending updates when the bus waits at a stop.
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'School Bus GPS sharing',
          notificationBody: 'The school can see the live bus position for this trip.',
          notificationColor: '#f59e0b',
          killServiceOnDestroy: true,
        },
      });
      setBackgroundActive(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not enable background sharing.');
    } finally {
      setBusy(false);
    }
  }, [stats.activeTripId]);

  const disableBackground = useCallback(async () => {
    setBusy(true);
    try {
      await Location.stopLocationUpdatesAsync(CREW_LOCATION_TASK).catch(() => undefined);
      setBackgroundActive(false);
      if (!sharing) {
        await setActiveCrewTrip(null);
      }
    } finally {
      setBusy(false);
    }
  }, [sharing]);

  return {
    foregroundPermission,
    backgroundPermission,
    sharing,
    backgroundActive,
    stats,
    busy,
    message,
    canShare: isTripShareable(trip),
    startSharing,
    stopSharing,
    enableBackground,
    disableBackground,
  };
}
