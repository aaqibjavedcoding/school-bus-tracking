import { ApiClientError } from '@school-bus-tracking/api-client';
import { performAttendanceAction } from '../src/features/crew/attendance';
import {
  allowedTransitionsFrom,
  isTripOpen,
  transitionTrip,
} from '../src/features/shared/trip-lifecycle';
import { TripStatus } from '@school-bus-tracking/shared-types';

/**
 * Attendance 409 handling + lifecycle affordances (Task 23 §D). The backend
 * owns the state machine; these are the transport rules the crew app relies
 * on — offline first-refusal, server-row merge, conflict → refresh message.
 */

function apiWith(
  impl: Partial<Record<'boardTripStudent' | 'dropTripStudent' | 'updateTripStatus', jest.Mock>>,
) {
  return impl as never;
}

describe('performAttendanceAction', () => {
  it('never sends anything while offline — and says so loudly', async () => {
    const board = jest.fn();
    const result = await performAttendanceAction({
      api: apiWith({ boardTripStudent: board }),
      tripId: 'trip-1',
      studentId: 'student-1',
      action: 'board',
      online: false,
    });
    expect(board).not.toHaveBeenCalled();
    expect(result.kind).toBe('offline');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/nothing was recorded/i);
  });

  it('returns the server row on success', async () => {
    const row = { student_id: 'student-1', status: 'BOARDED', boarded_at: 'now' };
    const result = await performAttendanceAction({
      api: apiWith({ boardTripStudent: jest.fn(async () => ({ data: row })) }),
      tripId: 'trip-1',
      studentId: 'student-1',
      action: 'board',
      online: true,
    });
    expect(result).toMatchObject({ ok: true, kind: 'recorded', row });
  });

  it('maps a 409 to the conflict path (duplicate tap / another device won)', async () => {
    const result = await performAttendanceAction({
      api: apiWith({
        dropTripStudent: jest.fn(async () => {
          throw new ApiClientError('Already dropped off', 409, { code: 'NOT_BOARDED' });
        }),
      }),
      tripId: 'trip-1',
      studentId: 'student-1',
      action: 'drop',
      online: true,
    });
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('conflict');
    expect(result.message).toMatch(/refreshed/i);
  });

  it('treats an in-flight network failure as offline, not failure-of-record', async () => {
    const result = await performAttendanceAction({
      api: apiWith({
        boardTripStudent: jest.fn(async () => {
          throw new ApiClientError('Network request failed', 0);
        }),
      }),
      tripId: 'trip-1',
      studentId: 'student-1',
      action: 'board',
      online: true,
    });
    expect(result.kind).toBe('offline');
  });

  it('surfaces other server errors verbatim', async () => {
    const result = await performAttendanceAction({
      api: apiWith({
        boardTripStudent: jest.fn(async () => {
          throw new ApiClientError('Trip is closed', 403);
        }),
      }),
      tripId: 'trip-1',
      studentId: 'student-1',
      action: 'board',
      online: true,
    });
    expect(result.kind).toBe('error');
    expect(result.message).toContain('Trip is closed');
  });
});

describe('trip lifecycle affordances (display-only; the API re-validates)', () => {
  it('SCHEDULED can board, start directly, or cancel — nothing else', () => {
    expect(allowedTransitionsFrom(TripStatus.SCHEDULED).sort()).toEqual(
      [TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.CANCELLED].sort(),
    );
  });

  it('terminal states offer no transitions at all', () => {
    expect(allowedTransitionsFrom(TripStatus.COMPLETED)).toEqual([]);
    expect(allowedTransitionsFrom(TripStatus.CANCELLED)).toEqual([]);
  });

  it('IN_PROGRESS can complete or cancel', () => {
    expect(allowedTransitionsFrom(TripStatus.IN_PROGRESS).sort()).toEqual(
      [TripStatus.COMPLETED, TripStatus.CANCELLED].sort(),
    );
  });

  it('open = SCHEDULED/BOARDING/IN_PROGRESS (GPS + attendance gates)', () => {
    expect(isTripOpen(TripStatus.SCHEDULED)).toBe(true);
    expect(isTripOpen(TripStatus.BOARDING)).toBe(true);
    expect(isTripOpen(TripStatus.IN_PROGRESS)).toBe(true);
    expect(isTripOpen(TripStatus.COMPLETED)).toBe(false);
    expect(isTripOpen(TripStatus.CANCELLED)).toBe(false);
  });

  it('transitionTrip posts ONLY the status (+ reason when cancelling) — no actor/tenant fields', async () => {
    const updateTripStatus = jest.fn(async () => ({
      data: { id: 'trip-1', status: TripStatus.BOARDING },
    }));
    const result = await transitionTrip(
      apiWith({ updateTripStatus }),
      'trip-1',
      TripStatus.BOARDING,
    );
    expect(result.ok).toBe(true);
    expect(updateTripStatus).toHaveBeenCalledWith('trip-1', { status: TripStatus.BOARDING });
    const body = (updateTripStatus as unknown as jest.Mock).mock.calls[0][1] as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(body).sort()).toEqual(['status']);
  });

  it('marks 409/400 rejections as stale so the screen refetches', async () => {
    const updateTripStatus = jest.fn(async (_id: string, _body: unknown) => {
      throw new ApiClientError('Illegal transition', 409);
    });
    const result = await transitionTrip(
      apiWith({ updateTripStatus }),
      'trip-1',
      TripStatus.COMPLETED,
    );
    expect(result).toMatchObject({ ok: false, stale: true });
  });

  it('an empty data envelope is an error, not a silent success', async () => {
    const updateTripStatus = jest.fn(async (_id: string, _body: unknown) => ({
      data: null,
      error: { message: 'nope' },
    }));
    const result = await transitionTrip(
      apiWith({ updateTripStatus }),
      'trip-1',
      TripStatus.CANCELLED,
      'rain',
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain('nope');
  });
});
