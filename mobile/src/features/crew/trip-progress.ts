import type { StopResponse, TripEtaResponse } from '@school-bus-tracking/shared-types';
import { deriveTripProgress, type TripProgressDerivation } from './navigation-stop.ts';

/**
 * T1 — **the progress frontier belongs to a trip, not to the screen**.
 *
 * The crew "today" screen shows one run at a time, but the crew member has
 * several: the moment a trip completes, `pickCrewTrip` returns the next one on
 * the following reload and the screen re-renders around a different trip id
 * without ever unmounting. Everything the screen remembers about progress has
 * to be keyed to that id, or the new run is derived from the old run's state.
 *
 * That was exactly the bug this module replaces. The frontier lived in a
 * `useRef` that survived the switch, so trip B was derived with trip A's
 * frontier — "no candidates ahead of frontier 6" (no Navigate button, empty
 * kids card, silent voice, and the server's own `next_stop` rejected as
 * "behind frontier, ignored") or, with a smaller stale frontier, a plausible
 * but **wrong** next stop that drives the bus past a stop full of children.
 * Recovery was an app force-close.
 *
 * The rules, in the order a support ticket would hit them:
 *
 * 1. **the server's `next_stop` is the source of truth** — it is computed from
 *    the recorded arrivals in the database and survives restarts, so it is
 *    trusted whenever it is a real, navigable stop of this route that this
 *    trip has not reached;
 * 2. **the client frontier is only a safety net** — it exists so a late,
 *    out-of-order push cannot walk the driver backward *inside one trip*. It
 *    carries no authority across trips, so it is scoped by trip id and starts
 *    at zero for every trip the screen has not seen progress for;
 * 3. **an ETA payload belongs to the trip it was computed for** — the live
 *    tracking hook keeps the previous trip's ETA until the new snapshot lands,
 *    and two trips can share a route, so a payload whose `trip_id` is not the
 *    trip on screen is treated as "no ETA yet" instead of as fact.
 *
 * React-free on purpose: the trip screen owns the state (a `useState` advanced
 * from an effect), this module only decides what the state should be, so the
 * whole policy is unit-testable under the Node runner and nothing here can be
 * mutated during a render.
 */

/** The monotonic frontier of one trip, and the trip it was measured on. */
export interface TripFrontierState {
  /** The trip this frontier belongs to; null before any trip is known. */
  tripId: string | null;
  /** Highest stop sequence this trip was seen to have reached. */
  frontier: number;
}

export const initialTripFrontier = (): TripFrontierState => ({ tripId: null, frontier: 0 });

/**
 * The frontier that applies to `tripId` right now: the remembered one when it
 * was measured on this same trip, otherwise zero. Reading this — instead of
 * the raw state — is what makes a trip switch safe on the very first render
 * after it, before any effect has run.
 */
export function effectiveFrontier(state: TripFrontierState, tripId: string | null): number {
  if (tripId === null) return 0;
  if (state.tripId !== tripId) return 0;
  return Number.isFinite(state.frontier) && state.frontier > 0 ? state.frontier : 0;
}

/**
 * Folds an observed frontier into the remembered state: forward only, never
 * backward, and reset the moment the trip changes.
 *
 * Returns the **same object** when nothing moved, so a screen holding this in
 * `useState` does not re-render (and its memos do not recompute) on every ETA
 * push that reports the same progress.
 */
export function advanceTripFrontier(
  state: TripFrontierState,
  tripId: string | null,
  observedFrontier: number,
): TripFrontierState {
  if (tripId === null) {
    return state.tripId === null && state.frontier === 0 ? state : { tripId: null, frontier: 0 };
  }
  if (state.tripId !== tripId) {
    // A different trip: whatever was remembered is that trip's business. The
    // new trip starts from what its own ETA already shows.
    const fresh = Number.isFinite(observedFrontier) && observedFrontier > 0 ? observedFrontier : 0;
    return { tripId, frontier: fresh };
  }
  if (!Number.isFinite(observedFrontier) || observedFrontier <= state.frontier) return state;
  return { tripId, frontier: observedFrontier };
}

/**
 * An ETA payload only describes the trip it was computed for.
 *
 * `useLiveTripTracking` clears its ETA when the trip goes away but keeps it
 * while the trip id changes to another run, until the new snapshot or socket
 * push arrives — and both runs can share a route, so the stale arrivals would
 * otherwise look like this trip's own. A payload that carries no `trip_id`
 * cannot be disproved and is passed through, because dropping it would blank a
 * working screen over a field the server has always sent.
 */
export function etaForTrip(
  eta: TripEtaResponse | null | undefined,
  tripId: string | null,
): TripEtaResponse | null {
  if (!eta) return null;
  if (!tripId) return null;
  const origin = (eta as { trip_id?: unknown }).trip_id;
  if (typeof origin === 'string' && origin.length > 0 && origin !== tripId) return null;
  return eta;
}

/** A stop list together with the route it was loaded from. */
export interface RouteStops {
  route_id: string | null;
  items: StopResponse[];
}

/**
 * The stops of the route the trip on screen actually runs.
 *
 * The loader keeps the previous route's stops while the new request is in
 * flight (`useLoad` never blanks data on a dependency change), so a trip switch
 * would briefly derive a next stop — and draw a map — from the route the bus is
 * no longer driving.
 */
export function stopsForRoute(loaded: RouteStops | null, routeId: string | null): StopResponse[] {
  if (!loaded || !routeId) return [];
  if (loaded.route_id !== routeId) return [];
  return loaded.items;
}

export interface TripProgressInput {
  /** The trip on screen; null while nothing is selected. */
  tripId: string | null;
  /** Stops of that trip's route (already scoped with `stopsForRoute`). */
  stops: StopResponse[];
  /** The live ETA, which may still be the previous trip's. */
  eta?: TripEtaResponse | null;
  /** `eta.next_stop.stop_id`, when the caller already resolved it. */
  serverNextStopId?: string | null;
}

export interface TripProgressResult {
  /** What to show: next stop, frontier and the reason behind both. */
  progress: TripProgressDerivation;
  /** The state to store next — trip-scoped, forward-only. */
  frontierState: TripFrontierState;
}

/**
 * The one call the crew trip screen makes: derive this trip's progress and
 * return the frontier state to remember for the next push.
 *
 * `previous` is the remembered state, `input.tripId` the trip on screen; the
 * two disagreeing is the normal, expected case on a trip switch, and it is
 * handled here rather than by the caller having to notice.
 */
export function deriveTripProgressForTrip(
  previous: TripFrontierState,
  input: TripProgressInput,
): TripProgressResult {
  const { tripId, stops } = input;
  const eta = etaForTrip(input.eta ?? null, tripId);
  // A stop id resolved from the previous trip's payload is not a fact about
  // this one, so it is dropped together with the payload it came from. With no
  // payload to contradict it, an explicit id from the caller is honoured.
  const etaWasDropped = Boolean(input.eta) && eta === null;
  const serverNextStopId = etaWasDropped
    ? null
    : (input.serverNextStopId ?? eta?.next_stop?.stop_id ?? null);
  const frontier = effectiveFrontier(previous, tripId);
  const progress = deriveTripProgress(stops, eta, serverNextStopId, frontier);
  return {
    progress,
    frontierState: advanceTripFrontier(previous, tripId, progress.frontier),
  };
}
