import { useCallback, useEffect, useState } from 'react';
import { getGpsTracker } from './registry';
import type { GpsTrackerSnapshot } from './tracker';

/**
 * React view of the singleton `GpsTracker` (driver trip screen).
 *
 * Tracking is *started by the driver pressing the button*; it survives
 * backgrounding when OS permissions allow (foreground service / iOS background
 * mode). The hook never fabricates a status: whatever the tracker last
 * observed — including the server's acks — is what gets shown.
 */
export function useDriverGps(activeTripId: string | null) {
  const tracker = getGpsTracker();
  const [snapshot, setSnapshot] = useState<GpsTrackerSnapshot>(tracker.getSnapshot());

  useEffect(() => tracker.subscribe(() => setSnapshot({ ...tracker.getSnapshot() })), [tracker]);

  // If the screen (re)mounts while tracking is active for the same trip, the
  // tracker keeps running untouched. If the *user* opened a different trip,
  // sharing must follow: stop the stale one.
  useEffect(() => {
    const current = tracker.getSnapshot();
    if (current.status !== 'stopped' && current.tripId && current.tripId !== activeTripId) {
      void tracker.stop();
    }
  }, [tracker, activeTripId]);

  const start = useCallback(async (): Promise<void> => {
    if (!activeTripId) {
      return;
    }
    await tracker.start(activeTripId);
    setSnapshot({ ...tracker.getSnapshot() });
  }, [tracker, activeTripId]);

  const stop = useCallback(async (): Promise<void> => {
    await tracker.stop();
    setSnapshot({ ...tracker.getSnapshot() });
  }, [tracker]);

  const refresh = useCallback(async (): Promise<void> => {
    await tracker.refresh();
    setSnapshot({ ...tracker.getSnapshot() });
  }, [tracker]);

  return { snapshot, start, stop, refresh };
}
