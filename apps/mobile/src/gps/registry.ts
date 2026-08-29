import NetInfo from '@react-native-community/netinfo';
import { LIVE_TRACKING_NAMESPACE } from '@school-bus-tracking/shared-types';
import { createSecureStorage, type KeyValueStorage } from '../storage/secure-store';
import { getSocketHub } from '../services/sockets';
import { GpsTracker, type GpsTrackerDeps, type TrackerSocketLike } from './tracker';
import { createExpoLocationAdapter } from './location-adapter';

/**
 * Singleton holder for the driver GPS tracker.
 *
 * The background task (a headless entry point with no React tree) reaches the
 * tracker through this registry; the UI reaches it the same way so both views
 * of the world share one state machine — there is never a "screen thinks it is
 * started, task thinks it is not" split.
 */

let tracker: GpsTracker | null = null;
let storage: KeyValueStorage | null = null;

function productionDeps(): GpsTrackerDeps {
  storage ??= createSecureStorage();
  return {
    location: createExpoLocationAdapter(),
    getSocket(): TrackerSocketLike {
      return getSocketHub().socketFor(LIVE_TRACKING_NAMESPACE) as unknown as TrackerSocketLike;
    },
    isOnline() {
      // Synchronous best-effort read; NetInfo pushes authoritative changes.
      // Default to online so a transient probe failure cannot fake an outage.
      return lastKnownOnline;
    },
    onNetworkChange(listener) {
      return NetInfo.addEventListener((state) => {
        const online = Boolean(state.isConnected);
        if (online !== lastKnownOnline) {
          lastKnownOnline = online;
          listener(online);
        }
      });
    },
    storage,
  };
}

let lastKnownOnline = true;

export function getGpsTracker(): GpsTracker {
  if (!tracker) {
    tracker = new GpsTracker(productionDeps());
  }
  return tracker;
}

/** Test seam. */
export function __resetGpsTrackerForTests(): void {
  tracker = null;
  storage = null;
  lastKnownOnline = true;
}
