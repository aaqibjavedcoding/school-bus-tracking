import { RouteAssignmentRole } from '@school-bus-tracking/shared-types';
import {
  ROUTE_ASSIGNMENT_BUS_CONFLICT_MESSAGE,
  ROUTE_ASSIGNMENT_CREW_ROUTE_CONFLICT_MESSAGE,
  ROUTE_ASSIGNMENT_ROUTE_BUS_CONFLICT_MESSAGE,
  ROUTE_ASSIGNMENT_ROUTE_ROLE_CONFLICT_MESSAGE,
} from './assignments.constants';

/**
 * Pure conflict rules shared by the assignment service and the spreadsheet
 * import path.
 *
 * `RouteAssignment` is one row per crew member (driver *or* conductor) per
 * period. Two rows may share the same route, bus and period when they carry
 * different roles (the driver + conductor pair), and the same crew member may
 * serve several routes *sequentially* (non-overlapping periods). What is never
 * allowed is a crew member (or a vehicle, or a role slot) covering two
 * different routes during an overlapping active period.
 */
export interface AssignmentCandidate {
  route_id: string;
  /** Vehicle used for this assignment; null while the fleet is undecided. */
  bus_id: string | null;
  /** Crew member (driver or conductor) being assigned. */
  user_id: string;
  /** Role the user plays on the route for the duration of the assignment. */
  role: RouteAssignmentRole;
  /** First day (inclusive) the assignment applies. */
  effective_from: string;
  /** Last day (inclusive). Null means "open ended". */
  effective_to: string | null;
  is_active: boolean;
}

/** Machine-readable conflict kind, mirroring the message constants. */
export type AssignmentConflictKind = 'ROUTE_ROLE' | 'ROUTE_BUS' | 'BUS' | 'CREW_ROUTE';

export interface AssignmentConflict {
  kind: AssignmentConflictKind;
  message: string;
}

/** Inclusive dates only — two periods overlap when each starts before/on the other's end. */
export function periodsOverlap(
  a: Pick<AssignmentCandidate, 'effective_from' | 'effective_to'>,
  b: Pick<AssignmentCandidate, 'effective_from' | 'effective_to'>,
): boolean {
  const aEnd = a.effective_to ?? '9999-12-31';
  const bEnd = b.effective_to ?? '9999-12-31';
  return a.effective_from <= bEnd && b.effective_from <= aEnd;
}

/**
 * Returns the first active overlap conflict between two roster rows, or null
 * when the pair is legal. Checks run in a stable precedence order so callers
 * (API and imports) report the same root cause:
 *
 * 1. one route already has an active row for the same role,
 * 2. one route cannot change buses during an overlap,
 * 3. one bus cannot serve two routes during an overlap,
 * 4. one crew member cannot cover two different routes during an overlap.
 *
 * Inactive rows never conflict, and the driver + conductor pair on the same
 * route remains legal regardless of the shared bus/period.
 */
export function findAssignmentConflict(
  candidate: AssignmentCandidate,
  other: AssignmentCandidate,
): AssignmentConflict | null {
  if (!candidate.is_active || !other.is_active) {
    return null;
  }
  if (!periodsOverlap(candidate, other)) {
    return null;
  }

  if (candidate.route_id === other.route_id && candidate.role === other.role) {
    return { kind: 'ROUTE_ROLE', message: ROUTE_ASSIGNMENT_ROUTE_ROLE_CONFLICT_MESSAGE };
  }

  if (
    candidate.route_id === other.route_id &&
    candidate.bus_id !== null &&
    other.bus_id !== null &&
    candidate.bus_id !== other.bus_id
  ) {
    return { kind: 'ROUTE_BUS', message: ROUTE_ASSIGNMENT_ROUTE_BUS_CONFLICT_MESSAGE };
  }

  if (
    candidate.bus_id !== null &&
    other.bus_id !== null &&
    candidate.bus_id === other.bus_id &&
    candidate.route_id !== other.route_id
  ) {
    return { kind: 'BUS', message: ROUTE_ASSIGNMENT_BUS_CONFLICT_MESSAGE };
  }

  if (candidate.user_id === other.user_id && candidate.route_id !== other.route_id) {
    return { kind: 'CREW_ROUTE', message: ROUTE_ASSIGNMENT_CREW_ROUTE_CONFLICT_MESSAGE };
  }

  return null;
}
