import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { RunCrewRole } from '@school-bus-tracking/shared-types';
import {
  findRunConflict,
  findRunCrewConflict,
  windowsOverlap,
  type RunCandidate,
  type RunCrewCandidate,
} from './run-conflicts';
import {
  RUN_BUS_CONFLICT_MESSAGE,
  RUN_CREW_RUN_CONFLICT_MESSAGE,
  RUN_ROLE_CONFLICT_MESSAGE,
} from './runs.constants';

const RUN_1 = '11111111-1111-4111-8111-111111111111';
const RUN_2 = '22222222-2222-4222-8222-222222222222';
const BUS_1 = '33333333-3333-4333-8333-333333333333';
const BUS_2 = '44444444-4444-4444-8444-444444444444';
const DRIVER_1 = '55555555-5555-4555-8555-555555555551';
const DRIVER_2 = '55555555-5555-4555-8555-555555555552';
const CREW_1 = '66666666-6666-4666-8666-666666666661';
const CREW_2 = '66666666-6666-4666-8666-666666666662';

const MORNING = { start_time: '07:00:00', end_time: '11:00:00' };
const AFTERNOON = { start_time: '12:00:00', end_time: '17:00:00' };
const NIGHT = { start_time: '23:00:00', end_time: '01:00:00' };

function runCandidate(overrides: Partial<RunCandidate>): RunCandidate {
  return {
    id: RUN_1,
    bus_id: BUS_1,
    is_active: true,
    shift: MORNING,
    ...overrides,
  };
}

function crewCandidate(overrides: Partial<RunCrewCandidate>): RunCrewCandidate {
  return {
    id: CREW_1,
    run_id: RUN_1,
    user_id: DRIVER_1,
    role: RunCrewRole.DRIVER,
    effective_from: '2026-01-01',
    effective_to: null,
    is_active: true,
    shift: MORNING,
    ...overrides,
  };
}

describe('windowsOverlap', () => {
  it('overlaps when each window opens before the other closes (half-open edges)', () => {
    assert.equal(windowsOverlap(MORNING, { start_time: '10:59:59', end_time: '12:00:00' }), true);
    assert.equal(windowsOverlap(MORNING, { start_time: '11:00:00', end_time: '12:00:00' }), false);
    assert.equal(windowsOverlap(MORNING, { start_time: '06:00:00', end_time: '07:00:00' }), false);
  });

  it('treats a NULL shift as the whole day (00:00–24:00)', () => {
    assert.equal(windowsOverlap(null, MORNING), true);
    assert.equal(windowsOverlap(MORNING, null), true);
    assert.equal(windowsOverlap(null, null), true);
    assert.equal(windowsOverlap({ start_time: null, end_time: null }, MORNING), true);
  });

  it('handles midnight-crossing windows by splitting them', () => {
    assert.equal(windowsOverlap(NIGHT, { start_time: '00:30:00', end_time: '02:00:00' }), true);
    assert.equal(windowsOverlap(NIGHT, { start_time: '01:00:00', end_time: '02:00:00' }), false);
    assert.equal(windowsOverlap(NIGHT, { start_time: '21:00:00', end_time: '22:59:59' }), false);
    assert.equal(windowsOverlap(NIGHT, null), true);
  });
});

describe('findRunConflict (BUS)', () => {
  it('rejects the same bus on two runs in overlapping shift windows', () => {
    const conflict = findRunConflict(
      runCandidate({ id: RUN_1 }),
      runCandidate({ id: RUN_2 }),
    );
    assert.ok(conflict);
    assert.equal(conflict.kind, 'BUS');
    assert.equal(conflict.message, RUN_BUS_CONFLICT_MESSAGE);
  });

  it('allows the same bus in disjoint shift windows — tiering', () => {
    assert.equal(findRunConflict(runCandidate({ shift: MORNING }), runCandidate({ id: RUN_2, shift: AFTERNOON })), null);
  });

  it('allows different buses in the same window', () => {
    assert.equal(findRunConflict(runCandidate({}), runCandidate({ id: RUN_2, bus_id: BUS_2 })), null);
  });

  it('allows two runs of the same route to change buses (ROUTE_BUS is gone)', () => {
    // The old engine rejected a route changing buses mid-overlap. Runs make
    // that legal: different runs of one route may use different vehicles.
    assert.equal(findRunConflict(runCandidate({}), runCandidate({ id: RUN_2, bus_id: BUS_2 })), null);
  });

  it('treats a NULL-shift run as whole day and conflicts with everything', () => {
    const legacy = runCandidate({ id: RUN_2, shift: null });
    assert.equal(findRunConflict(runCandidate({}), legacy)?.kind, 'BUS');
    assert.equal(findRunConflict(runCandidate({ shift: AFTERNOON }), legacy)?.kind, 'BUS');
    assert.equal(findRunConflict(runCandidate({}), runCandidate({ id: RUN_2, shift: null }))?.kind, 'BUS');
  });

  it('ignores inactive runs and the run itself', () => {
    assert.equal(findRunConflict(runCandidate({}), runCandidate({ id: RUN_2, is_active: false })), null);
    assert.equal(findRunConflict(runCandidate({}), runCandidate({ id: RUN_2, bus_id: null })), null);
    assert.equal(findRunConflict(runCandidate({}), runCandidate({})), null);
  });
});

describe('findRunCrewConflict (RUN_ROLE / CREW_RUN)', () => {
  it('enforces RUN_ROLE — one role on one run, overlapping roster periods', () => {
    const conflict = findRunCrewConflict(crewCandidate({}), crewCandidate({ id: CREW_2 }));
    assert.ok(conflict);
    assert.equal(conflict.kind, 'RUN_ROLE');
    assert.equal(conflict.message, RUN_ROLE_CONFLICT_MESSAGE);
  });

  it('allows the driver + conductor pair and non-overlapping rotation', () => {
    const conductor = crewCandidate({ id: CREW_2, role: RunCrewRole.CONDUCTOR });
    assert.equal(findRunCrewConflict(crewCandidate({}), conductor), null);

    const later = crewCandidate({
      id: CREW_2,
      effective_from: '2026-07-01',
      effective_to: null,
    });
    const first = crewCandidate({ effective_to: '2026-06-30' });
    assert.equal(findRunCrewConflict(first, later), null);
  });

  it('rejects CREW_RUN when the same person covers two overlapping runs', () => {
    const otherRun = crewCandidate({
      id: CREW_2,
      run_id: RUN_2,
      role: RunCrewRole.CONDUCTOR,
      shift: MORNING,
    });
    const conflict = findRunCrewConflict(crewCandidate({}), otherRun);
    assert.ok(conflict);
    assert.equal(conflict.kind, 'CREW_RUN');
    assert.equal(conflict.message, RUN_CREW_RUN_CONFLICT_MESSAGE);
  });

  it('allows tiering: the same person on two runs in disjoint shift windows', () => {
    const afternoon = crewCandidate({
      id: CREW_2,
      run_id: RUN_2,
      role: RunCrewRole.CONDUCTOR,
      shift: AFTERNOON,
    });
    assert.equal(findRunCrewConflict(crewCandidate({}), afternoon), null);
  });

  it('allows the same person sequentially: roster periods do not overlap', () => {
    const later = crewCandidate({
      id: CREW_2,
      run_id: RUN_2,
      effective_from: '2026-07-01',
      shift: MORNING,
    });
    const first = crewCandidate({ effective_to: '2026-06-30' });
    assert.equal(findRunCrewConflict(first, later), null);
  });

  it('treats a NULL shift as whole day for the crew rule too', () => {
    const legacyRun = crewCandidate({ id: CREW_2, run_id: RUN_2, shift: null });
    assert.equal(findRunCrewConflict(crewCandidate({}), legacyRun)?.kind, 'CREW_RUN');
  });

  it('reports RUN_ROLE before CREW_RUN when the same run matches both', () => {
    const conflict = findRunCrewConflict(crewCandidate({}), crewCandidate({ id: CREW_2 }));
    assert.equal(conflict?.kind, 'RUN_ROLE');
  });

  it('ignores inactive crew rows and the row itself', () => {
    assert.equal(
      findRunCrewConflict(crewCandidate({}), crewCandidate({ id: CREW_2, run_id: RUN_2, is_active: false })),
      null,
    );
    assert.equal(findRunCrewConflict(crewCandidate({}), crewCandidate({})), null);
    assert.equal(
      findRunCrewConflict(
        crewCandidate({}),
        crewCandidate({ id: CREW_2, run_id: RUN_2, user_id: DRIVER_2 }),
      ),
      null,
    );
  });

  it('handles midnight-crossing windows when comparing two runs', () => {
    // Both runs in the same overnight window (23:00–01:00) must conflict;
    // an overnight window vs the disjoint 07:00–11:00 window must not.
    const nightRun = crewCandidate({ id: CREW_2, run_id: RUN_2, shift: NIGHT });
    // Two runs sharing the overnight window conflict.
    assert.equal(findRunCrewConflict(crewCandidate({ shift: NIGHT }), nightRun)?.kind, 'CREW_RUN');
    // Overnight vs the disjoint morning window stays legal — same tiering.
    assert.equal(findRunCrewConflict(crewCandidate({}), nightRun), null);
  });
});
