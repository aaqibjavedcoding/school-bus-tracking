import { getGpsTracker } from './registry';
import { createExpoLocationAdapter, type LocationTaskPayload } from './location-adapter';

/**
 * Registers the expo-task-manager executor for driver GPS.
 *
 * This module MUST be imported from a file that always runs at JS-context
 * start-up — `app/_layout.tsx` does it at module scope. expo-task-manager
 * re-creates the JS context on a cold headless launch (iOS relaunch for a
 * background location event, Android after process death while the service is
 * alive) and dispatches the queued task there; by then this import side
 * effect has already registered the handler.
 *
 * The handler itself contains no business rules: it forwards raw device fixes
 * to the tracker, which talks to the *existing* `/live-tracking` Socket.IO
 * namespace. All validation stays on the API.
 */

let registered = false;

export function ensureGpsBackgroundTaskRegistered(): void {
  if (registered) {
    return;
  }
  registered = true;
  const adapter = createExpoLocationAdapter();
  // Define the task eagerly so a headless relaunch (no UI mounted) still has
  // an executor at the exact moment the OS fires the first background fix.
  void adapter
    .ensureTaskDefined(async (payload: LocationTaskPayload) => {
      await getGpsTracker().handleTaskEvent(payload);
    })
    .catch(() => {
      // Task registration failing is a device-level problem; the tracker
      // status surfaces it on the next start attempt. Never crash the app.
    });
}

// Side-effect import support: `_layout` can `import '../src/gps/background-task'`
// and get registration without calling anything.
ensureGpsBackgroundTaskRegistered();
