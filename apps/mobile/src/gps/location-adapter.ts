import * as Location from 'expo-location';
import type { LocationTaskOptions } from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { ExpoLocationLikeFix } from './fix-mapping';

/**
 * Expo glue for driver GPS sharing (Task 23 — background GPS).
 *
 * The chosen approach is the *official Expo mechanism compatible with this
 * project's SDK (Expo SDK 51 / expo-location 17.0.x / RN 0.74)*: a
 * `TaskManager`-backed `Location.startLocationUpdatesAsync` background task.
 * Why this one:
 *
 * - it is first-party (no third-party/paid SDKs, no Firebase), and the
 *   versions were pinned with `npx expo install` semantics for SDK 51;
 * - `expo-location@17` exposes Android foreground-service options so updates
 *   keep running when the phone is locked, as long as the OS allows it
 *   (`app.json` adds `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`,
 *   `FOREGROUND_SERVICE_LOCATION` and the iOS `location` background mode);
 * - the task executor runs in the same JS context while the process is alive,
 *   and is re-hydrated from persisted state on a cold headless relaunch (see
 *   `background-task.ts` + `registry.ts`), so the GPS → socket path never
 *   depends on React being mounted.
 *
 * If the OS refuses background location (the user picked "while using",
 * battery restrictions, …) this layer reports the limitation honestly; the UI
 * shows `GPS: PERMISSION REQUIRED`/`GPS: WAITING` instead of pretending.
 */

/** The background location task name — must be stable across relaunches. */
export const DRIVER_GPS_TASK_NAME = 'sbt.driver.gps-updates';

export type LocationTaskEventName = 'onLocationUpdate' | 'onGeofencingEnter' | 'onGeofencingExit';

export interface LocationTaskPayload {
  event: LocationTaskEventName;
  error?: Error;
  /** expo-location delivers an array of fixes on `onLocationUpdate`. */
  locations?: ExpoLocationLikeFix[];
}

export interface GpsLocationAdapter {
  /** Register the task executor (idempotent, safe at module scope). */
  ensureTaskDefined(executor: (payload: LocationTaskPayload) => Promise<void>): Promise<void>;
  hasServicesEnabled(): Promise<boolean>;
  /** `true` when while-in-use access is granted; `false` when denied. */
  requestForegroundPermission(): Promise<boolean>;
  /** `true` when always-on access is granted (needed for background). */
  requestBackgroundPermission(): Promise<boolean>;
  /** Start OS-level background updates; fixes arrive via the task executor. */
  startBackgroundUpdates(): Promise<void>;
  stopBackgroundUpdates(): Promise<void>;
  /** Warm start: the freshest OS-cached fix, if any (never invented). */
  getLastKnownFix(): Promise<ExpoLocationLikeFix | null>;
}

const UPDATE_OPTIONS: LocationTaskOptions = {
  // The server throttles at 2.5 s per device; 3 s / 30 m keeps the client
  // comfortably under it without starving observers of position.
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 3_000,
  distanceInterval: 30,
  // iOS: shows the blue indicator while updating in the background.
  showsBackgroundLocationIndicator: true,
  activityType: Location.ActivityType.AutomotiveNavigation,
  pausesUpdatesAutomatically: false,
  // Android foreground service so a locked phone keeps tracking during the
  // trip (see the config plugin flags in app.json).
  foregroundService: {
    notificationTitle: 'Trip tracking active',
    notificationBody: 'School Bus Tracking is sharing the bus position.',
    notificationColor: '#F59E0B',
    killServiceOnDestroy: true,
  },
};

export function createExpoLocationAdapter(): GpsLocationAdapter {
  let defined = false;
  return {
    async ensureTaskDefined(executor) {
      if (defined) {
        return;
      }
      const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(DRIVER_GPS_TASK_NAME).catch(
        () => false,
      );
      if (!alreadyRegistered) {
        TaskManager.defineTask(DRIVER_GPS_TASK_NAME, (taskData) =>
          executor((taskData ?? {}) as unknown as LocationTaskPayload),
        );
      }
      defined = true;
    },
    async hasServicesEnabled() {
      // expo-location ≥ 17 resolves a plain boolean here.
      return (await Location.hasServicesEnabledAsync()) === true;
    },
    async requestForegroundPermission() {
      const current = await Location.getForegroundPermissionsAsync();
      if (current.granted) {
        return true;
      }
      const asked = await Location.requestForegroundPermissionsAsync();
      return asked.granted;
    },
    async requestBackgroundPermission() {
      const current = await Location.getBackgroundPermissionsAsync();
      if (current.granted) {
        return true;
      }
      const asked = await Location.requestBackgroundPermissionsAsync();
      return asked.granted;
    },
    async startBackgroundUpdates() {
      await Location.startLocationUpdatesAsync(DRIVER_GPS_TASK_NAME, UPDATE_OPTIONS);
    },
    async stopBackgroundUpdates() {
      try {
        await Location.stopLocationUpdatesAsync(DRIVER_GPS_TASK_NAME);
      } catch {
        // Stopping a task that was never started (or already torn down by the
        // OS) must not break the driver flow.
      }
    },
    async getLastKnownFix() {
      try {
        return (await Location.getLastKnownPositionAsync({
          maxAge: 10_000,
        })) as unknown as ExpoLocationLikeFix | null;
      } catch {
        return null;
      }
    },
  };
}
