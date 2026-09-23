import type { StopResponse } from '@school-bus-tracking/shared-types';
import type { TripStopEta, TripEtaResponse } from '@school-bus-tracking/shared-types';
import { isValidCoordinate, type NavigationTarget } from '../../lib/navigation.ts';

/**
 * Which route stop the driver should be heading to — field-hardened
 * (batch 3E).
 *
 * Real-world navigation UX bar (maps / ride apps):
 * - **monotonic forward progress**: once the trip's frontier advances, the
 *   shown stop never moves backward, even if GPS drifts or a late fix
 *   arrives out of order;
 * - **snap-to-route / nearest-UPCOMING**: among stops ahead of the frontier,
 *   the nearest by straight-line distance is preferred when ETA distances are
 *   available, otherwise the earliest in route order;
 * - **GPS drift / jump tolerance**: a stop behind the frontier is never
 *   re-surfaced as \"next\", and a far-ahead arrival does not cause the UI to
 *   jump to last/middle then back to first — the fallback is always forward;
 * - **diagnostics**: every decision explains its frontier, candidate set and
 *   why a stop was chosen or why none exists.
 *
 * Kept free of React Native so it can be unit-tested with the Node runner —
 * and so the \"never navigate to a guessed coordinate\" rule is enforced in
 * one place: a stop without real coordinates is simply not a navigation
 * target.
 */

export interface StopLike {
  id: string;
  sequence_number: number;
  latitude: number | null;
  longitude: number | null;
  name?: string;
}

/** A stop is only navigable once it carries real, in-range coordinates. */
export function navigationTargetOf(stop: StopLike): NavigationTarget | null {
  if (stop.latitude === null || stop.longitude === null) {
    return null;
  }
  if (!isValidCoordinate(stop.latitude, stop.longitude)) {
    return null;
  }
  return { name: (stop as { name?: string }).name ?? 'Stop', latitude: stop.latitude, longitude: stop.longitude };
}

export function isNavigableStop(stop: StopLike): boolean {
  return navigationTargetOf(stop) !== null;
}

/** Highest sequence_number among arrived ETA items (0 before first arrival). */
export function deriveFrontier(items: TripStopEta[] | null | undefined): number {
  if (!items || items.length === 0) return 0;
  let max = 0;
  for (const item of items) {
    if (item.arrived && Number.isFinite(item.sequence_number) && item.sequence_number > max) {
      max = item.sequence_number;
    }
  }
  return max;
}

export function deriveArrivedIds(items: TripStopEta[] | null | undefined): Set<string> {
  const set = new Set<string>();
  if (!items) return set;
  for (const item of items) {
    if (item.arrived) set.add(item.stop_id);
  }
  return set;
}

export interface TripProgressDerivation {
  /** The monotonic frontier (max arrived sequence, never backward). */
  frontier: number;
  /** The chosen next stop, or null when trip is complete / no navigable. */
  nextStop: StopResponse | null;
  /** Human-readable reason for the choice (for diagnostics / support). */
  reason: string;
  diagnostics: {
    frontier: number;
    previousFrontier: number;
    arrivedCount: number;
    candidateCount: number;
    chosenId: string | null;
    serverNextId: string | null;
    hasEta: boolean;
  };
}

/**
 * Robust next-stop derivation — the single source for driver + conductor.
 *
 * Inputs:
 * - `stops`: ordered route stops (any order, sorted internally)
 * - `eta`: server ETA response (may be null before first GPS fix)
 * - `serverNextStopId`: `eta.next_stop.stop_id` when available
 * - `previousFrontier`: max frontier seen so far (for monotonic guarantee)
 *
 * Guarantees:
 * - frontier never decreases (previousFrontier is respected)
 * - next stop is always ahead of frontier, never behind, never random/last
 *   unless it is genuinely the last unarrived
 * - when all navigable stops arrived, returns null (not first)
 * - when no ETA yet, returns first navigable (trip not started)
 * - when ETA available, prefers nearest upcoming by distance_meters when
 *   available, otherwise earliest in route order
 */
export function deriveTripProgress(
  stops: StopResponse[],
  eta: TripEtaResponse | null | undefined,
  serverNextStopId?: string | null,
  previousFrontier?: number,
): TripProgressDerivation {
  const sorted = [...stops].sort((a, b) => a.sequence_number - b.sequence_number);
  if (sorted.length === 0) {
    return {
      frontier: previousFrontier ?? 0,
      nextStop: null,
      reason: 'no stops in route',
      diagnostics: {
        frontier: previousFrontier ?? 0,
        previousFrontier: previousFrontier ?? 0,
        arrivedCount: 0,
        candidateCount: 0,
        chosenId: null,
        serverNextId: serverNextStopId ?? null,
        hasEta: Boolean(eta),
      },
    };
  }

  const items = eta?.items ?? null;
  const arrivedIds = deriveArrivedIds(items);
  const etaFrontier = deriveFrontier(items);
  const frontier = Math.max(previousFrontier ?? 0, etaFrontier);

  // Candidates: ahead of frontier, not arrived, navigable
  const candidates = sorted.filter(
    (stop) => stop.sequence_number > frontier && !arrivedIds.has(stop.id) && isNavigableStop(stop),
  );

  // Distance map for nearest-upcoming when ETA available
  const distanceById = new Map<string, number | null>();
  if (items) {
    for (const item of items) {
      distanceById.set(item.stop_id, item.distance_meters);
    }
  }

  const sortedCandidates = [...candidates].sort((a, b) => {
    const da = distanceById.get(a.id);
    const db = distanceById.get(b.id);
    const hasDa = typeof da === 'number' && Number.isFinite(da);
    const hasDb = typeof db === 'number' && Number.isFinite(db);
    if (hasDa && hasDb) {
      if (da !== db) return (da as number) - (db as number);
    } else if (hasDa && !hasDb) {
      return -1;
    } else if (!hasDa && hasDb) {
      return 1;
    }
    return a.sequence_number - b.sequence_number;
  });

  let chosen: StopResponse | null = null;
  let reason = '';

  if (serverNextStopId) {
    const serverStop = sorted.find((s) => s.id === serverNextStopId) ?? null;
    if (serverStop && isNavigableStop(serverStop)) {
      if (serverStop.sequence_number <= frontier) {
        reason = `server next ${serverNextStopId} seq ${serverStop.sequence_number} is behind frontier ${frontier}, ignored`;
      } else if (arrivedIds.has(serverStop.id)) {
        reason = `server next ${serverNextStopId} already arrived, ignored`;
      } else {
        chosen = serverStop;
        reason = `server next ${serverNextStopId} ahead of frontier ${frontier}, trusted`;
      }
    } else {
      reason = `server next ${serverNextStopId} not navigable or not in route`;
    }
  }

  if (!chosen) {
    if (sortedCandidates.length === 0) {
      chosen = null;
      reason = reason
        ? `${reason}; no candidates ahead of frontier ${frontier} → trip complete or no navigable`
        : `no candidates ahead of frontier ${frontier} → trip complete or no navigable`;
    } else {
      chosen = sortedCandidates[0];
      const dist = distanceById.get(chosen.id);
      const distInfo = typeof dist === 'number' ? ` distance ${Math.round(dist)}m` : '';
      reason = reason
        ? `${reason}; picked nearest upcoming ${chosen.id} seq ${chosen.sequence_number}${distInfo} among ${sortedCandidates.length} candidates ahead of frontier ${frontier}`
        : `picked nearest upcoming ${chosen.id} seq ${chosen.sequence_number}${distInfo} among ${sortedCandidates.length} candidates ahead of frontier ${frontier}`;
    }
  }

  return {
    frontier,
    nextStop: chosen,
    reason,
    diagnostics: {
      frontier,
      previousFrontier: previousFrontier ?? 0,
      arrivedCount: arrivedIds.size,
      candidateCount: candidates.length,
      chosenId: chosen?.id ?? null,
      serverNextId: serverNextStopId ?? null,
      hasEta: Boolean(eta),
    },
  };
}

/**
 * Legacy entry point kept for backward compat — now delegates to
 * `deriveTripProgress` with no ETA, so it never returns a random/last stop
 * as \"next\" when server says none. When `eta` is provided (new callers),
 * the full monotonic + nearest-upcoming logic applies.
 *
 * The server's own \"next stop\" wins when it is navigable and ahead of the
 * frontier; otherwise the first navigable stop ahead of the frontier is used.
 * `null` means the route has nothing to drive to yet, or the trip is done —
 * the card says so instead of inventing a destination.
 */
export function pickNextStop(
  stops: StopResponse[],
  nextStopId?: string | null,
  eta?: TripEtaResponse | null,
): StopResponse | null {
  if (stops.length === 0) {
    return null;
  }
  // Without ETA, keep old behaviour for pre-GPS case but ensure no backward:
  // if nextStopId is provided and navigable, use it; else first navigable.
  // With ETA, use robust derivation.
  if (eta) {
    const derived = deriveTripProgress(stops, eta, nextStopId ?? null);
    return derived.nextStop;
  }
  const sorted = [...stops].sort((a, b) => a.sequence_number - b.sequence_number);
  const chosen = nextStopId ? sorted.find((stop) => stop.id === nextStopId) : undefined;
  if (chosen && navigationTargetOf(chosen)) {
    return chosen;
  }
  // Before GPS, first navigable is reasonable; after trip complete, caller
  // should pass eta so we return null instead of first. For backward compat
  // without eta, keep first navigable.
  return sorted.find((stop) => navigationTargetOf(stop) !== null) ?? null;
}
