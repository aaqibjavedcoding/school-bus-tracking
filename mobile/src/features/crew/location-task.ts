import * as TaskManager from 'expo-task-manager';
import type { DeviceLocationFix } from '../../lib/geo.ts';
import {
  CREW_LOCATION_TASK,
  runHeadlessCrewLocationTask,
  type HeadlessRunResult,
} from './tracking-lifecycle.ts';

/**
 * Registration of the crew background-location task.
 *
 * This module is imported for its side effect from `app/_layout.tsx`, which is
 * the earliest point the JS bundle is evaluated — including when the OS
 * relaunches the app **headlessly** to deliver fixes. All the work lives in
 * `tracking-lifecycle.ts`; this file only hands expo-task-manager the callback
 * and keeps the outcome of the last execution for diagnostics.
 *
 * What changed with the mobile-reliability patch: the task no longer "restores
 * a trip id and emits". A headless execution has an empty in-memory access
 * token and no socket, so it now runs the full bounded recovery — API runtime
 * registration, single-flight session refresh, ownership-checked context
 * restore, server-side eligibility re-check, connection, and only then the
 * newest fix (see `runHeadlessCrewLocationTask`).
 */

export { CREW_LOCATION_TASK };

/** Outcome of the most recent headless execution (`null` before the first). */
let lastRun: HeadlessRunResult | null = null;
/** The error expo-task-manager reported for the most recent failed execution. */
let lastError: string | null = null;

/** Diagnostics for the Help screen: what the last background run actually did. */
export function getLastHeadlessRun(): HeadlessRunResult | null {
  return lastRun;
}

/** Diagnostics for the Help screen: the last task-level error, if any. */
export function getLastHeadlessError(): string | null {
  return lastError;
}

if (!TaskManager.isTaskDefined(CREW_LOCATION_TASK)) {
  TaskManager.defineTask(CREW_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      lastError = error.message ?? String(error);
      return;
    }
    lastError = null;
    const { locations } = (data ?? {}) as { locations?: DeviceLocationFix[] };
    // Bounded end to end: every wait inside has a timeout, so this callback
    // cannot hang a background execution open.
    lastRun = await runHeadlessCrewLocationTask(locations);
  });
}
