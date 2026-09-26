import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LIVE_TRACKING_EVENTS, TripAttendanceStatus } from '@school-bus-tracking/shared-types';
import { attachTripRoomEvents, type TripRoomSocket } from './trip-room-events.ts';

/**
 * The trip-room subscription wiring behind both live-tracking hooks.
 *
 * What is pinned here fails silently in the field: a forgotten `off` leaks
 * frames into a remounted screen, a missing trip guard crosses two trips on
 * the shared socket, and a misspelled event constant delivers nothing at
 * all. The socket is a plain fake — the module is pure by design.
 */

const TRIP_A = '55555555-5555-4555-8555-555555550001';
const TRIP_B = '55555555-5555-4555-8555-555555550002';

type FrameHandler = (payload: unknown) => void;

interface FakeSocket extends TripRoomSocket {
  registrations: Map<string, Set<FrameHandler>>;
  emit(event: string, payload: unknown): void;
  listenerCount(event: string): number;
}

function makeSocket(): FakeSocket {
  const registrations = new Map<string, Set<FrameHandler>>();
  return {
    registrations,
    on(event, handler) {
      let set = registrations.get(event);
      if (!set) {
        set = new Set();
        registrations.set(event, set);
      }
      set.add(handler);
    },
    off(event, handler) {
      registrations.get(event)?.delete(handler);
    },
    emit(event, payload) {
      for (const handler of registrations.get(event) ?? []) {
        handler(payload);
      }
    },
    listenerCount(event) {
      return registrations.get(event)?.size ?? 0;
    },
  };
}

interface RecordedCall {
  handler: string;
  payload: unknown;
}

function makeHandlers() {
  const calls: RecordedCall[] = [];
  const record = (handler: string) => (payload: unknown) => {
    calls.push({ handler, payload });
  };
  const handlers = {
    onLocation: record('onLocation'),
    onTrackingStarted: record('onTrackingStarted'),
    onTrackingStopped: record('onTrackingStopped'),
    onEtaUpdate: record('onEtaUpdate'),
    onStopArrived: record('onStopArrived'),
    onStudentAttendance: record('onStudentAttendance'),
  };
  return { calls, handlers };
}

describe('attachTripRoomEvents', () => {
  it('registers exactly the six server → room trip events', () => {
    const socket = makeSocket();
    const { handlers } = makeHandlers();

    attachTripRoomEvents(socket, TRIP_A, handlers);

    const expected = [
      LIVE_TRACKING_EVENTS.locationUpdate,
      LIVE_TRACKING_EVENTS.trackingStarted,
      LIVE_TRACKING_EVENTS.trackingStopped,
      LIVE_TRACKING_EVENTS.etaUpdate,
      LIVE_TRACKING_EVENTS.stopArrived,
      LIVE_TRACKING_EVENTS.studentAttendance,
    ];
    for (const event of expected) {
      assert.equal(socket.listenerCount(event), 1, `${event} is subscribed`);
    }
    assert.deepEqual([...socket.registrations.keys()].sort(), [...expected].sort());
  });

  it('delivers a student-attendance frame of the same trip to its handler', () => {
    const socket = makeSocket();
    const { calls, handlers } = makeHandlers();
    attachTripRoomEvents(socket, TRIP_A, handlers);

    const frame = {
      trip_id: TRIP_A,
      school_id: 'school-1',
      student_id: 'student-1',
      stop_id: 'stop-1',
      status: TripAttendanceStatus.BOARDED,
      occurred_at: '2026-09-26T06:31:00.000Z',
    };
    socket.emit(LIVE_TRACKING_EVENTS.studentAttendance, frame);

    assert.deepEqual(calls, [{ handler: 'onStudentAttendance', payload: frame }]);
  });

  it('drops every frame carrying a different trip id, or no trip id at all', () => {
    const socket = makeSocket();
    const { calls, handlers } = makeHandlers();
    attachTripRoomEvents(socket, TRIP_A, handlers);

    for (const event of socket.registrations.keys()) {
      socket.emit(event, { trip_id: TRIP_B });
      socket.emit(event, null);
      socket.emit(event, { no_trip_here: true });
    }

    assert.deepEqual(calls, []);
  });

  it('the detacher removes exactly its own listeners — and is idempotent', () => {
    const socket = makeSocket();
    const first = makeHandlers();
    const second = makeHandlers();

    const detachFirst = attachTripRoomEvents(socket, TRIP_A, first.handlers);
    attachTripRoomEvents(socket, TRIP_A, second.handlers);
    assert.equal(socket.listenerCount(LIVE_TRACKING_EVENTS.studentAttendance), 2);

    detachFirst();
    assert.equal(socket.listenerCount(LIVE_TRACKING_EVENTS.studentAttendance), 1);

    socket.emit(LIVE_TRACKING_EVENTS.stopArrived, { trip_id: TRIP_A });
    assert.deepEqual(first.calls, [], 'the detached subscription stays silent');
    assert.equal(second.calls.length, 1, 'the surviving subscription still receives');

    detachFirst();
    assert.equal(socket.listenerCount(LIVE_TRACKING_EVENTS.studentAttendance), 1);
  });
});
