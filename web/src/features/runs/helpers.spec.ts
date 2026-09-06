import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ParentChildSummary, RunResponse } from '@school-bus-tracking/shared-types';
import {
  childRunHeadline,
  dispatchableRuns,
  runLabel,
  runStaleForRoute,
  runsForHomeStop,
  shiftWindowLabel,
  studentRunLabel,
  timeToMinutes,
  trimSeconds,
  windowsOverlapPreview,
} from './helpers.ts';

function makeRun(overrides: Partial<RunResponse> = {}): RunResponse {
  return {
    id: `run-${Math.random()}`,
    school_id: 'school-1',
    route_id: 'route-1',
    shift_id: null,
    bus_id: null,
    code: 'R-01',
    is_default: false,
    is_active: true,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('runs helpers — formatting', () => {
  it('trimSeconds drops the seconds part and tolerates junk', () => {
    assert.equal(trimSeconds('07:30:00'), '07:30');
    assert.equal(trimSeconds('12:05'), '12:05');
    assert.equal(trimSeconds(null), '');
    assert.equal(trimSeconds('lunch'), '');
  });

  it('shiftWindowLabel renders the window or the whole-day note', () => {
    assert.equal(
      shiftWindowLabel(
        makeRun({ shift_name: 'Morning', shift_start_time: '07:00:00', shift_end_time: '11:00:00' }),
      ),
      'Morning 07:00–11:00',
    );
    assert.equal(shiftWindowLabel(makeRun()), 'All day (no shift)');
  });

  it('runLabel composes code, route, bus and clock without leaking ids', () => {
    const label = runLabel(
      makeRun({
        code: 'NL-2',
        route_name: 'North Loop',
        route_code: 'NL',
        bus_number: 'Bus 7',
        shift_name: 'Afternoon',
        shift_start_time: '12:00:00',
        shift_end_time: '17:00:00',
      }),
    );
    assert.equal(label, 'NL-2 · NL · North Loop · Bus 7 · Afternoon 12:00–17:00');
    assert.match(runLabel(makeRun({ bus_id: null })), /No bus/);
    assert.match(runLabel(makeRun({ is_default: true })), /default$/);
  });
});

describe('runs helpers — pickers', () => {
  it('dispatchableRuns hides inactive runs and groups by route then code', () => {
    const runs = [
      makeRun({ id: 'a', code: 'B-01', route_code: 'B', is_active: true }),
      makeRun({ id: 'b', code: 'A-02', route_code: 'A', is_active: true }),
      makeRun({ id: 'c', code: 'A-01', route_code: 'A', is_active: false }),
    ];
    assert.deepEqual(
      dispatchableRuns(runs).map((run) => run.id),
      ['b', 'a'],
    );
  });

  it('runsForHomeStop only offers the stop route, default first', () => {
    const runs = [
      makeRun({ id: 'other', route_id: 'route-2', code: 'R-9' }),
      makeRun({ id: 'second', route_id: 'route-1', code: 'R-02' }),
      makeRun({ id: 'first', route_id: 'route-1', code: 'R-01', is_default: true }),
      makeRun({ id: 'inactive', route_id: 'route-1', code: 'R-00', is_active: false }),
    ];
    assert.deepEqual(
      runsForHomeStop(runs, 'route-1').map((run) => run.id),
      ['first', 'second'],
    );
    assert.deepEqual(runsForHomeStop(runs, null), []);
  });

  it('runStaleForRoute flags the cross-route selection only', () => {
    assert.equal(runStaleForRoute(makeRun({ route_id: 'route-1' }), 'route-2'), true);
    assert.equal(runStaleForRoute(makeRun({ route_id: 'route-1' }), 'route-1'), false);
    assert.equal(runStaleForRoute(makeRun({ route_id: 'route-1' }), null), false);
    assert.equal(runStaleForRoute(null, 'route-2'), false);
  });
});

describe('runs helpers — labels and previews', () => {
  it('studentRunLabel pairs code and bus, null when unallocated', () => {
    assert.equal(
      studentRunLabel({ run_code: 'R-01', bus_number: 'Bus 7' } as never),
      'R-01 · Bus 7',
    );
    assert.equal(studentRunLabel({ run_code: 'R-01', bus_number: null } as never), 'R-01');
    assert.equal(studentRunLabel({ run_code: null, bus_number: 'Bus 7' } as never), null);
  });

  it('childRunHeadline prefers the run block…', () => {
    const child = {
      run: {
        code: 'NL-1',
        is_default: true,
        route_name: 'North Loop',
        bus_number: 'Bus 7',
        registration_number: 'ABC-123',
        shift_name: 'Morning',
        shift_start_time: '07:00:00',
        shift_end_time: '11:00:00',
      },
      today: { bus: null },
      home_stop: { route_name: 'North Loop' },
    } as unknown as ParentChildSummary;
    assert.equal(
      childRunHeadline(child),
      'Run NL-1 · Bus 7 · ABC-123 · Morning 07:00–11:00',
    );
  });

  it('…and falls back to the legacy route view for a run-less tenant', () => {
    const legacy = {
      run: null,
      today: { bus: { bus_number: 'Bus 3', registration_number: 'XYZ' } },
      home_stop: { route_name: 'South Loop' },
    } as unknown as ParentChildSummary;
    assert.equal(childRunHeadline(legacy), 'Bus 3 · South Loop');
    const nothing = {
      run: null,
      today: { bus: null },
      home_stop: { route_name: null },
    } as unknown as ParentChildSummary;
    assert.equal(childRunHeadline(nothing), 'No bus assigned');
  });

  it('timeToMinutes parses HH:MM[:SS] only', () => {
    assert.equal(timeToMinutes('07:30'), 450);
    assert.equal(timeToMinutes('07:30:30'), 450.5);
    assert.equal(timeToMinutes(null), null);
  });

  it('windowsOverlapPreview mirrors the §4.1 half-open rule', () => {
    const morning = { start_time: '07:00:00', end_time: '11:00:00' };
    const afternoon = { start_time: '12:00:00', end_time: '17:00:00' };
    const touching = { start_time: '11:00:00', end_time: '12:00:00' };
    assert.equal(windowsOverlapPreview(morning, afternoon), false);
    assert.equal(windowsOverlapPreview(morning, { start_time: '10:00:00', end_time: '13:00:00' }), true);
    // Back-to-back windows share an instant but no minute.
    assert.equal(windowsOverlapPreview(morning, touching), false);
    // A null window is the whole day — it overlaps everything.
    assert.equal(windowsOverlapPreview({ start_time: null, end_time: null }, afternoon), true);
  });
});
