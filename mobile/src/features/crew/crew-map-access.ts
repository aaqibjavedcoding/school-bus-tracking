import { UserRole } from '@school-bus-tracking/shared-types';

/**
 * Who gets the live map, and who gets to act on it — pure, React-free.
 *
 * The crew trip screen (`app/(crew)/trip.tsx`) used to hide the map, the GPS
 * strip, the stop-marking actions and the navigation card behind one flag:
 * `isDriver`. That was right three times and wrong once: a **conductor** on
 * the bus had no map at all, even though the run's live position is exactly
 * what a conductor needs to see (is the bus approaching the school? did the
 * driver take a wrong turn?). The product decision, locked:
 *
 * - the **map surface** is visible to DRIVER **and** CONDUCTOR;
 * - the **GPS sharing strip**, the **location watcher**, every
 *   **start/stop-sharing control** and the **crew stop-marking actions**
 *   (`StopMarkActions` / `useCrewStopMark`) stay DRIVER-only.
 *
 * The conductor's map is the *observer* variant — the same
 * `BusMap`/`LiveMapSurface` the parent and admin see — and its position comes
 * from the observer socket (`useLiveTripTracking`), never from the
 * conductor's own phone. Read-only means read-only: no no-fix CTA, no
 * mark-arrived button, no "your device" honesty line.
 *
 * Every gate in the crew trip screen reads one of these functions, so the
 * split is decided once and pinned here — including the invariant the
 * conductor's device relies on: the sharing lifecycle only ever starts from
 * an explicit driver-side action (`crewOwnsLocationSharing` gates every one
 * of them), so a conductor's phone never starts a location watcher.
 */

/** Which live-map surface a crew role renders. */
export type CrewMapSurface = 'driver' | 'observer';

/**
 * The map variant a role gets, or `null` for a role that is not crew and sees
 * no crew map at all.
 */
export function crewMapSurface(role: UserRole | null | undefined): CrewMapSurface | null {
  switch (role) {
    case UserRole.DRIVER:
      return 'driver';
    case UserRole.CONDUCTOR:
      return 'observer';
    default:
      return null;
  }
}

/**
 * Whether this role owns the GPS sharing lifecycle on their own device — the
 * strip, the watcher, every start/stop control, and the sharing start that
 * rides a confirmed lifecycle transition. DRIVER only: sharing is the
 * driver's job, and the conductor's device must never start a watcher.
 */
export function crewOwnsLocationSharing(role: UserRole | null | undefined): boolean {
  return role === UserRole.DRIVER;
}

/**
 * Whether this role may mark stops (the geofence fallback `StopMarkActions`
 * and the `useCrewStopMark` hook behind it). DRIVER only — the manual record
 * is a crew-action surface, and the conductor's map is read-only.
 */
export function crewCanMarkStops(role: UserRole | null | undefined): boolean {
  return role === UserRole.DRIVER;
}
