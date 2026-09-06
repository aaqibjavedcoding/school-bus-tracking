import { RunCrewRole } from '@school-bus-tracking/shared-types';
import {
  RUN_BUS_CONFLICT_MESSAGE,
  RUN_CREW_RUN_CONFLICT_MESSAGE,
  RUN_ROLE_CONFLICT_MESSAGE,
} from './runs.constants';

/**
 * The run-based conflict engine — `docs/operating-model.md` §4.
 *
 * This is the Session 2B successor to
 * `modules/assignments/assignment-conflicts.ts`. The old engine compared
 * roster **dates** (`route_assignments.effective_from/to`) and therefore read
 * "the same bus at 07:00 and at 13:00 on one day" as a clash: a route could
 * only ever legally hold one bus and one crew pair. The new engine compares
 * **shift windows**, so a run in the morning shift and a run in the afternoon
 * shift are provably legal on the same bus/crew member — tiering.
 *
 * Rule table (§4.2):
 *
 * | Kind | Meaning | Change from the old engine |
 * | --- | --- | --- |
 * | `RUN_ROLE` | one run, one role, overlapping roster windows | New granularity (was route-level `ROUTE_ROLE`) |
 * | `BUS` | one bus, two **runs**, overlapping **shift windows** | Date test → window test. **This is tiering.** |
 * | `CREW_RUN` | one person, two **runs**, overlapping **shift windows** | Date test → window test (renamed from `CREW_ROUTE`) |
 *
 * `ROUTE_ROLE` and `ROUTE_BUS` are deliberately **gone**: several runs of one
 * route *should* use different buses and crews — that is the point of runs.
 *
 * A run with a `NULL` shift (a legacy default run) has no window and cannot be
 * compared, so §4.3 treats it as occupying **the whole day** (00:00–24:00). It
 * therefore conflicts with every other run of the bus/crew member, which
 * reproduces today's behaviour exactly for pre-existing data while leaving the
 * migration incentive intact: assigning a shift unlocks tiering.
 *
 * The module is pure and importable with no HTTP dependencies, so the spread-
 * sheet import path and the API services share exactly the same rules
 * (§4.4.3).
 */

/** A shift window as stored on `shifts`; `HH:MM:SS` wall-clock strings. */
export interface RunWindow {
  start_time: string | null;
  end_time: string | null;
}

/** A candidate run row for the cross-run `BUS` rule. */
export interface RunCandidate {
  id: string;
  /** Vehicle driving this run; null while the fleet is undecided. */
  bus_id: string | null;
  is_active: boolean;
  /** The run's shift window; null (or a null window) = whole day. */
  shift: RunWindow | null;
}

/** A candidate `run_crew` row for the `RUN_ROLE` / `CREW_RUN` rules. */
export interface RunCrewCandidate {
  id: string;
  run_id: string;
  user_id: string;
  role: RunCrewRole;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  /** The window of the run this roster row is attached to. */
  shift: RunWindow | null;
}

/** Machine-readable conflict kind, mirroring the §4.2 rule table. */
export type RunConflictKind = 'RUN_ROLE' | 'BUS' | 'CREW_RUN';

export interface RunConflict {
  kind: RunConflictKind;
  message: string;
}

const DAY_MINUTES = 24 * 60;
/**
 * Inclusive dates only — two roster periods overlap when each starts
 * before/on the other's end. `NULL effective_to` is open ended.
 */
export function periodsOverlap(
  a: Pick<RunCrewCandidate, 'effective_from' | 'effective_to'>,
  b: Pick<RunCrewCandidate, 'effective_from' | 'effective_to'>,
): boolean {
  const aEnd = a.effective_to ?? '9999-12-31';
  const bEnd = b.effective_to ?? '9999-12-31';
  return a.effective_from <= bEnd && b.effective_from <= aEnd;
}

/**
 * `HH:MM[:SS]` → minutes since midnight; `24:00:00` is the end of the day
 * (1440), so whole-day windows compare correctly against `23:59:59`.
 */
function toMinutes(time: string): number {
  const [hours, minutes, seconds = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes) + (seconds ? Number(seconds) / 60 : 0);
}

/**
 * The window as half-open `[start, end)` segments on the 24-hour circle.
 *
 * A window that crosses midnight (`end_time <= start_time`, e.g.
 * `23:00–01:00`) is split into two segments; the schema's
 * `ck_shifts_window (end_time > start_time)` currently forbids storing one,
 * but the engine stays total so a future `ck` relaxation cannot silently
 * change the semantics. A zero-length window matches nothing, and a `NULL`
 * shift is the whole day ([00:00, 24:00)).
 */
function windowSegments(window: RunWindow | null): Array<[number, number]> {
  if (!window || window.start_time == null || window.end_time == null) {
    return [[0, DAY_MINUTES]];
  }
  const start = toMinutes(window.start_time);
  const end = toMinutes(window.end_time);
  if (end > start) {
    return [[start, end]];
  }
  if (end === start) {
    return [];
  }
  return [
    [start, DAY_MINUTES],
    [0, end],
  ];
}

function segmentsOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/**
 * Two run windows overlap when each opens before the other closes (§4.1).
 * A `NULL` shift is the whole day, so it overlaps everything — including
 * another `NULL`-shift run, which is exactly the old date-granular behaviour.
 */
export function windowsOverlap(a: RunWindow | null, b: RunWindow | null): boolean {
  const segmentsA = windowSegments(a);
  const segmentsB = windowSegments(b);
  return segmentsA.some((segmentA) => segmentsB.some((segmentB) => segmentsOverlap(segmentA, segmentB)));
}

/**
 * Returns the first active overlap conflict between two runs, or null when the
 * pair is legal. Only the `BUS` rule lives here; crew rules go through
 * {@link findRunCrewConflict}. Inactive runs never conflict, and the same run
 * never conflicts with itself.
 */
export function findRunConflict(
  candidate: RunCandidate,
  other: RunCandidate,
): RunConflict | null {
  if (!candidate.is_active || !other.is_active) {
    return null;
  }
  if (candidate.id === other.id) {
    return null;
  }
  if (
    candidate.bus_id !== null &&
    other.bus_id !== null &&
    candidate.bus_id === other.bus_id &&
    windowsOverlap(candidate.shift, other.shift)
  ) {
    return { kind: 'BUS', message: RUN_BUS_CONFLICT_MESSAGE };
  }
  return null;
}

/**
 * Returns the first active overlap conflict between two roster rows, or null
 * when the pair is legal. Checks run in a stable precedence order so the API
 * and the import path report the same root cause (§4.2):
 *
 * 1. `RUN_ROLE` — one run already has an active row for the same role;
 * 2. `CREW_RUN` — one crew member is rostered on two runs whose **shift
 *    windows** overlap.
 *
 * Both rules require the **roster periods** to overlap first; the pair then
 * only conflicts when the runs' clocks also collide. Non-overlapping roster
 * dates remain legal even in the same window (rotation over time), and the
 * driver + conductor pair on one run stays legal regardless.
 */
export function findRunCrewConflict(
  candidate: RunCrewCandidate,
  other: RunCrewCandidate,
): RunConflict | null {
  if (!candidate.is_active || !other.is_active) {
    return null;
  }
  if (candidate.id === other.id) {
    return null;
  }
  if (!periodsOverlap(candidate, other)) {
    return null;
  }

  if (candidate.run_id === other.run_id && candidate.role === other.role) {
    return { kind: 'RUN_ROLE', message: RUN_ROLE_CONFLICT_MESSAGE };
  }

  if (
    candidate.user_id === other.user_id &&
    candidate.run_id !== other.run_id &&
    windowsOverlap(candidate.shift, other.shift)
  ) {
    return { kind: 'CREW_RUN', message: RUN_CREW_RUN_CONFLICT_MESSAGE };
  }

  return null;
}
