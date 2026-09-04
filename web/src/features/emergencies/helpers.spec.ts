import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  EMERGENCY_EVENTS,
  EMERGENCY_TYPE_LABELS,
  EmergencyStatus,
  EmergencyType,
  LIVE_TRACKING_EVENTS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_TYPE_VALUES,
} from '@school-bus-tracking/shared-types';
import {
  activeAlarmCountLabel,
  alarmDecisionFor,
  alarmStatusHint,
  attachEmergencyAlarm,
  describeEmergencyAlarm,
  isEmergencyAlarmTrigger,
  normalizeEmergencyEvent,
  type AlarmSocket,
  type EmergencyAlarmEvent,
  type EmergencyAlarmSink,
} from './helpers.ts';

/**
 * The alarm policy of the school-admin emergency notification.
 *
 * The one product rule under test: a driver's SOS (`emergency:new`) is the only
 * realtime frame that may make a sound. Every normal notification — above all a
 * parent `notification:new` — must be classified `ignore`, so the siren can
 * never be attached to ordinary traffic.
 */

/** A payload shaped exactly like the gateway's `EmergencyEventResponse`. */
function emergencyPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    school_id: 'school-a',
    trip_id: 'trip-1',
    bus_id: 'bus-1',
    route_id: 'route-1',
    raised_by_user_id: 'driver-1',
    raised_by_name: 'Asha Rane',
    raised_by_role: 'DRIVER',
    type: EmergencyType.ACCIDENT,
    type_label: EMERGENCY_TYPE_LABELS[EmergencyType.ACCIDENT],
    status: EmergencyStatus.OPEN,
    status_label: 'Open',
    message: 'Bus hit a divider — no injuries',
    latitude: 28.6139,
    longitude: 77.209,
    accuracy: 12.5,
    triggered_at: '2026-09-03T08:15:00.000Z',
    acknowledged_at: null,
    acknowledged_by_name: null,
    resolved_at: null,
    resolved_by_name: null,
    resolution_note: null,
    created_at: '2026-09-03T08:15:00.000Z',
    updated_at: '2026-09-03T08:15:00.000Z',
    bus_registration_number: 'BUS-A-1',
    route_name: 'North Loop',
    ...overrides,
  };
}

/** A payload shaped exactly like the gateway's `NotificationRealtimeEvent`. */
function notificationPayload(type: (typeof NOTIFICATION_TYPE_VALUES)[number]) {
  return {
    notification_id: 'notification-1',
    type,
    title: 'Bus on the way',
    message: 'Aarav’s bus departed at 8:10 AM.',
    student_id: 'student-1',
    trip_id: 'trip-1',
    stop_id: null,
    created_at: '2026-09-03T08:10:00.000Z',
  };
}

function recordingSink() {
  const calls: string[] = [];
  const raised: EmergencyAlarmEvent[] = [];
  const silenced: string[] = [];
  const sink: EmergencyAlarmSink = {
    raise(event) {
      calls.push('raise');
      raised.push(event);
    },
    silence(id) {
      calls.push('silence');
      silenced.push(id);
    },
    silenceAll() {
      calls.push('silenceAll');
    },
  };
  return { sink, calls, raised, silenced };
}

/** A stand-in for the shared `/emergencies` socket: records, then replays. */
function fakeSocket() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const registered: string[] = [];
  const removed: string[] = [];
  const socket: AlarmSocket = {
    on(event, handler) {
      registered.push(event);
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
      return socket;
    },
    off(event, handler) {
      removed.push(event);
      handlers.get(event)?.delete(handler);
      return socket;
    },
  };
  return {
    socket,
    registered,
    removed,
    emit(event: string, payload?: unknown) {
      for (const handler of [...(handlers.get(event) ?? [])]) {
        handler(payload);
      }
    },
    listenerCount(event: string) {
      return handlers.get(event)?.size ?? 0;
    },
  };
}

describe('normalizeEmergencyEvent', () => {
  it('reduces a broadcast SOS to what the alarm renders', () => {
    const event = normalizeEmergencyEvent(emergencyPayload());

    assert.ok(event);
    assert.equal(event.id, 'event-1');
    assert.equal(event.status, EmergencyStatus.OPEN);
    assert.equal(event.type, EmergencyType.ACCIDENT);
    assert.equal(event.typeLabel, 'Accident');
    assert.equal(event.raisedByName, 'Asha Rane');
    assert.equal(event.raisedByRole, 'DRIVER');
    assert.equal(event.schoolId, 'school-a');
    assert.equal(event.triggeredAt, '2026-09-03T08:15:00.000Z');
  });

  it('falls back to a generic label when the type is missing or unknown', () => {
    assert.equal(normalizeEmergencyEvent(emergencyPayload({ type: null }))?.typeLabel, 'Emergency');
    assert.equal(normalizeEmergencyEvent(emergencyPayload({ type: 'UFO_LANDING' }))?.type, null);
  });

  it('rejects anything that is not an emergency event', () => {
    for (const payload of [
      null,
      undefined,
      'emergency',
      42,
      [],
      {},
      { id: '' },
      { id: 'event-1' },
      { id: 'event-1', status: 'SOMETHING_ELSE' },
      notificationPayload(NOTIFICATION_TYPE_VALUES[0]),
    ]) {
      assert.equal(normalizeEmergencyEvent(payload), null, JSON.stringify(payload));
    }
  });
});

describe('alarmDecisionFor', () => {
  it('sounds the alarm for a new, open SOS', () => {
    const decision = alarmDecisionFor(EMERGENCY_EVENTS.new, emergencyPayload());

    assert.equal(decision.action, 'sound');
    assert.equal(decision.action === 'sound' && decision.event.id, 'event-1');
    assert.equal(decision.action === 'sound' && decision.event.raisedByName, 'Asha Rane');
  });

  it('ignores a new event that is not open (a stale replay)', () => {
    for (const status of [
      EmergencyStatus.ACKNOWLEDGED,
      EmergencyStatus.RESOLVED,
      EmergencyStatus.CANCELLED,
    ]) {
      assert.equal(
        alarmDecisionFor(EMERGENCY_EVENTS.new, emergencyPayload({ status })).action,
        'ignore',
      );
    }
  });

  it('silences the alarm when the school acknowledges, resolves or cancels', () => {
    for (const status of [
      EmergencyStatus.ACKNOWLEDGED,
      EmergencyStatus.RESOLVED,
      EmergencyStatus.CANCELLED,
    ]) {
      const decision = alarmDecisionFor(EMERGENCY_EVENTS.updated, emergencyPayload({ status }));
      assert.equal(decision.action, 'silence');
      assert.equal(decision.action === 'silence' && decision.id, 'event-1');
    }
  });

  it('lets the siren run through an update that keeps the event open', () => {
    const decision = alarmDecisionFor(
      EMERGENCY_EVENTS.updated,
      emergencyPayload({ status: EmergencyStatus.OPEN }),
    );

    assert.equal(decision.action, 'ignore');
  });

  it('never sounds for a normal parent notification, whatever its type', () => {
    for (const type of NOTIFICATION_TYPE_VALUES) {
      for (const event of [NOTIFICATION_EVENTS.new, 'notification:read', type]) {
        assert.equal(
          alarmDecisionFor(event, notificationPayload(type)).action,
          'ignore',
          `${event}/${type}`,
        );
      }
    }
  });

  it('never sounds for any other realtime frame of the app', () => {
    const events = [
      LIVE_TRACKING_EVENTS.locationUpdate,
      LIVE_TRACKING_EVENTS.stopArrived,
      LIVE_TRACKING_EVENTS.trackingStarted,
      'connect',
      'disconnect',
      'emergency:acknowledged',
      '',
    ];

    for (const event of events) {
      const payload = emergencyPayload();
      assert.equal(alarmDecisionFor(event, payload).action, 'ignore', event);
      assert.equal(isEmergencyAlarmTrigger(event, payload), false, event);
    }
  });

  it('ignores a malformed emergency frame instead of throwing', () => {
    assert.equal(alarmDecisionFor(EMERGENCY_EVENTS.new, undefined).action, 'ignore');
    assert.equal(alarmDecisionFor(EMERGENCY_EVENTS.new, { id: 'event-1' }).action, 'ignore');
    assert.equal(alarmDecisionFor(EMERGENCY_EVENTS.updated, 'nope').action, 'ignore');
  });
});

describe('isEmergencyAlarmTrigger', () => {
  it('is true only for the SOS frame', () => {
    assert.equal(isEmergencyAlarmTrigger(EMERGENCY_EVENTS.new, emergencyPayload()), true);
    assert.equal(
      isEmergencyAlarmTrigger(
        EMERGENCY_EVENTS.new,
        emergencyPayload({ status: EmergencyStatus.RESOLVED }),
      ),
      false,
    );
    assert.equal(
      isEmergencyAlarmTrigger(NOTIFICATION_EVENTS.new, notificationPayload('TRIP_BOARDING')),
      false,
    );
  });
});

describe('attachEmergencyAlarm', () => {
  it('subscribes to the two events the gateway already broadcasts — nothing else', () => {
    const { socket, registered } = fakeSocket();
    const { sink } = recordingSink();

    attachEmergencyAlarm(socket, sink);

    assert.deepEqual(registered, [EMERGENCY_EVENTS.new, EMERGENCY_EVENTS.updated]);
  });

  it('raises on a new SOS and silences once it is acknowledged', () => {
    const { socket, emit } = fakeSocket();
    const { sink, raised, silenced } = recordingSink();

    attachEmergencyAlarm(socket, sink);
    emit(EMERGENCY_EVENTS.new, emergencyPayload());
    assert.equal(raised.length, 1);
    assert.equal(raised[0].id, 'event-1');
    assert.equal(silenced.length, 0);

    emit(EMERGENCY_EVENTS.updated, emergencyPayload({ status: EmergencyStatus.ACKNOWLEDGED }));
    assert.deepEqual(silenced, ['event-1']);
  });

  it('keeps normal notifications silent', () => {
    const { socket, emit } = fakeSocket();
    const { sink, calls } = recordingSink();

    attachEmergencyAlarm(socket, sink);
    emit(NOTIFICATION_EVENTS.new, notificationPayload('STUDENT_BOARDED'));
    emit(LIVE_TRACKING_EVENTS.locationUpdate, { trip_id: 'trip-1' });
    emit(EMERGENCY_EVENTS.updated, emergencyPayload({ status: EmergencyStatus.OPEN }));

    assert.deepEqual(calls, []);
  });

  it('survives a malformed frame without touching the sink', () => {
    const { socket, emit } = fakeSocket();
    const { sink, calls } = recordingSink();

    attachEmergencyAlarm(socket, sink);
    emit(EMERGENCY_EVENTS.new, undefined);
    emit(EMERGENCY_EVENTS.new, { nope: true });

    assert.deepEqual(calls, []);
  });

  it('removes exactly its own listeners and silences the siren on detach', () => {
    const { socket, emit, removed, listenerCount } = fakeSocket();
    const { sink, calls } = recordingSink();
    // Somebody else's handler on the same events — the console's own refresh.
    let otherCalls = 0;
    socket.on(EMERGENCY_EVENTS.new, () => {
      otherCalls += 1;
    });

    const detach = attachEmergencyAlarm(socket, sink);
    emit(EMERGENCY_EVENTS.new, emergencyPayload());
    assert.equal(calls[0], 'raise');

    detach();

    assert.deepEqual(removed, [EMERGENCY_EVENTS.new, EMERGENCY_EVENTS.updated]);
    assert.equal(calls.at(-1), 'silenceAll');
    assert.equal(listenerCount(EMERGENCY_EVENTS.new), 1);

    emit(EMERGENCY_EVENTS.new, emergencyPayload({ id: 'event-2' }));
    assert.equal(otherCalls, 2, 'the console’s own listener keeps working');
  });
});

describe('alarm copy', () => {
  it('names the emergency and who raised it', () => {
    const event = normalizeEmergencyEvent(emergencyPayload());
    assert.ok(event);
    assert.equal(describeEmergencyAlarm(event), 'Accident raised by Asha Rane');
    assert.equal(
      describeEmergencyAlarm({ ...event, raisedByName: null }),
      'Accident raised by a crew member',
    );
  });

  it('counts active emergencies with correct pluralisation', () => {
    assert.equal(activeAlarmCountLabel(1), '1 active emergency');
    assert.equal(activeAlarmCountLabel(3), '3 active emergencies');
  });

  it('explains every alarm state, including the autoplay guard', () => {
    assert.equal(alarmStatusHint('idle'), 'Emergency alarm armed');
    assert.equal(alarmStatusHint('sounding'), 'Emergency alarm sounding');
    assert.equal(alarmStatusHint('blocked'), 'Enable alarm sound');
    assert.equal(alarmStatusHint('muted'), 'Alarm sound muted');
    assert.equal(alarmStatusHint('unavailable'), 'Alarm sound unavailable in this browser');
  });
});
