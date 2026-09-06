import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import type { ParentChildRunSummary } from '@school-bus-tracking/shared-types';
import { runSummaryLine, shiftWindow } from './run-summary.ts';

const run = (over: Partial<ParentChildRunSummary> = {}): ParentChildRunSummary => ({
  id: 'run-1',
  code: 'R-02',
  is_default: false,
  route_id: 'route-1',
  route_code: 'RT-1',
  route_name: 'North Loop',
  shift_name: 'Morning',
  shift_start_time: '07:15:00',
  shift_end_time: '08:05:00',
  bus_id: 'bus-1',
  bus_number: 'Bus 7',
  registration_number: 'KL-07-AB-1234',
  driver_name: 'Priya M',
  conductor_name: 'Ravi K',
  ...over,
});

describe('runSummaryLine', () => {
  test('null for a child without a run', () => {
    assert.equal(runSummaryLine(null), null);
    assert.equal(runSummaryLine(undefined), null);
  });

  test('joins code, window, bus and driver', () => {
    assert.equal(runSummaryLine(run()), 'Run R-02 · 07:15–08:05 · Bus 7 · Priya M');
  });

  test('drops missing pieces without leaving separators', () => {
    assert.equal(
      runSummaryLine(
        run({ shift_start_time: null, shift_end_time: null, bus_number: null, registration_number: null, driver_name: null }),
      ),
      'Run R-02',
    );
  });

  test('falls back to the registration number when there is no display number', () => {
    assert.match(runSummaryLine(run({ bus_number: null })) ?? '', /KL-07-AB-1234/);
  });
});

describe('shiftWindow', () => {
  test('trims seconds and joins with an en dash', () => {
    assert.equal(shiftWindow(run()), '07:15–08:05');
  });

  test('null when either side of the window is missing', () => {
    assert.equal(shiftWindow({ shift_start_time: '07:15:00', shift_end_time: null }), null);
    assert.equal(shiftWindow({ shift_start_time: null, shift_end_time: '08:05' }), null);
  });

  test('tolerates HH:MM without seconds', () => {
    assert.equal(shiftWindow({ shift_start_time: '07:15', shift_end_time: '08:05' }), '07:15–08:05');
  });
});
