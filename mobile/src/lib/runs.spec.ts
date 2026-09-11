import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { RunResponse, StudentResponse } from '@school-bus-tracking/shared-types';
import {
  dispatchableRuns,
  runLabel,
  runStaleForRoute,
  runsForHomeStop,
  shiftLabel,
  shiftWindowLabel,
  studentRunLabel,
  timeToMinutes,
  trimSeconds,
  windowsOverlapPreview,
} from './runs.ts';

/**
 * Guards for the runs & shifts display rules used by the admin run manager,
 * the shift screens, the trip dispatch picker and the student form: run
 * labels, the home-stop run shortlist and the stale-run clear, and the
 * bus-window overlap pre-warning (the API still owns the final verdict).
 */

function run(overrides: Partial<RunResponse> & { id: string }): RunResponse {
  return {
    school_id: 'school',
    route_id: 'route-a',
    shift_id: null,
    bus_id: null,
    code: 'R-A-1',
    is_default: false,
    is_active: true,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as RunResponse;
}

describe('trimSeconds', () => {
  it('trims HH:MM:SS to HH:MM and passes HH:MM through', () => {
    assert.equal(trimSeconds('07:30:00'), '07:30');
    assert.equal(trimSeconds('07:30'), '07:30');
  });

  it('renders nothing for empty or unparseable input', () => {
    assert.equal(trimSeconds(null), '');
    assert.equal(trimSeconds(undefined), '');
    assert.equal(trimSeconds(''), '');
  });
});

describe('shiftWindowLabel', () => {
  it('joins the shift name and its window', () => {
    assert.equal(
      shiftWindowLabel({
        shift_name: 'Morning',
        shift_start_time: '07:00:00',
        shift_end_time: '11:00:00',
      }),
      'Morning 07:00–11:00',
    );
  });

  it('labels a shift-less run as the whole day', () => {
    assert.equal(
      shiftWindowLabel({ shift_name: null, shift_start_time: null, shift_end_time: null }),
      'All day (no shift)',
    );
  });
});

describe('runLabel', () => {
  it('joins code, route, bus and window; marks the default run', () => {
    const label = runLabel(
      run({
        id: 'r1',
        code: 'R-01-2',
        route_code: 'R-01',
        route_name: 'North Loop',
        bus_number: 'B-7',
        is_default: true,
        shift_name: 'Morning',
        shift_start_time: '07:00:00',
        shift_end_time: '11:00:00',
      }),
    );
    assert.equal(label, 'R-01-2 · R-01 · North Loop · B-7 · Morning 07:00–11:00 · default');
  });

  it('falls back to "No bus" when neither fleet fields are set', () => {
    assert.ok(runLabel(run({ id: 'r2' })).includes('No bus'));
  });
});

describe('shiftLabel', () => {
  it('renders the picker label with the window', () => {
    assert.equal(
      shiftLabel({ name: 'Afternoon', start_time: '12:00:00', end_time: '16:30:00' }),
      'Afternoon (12:00–16:30)',
    );
  });

  it('falls back to the bare name when times are unparseable', () => {
    assert.equal(shiftLabel({ name: 'Odd', start_time: '', end_time: '' }), 'Odd');
  });
});

describe('dispatchableRuns', () => {
  it('drops inactive runs and sorts by route then run code', () => {
    const sorted = dispatchableRuns([
      run({ id: 'b', code: 'R-2', route_code: 'R-01' }),
      run({ id: 'a', code: 'R-1', route_code: 'R-01' }),
      run({ id: 'gone', code: 'R-0', route_code: 'R-00', is_active: false }),
      run({ id: 'c', code: 'R-1', route_code: 'R-02' }),
    ]);
    assert.deepEqual(
      sorted.map((entry) => entry.id),
      ['a', 'b', 'c'],
    );
  });
});

describe('runsForHomeStop', () => {
  const runs = [
    run({ id: 'other-route', route_id: 'route-b', code: 'R-B-1' }),
    run({ id: 'inactive', route_id: 'route-a', code: 'R-A-0', is_active: false }),
    run({ id: 'second', route_id: 'route-a', code: 'R-A-2' }),
    run({ id: 'default', route_id: 'route-a', code: 'R-A-1', is_default: true }),
  ];

  it('shortlists active runs of the stop route, defaults first then by code', () => {
    assert.deepEqual(
      runsForHomeStop(runs, 'route-a').map((entry) => entry.id),
      ['default', 'second'],
    );
  });

  it('offers nothing without a route', () => {
    assert.deepEqual(runsForHomeStop(runs, null), []);
  });
});

describe('runStaleForRoute', () => {
  it('flags a run that belongs to a different route', () => {
    assert.equal(runStaleForRoute(run({ id: 'r', route_id: 'route-a' }), 'route-b'), true);
    assert.equal(runStaleForRoute(run({ id: 'r', route_id: 'route-a' }), 'route-a'), false);
  });

  it('never clears a missing run or a missing route', () => {
    assert.equal(runStaleForRoute(null, 'route-a'), false);
    assert.equal(runStaleForRoute(undefined, null), false);
    assert.equal(runStaleForRoute(run({ id: 'r' }), null), false);
  });
});

describe('studentRunLabel', () => {
  function student(overrides: Partial<StudentResponse>): StudentResponse {
    return {
      id: 's',
      school_id: 'school',
      admission_number: 'ADM-1',
      first_name: 'Ada',
      last_name: 'Lovelace',
      date_of_birth: null,
      gender: null,
      grade_level: null,
      home_stop_id: null,
      run_id: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      medical_notes: null,
      is_active: true,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
      ...overrides,
    } as StudentResponse;
  }

  it('is null without an allocated run', () => {
    assert.equal(studentRunLabel(student({})), null);
  });

  it('joins the run code and fleet number when both exist', () => {
    assert.equal(studentRunLabel(student({ run_code: 'R-01', bus_number: 'B-7' })), 'R-01 · B-7');
    assert.equal(studentRunLabel(student({ run_code: 'R-01' })), 'R-01');
  });
});

describe('timeToMinutes', () => {
  it('converts HH:MM and HH:MM:SS', () => {
    assert.equal(timeToMinutes('07:30'), 450);
    assert.equal(timeToMinutes('07:30:30'), 450.5);
  });

  it('returns null for empty or unparseable input', () => {
    assert.equal(timeToMinutes(null), null);
    assert.equal(timeToMinutes(''), null);
    assert.equal(timeToMinutes('x:y'), null);
  });
});

describe('windowsOverlapPreview', () => {
  it('treats windows as half-open (touching edges do not overlap)', () => {
    assert.equal(
      windowsOverlapPreview(
        { start_time: '07:00', end_time: '11:00' },
        { start_time: '11:00', end_time: '14:00' },
      ),
      false,
    );
  });

  it('detects partial and contained overlaps', () => {
    assert.equal(
      windowsOverlapPreview(
        { start_time: '07:00', end_time: '11:00' },
        { start_time: '10:30', end_time: '14:00' },
      ),
      true,
    );
    assert.equal(
      windowsOverlapPreview(
        { start_time: '07:00', end_time: '16:00' },
        { start_time: '09:00', end_time: '10:00' },
      ),
      true,
    );
  });

  it('treats missing times as the whole day (a shift-less run overlaps everything)', () => {
    assert.equal(
      windowsOverlapPreview(
        { start_time: null, end_time: null },
        { start_time: '09:00', end_time: '10:00' },
      ),
      true,
    );
  });
});
