import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TripAttendanceStatus } from '@school-bus-tracking/shared-types';
import type { TripStudentAttendanceResponse } from '@school-bus-tracking/shared-types';
import { KID_ROW_WINDOW, summarizeNextStopKids } from './next-stop-kids.ts';

const STOP_A = 'stop-a';
const STOP_B = 'stop-b';

const stops = [
  { id: STOP_A, name: 'Green Park Stop', sequence_number: 4 },
  { id: STOP_B, name: 'Oak Ave', sequence_number: 5 },
];

function student(
  id: string,
  stopId: string,
  status: TripAttendanceStatus = TripAttendanceStatus.PENDING,
  stopName = 'Green Park Stop',
  sequence = 4,
): TripStudentAttendanceResponse {
  return {
    id: null,
    school_id: 'school-1',
    trip_id: 'trip-1',
    student_id: id,
    admission_number: id.toUpperCase(),
    first_name: `First${id}`,
    last_name: `Last${id}`,
    grade_level: null,
    stop_id: stopId,
    stop_name: stopName,
    stop_sequence_number: sequence,
    status,
    boarded_at: null,
    boarded_by: null,
    dropped_at: null,
    dropped_by: null,
    created_at: null,
    updated_at: null,
  };
}

describe('summarizeNextStopKids', () => {
  it('returns null exactly when there is no next stop', () => {
    assert.equal(summarizeNextStopKids([], stops, null), null);
  });

  it('slices the manifest to the next stop, in manifest order, with the total', () => {
    const students = [
      student('s1', STOP_A),
      student('s2', STOP_B),
      student('s3', STOP_A, TripAttendanceStatus.BOARDED),
    ];
    const summary = summarizeNextStopKids(students, stops, STOP_A);
    assert.ok(summary);
    assert.equal(summary.stopId, STOP_A);
    assert.equal(summary.stopName, 'Green Park Stop');
    assert.equal(summary.sequenceNumber, 4);
    assert.equal(summary.total, 2);
    assert.equal(summary.hiddenCount, 0);
    assert.equal(
      summary.pendingCount,
      1,
      'only the PENDING kid is waiting — boarded kids stay on total',
    );
    assert.deepEqual(
      summary.kids.map((kid) => [kid.studentId, kid.status]),
      [
        ['s1', TripAttendanceStatus.PENDING],
        ['s3', TripAttendanceStatus.BOARDED],
      ],
    );
    assert.equal(summary.kids[0].name, 'Firsts1 Lasts1');
  });

  it('counts pending kids over ALL rows, not the windowed slice', () => {
    // 13 PENDING + 1 BOARDED: the count line must say 13 waiting, even though
    // only the first 8 names render.
    const students = [
      ...Array.from({ length: KID_ROW_WINDOW + 5 }, (_, index) => student(`s${index}`, STOP_A)),
      student('sb', STOP_A, TripAttendanceStatus.BOARDED),
    ];
    const summary = summarizeNextStopKids(students, stops, STOP_A);
    assert.ok(summary);
    assert.equal(summary.total, KID_ROW_WINDOW + 6);
    assert.equal(summary.pendingCount, KID_ROW_WINDOW + 5);
    assert.equal(summary.hiddenCount, 6);
  });

  it('windows long lists at KID_ROW_WINDOW and reports the hidden count', () => {
    const students = Array.from({ length: KID_ROW_WINDOW + 5 }, (_, index) =>
      student(`s${index}`, STOP_A),
    );
    const summary = summarizeNextStopKids(students, stops, STOP_A);
    assert.ok(summary);
    assert.equal(summary.total, KID_ROW_WINDOW + 5);
    assert.equal(summary.kids.length, KID_ROW_WINDOW);
    assert.equal(summary.hiddenCount, 5);
  });

  it('reports a zero-kid stop (not an error) and falls back to row stop data', () => {
    const empty = summarizeNextStopKids([student('s1', STOP_B)], stops, STOP_A);
    assert.deepEqual(
      { total: empty?.total, kids: empty?.kids.length, stopName: empty?.stopName },
      { total: 0, kids: 0, stopName: 'Green Park Stop' },
    );
    // The next stop is not in `stops` (stale cache) — the rows still know it.
    const fallback = summarizeNextStopKids(
      [student('s9', 'stop-x', TripAttendanceStatus.PENDING, 'Unlisted Lane', 7)],
      stops,
      'stop-x',
    );
    assert.equal(fallback?.stopName, 'Unlisted Lane');
    assert.equal(fallback?.sequenceNumber, 7);
    assert.equal(fallback?.total, 1);
  });
});
