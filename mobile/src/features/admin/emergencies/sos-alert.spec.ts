import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EMERGENCY_EVENTS, EmergencyStatus } from '@school-bus-tracking/shared-types';
import {
  SOS_ALERT_CONFIG,
  SosAlertLoop,
  buildSosAlertSpeech,
  normalizeSosAlertEvent,
  shouldSosAlertLoopRun,
  sosAlertEnabledForRole,
  sosAlertFrameDecision,
  type SosAlertDrivers,
  type SosAlertEvent,
} from './sos-alert.ts';

/**
 * The admin SOS alert loop — every rule pinned without a device.
 *
 * The module is pure (no `expo-haptics`, no `expo-speech`, no React in its
 * import graph — itself part of the contract), so the whole state machine
 * runs here: the role gate, the frame policy, the spoken line, the cadence,
 * the mute, the foreground gate and the safety cap.
 */

// ------------------------------------------------------------------ harness --

interface FakeTimer {
  id: number;
  at: number;
  handler: () => void;
}

function makeScheduler() {
  let now = 0;
  let nextId = 1;
  const timers: FakeTimer[] = [];
  return {
    scheduler: {
      setTimeout(handler: () => void, milliseconds: number): unknown {
        const timer = { id: nextId++, at: now + milliseconds, handler };
        timers.push(timer);
        return timer.id;
      },
      clearTimeout(handle: unknown): void {
        const index = timers.findIndex((timer) => timer.id === handle);
        if (index !== -1) timers.splice(index, 1);
      },
    },
    /** Advances the clock, firing every timer that came due (chained ones included). */
    advance(ms: number): void {
      const until = now + ms;
      for (;;) {
        const due = timers
          .filter((timer) => timer.at <= until)
          .sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        now = due.at;
        timers.splice(timers.indexOf(due), 1);
        due.handler();
      }
      now = until;
    },
    pending(): number {
      return timers.length;
    },
  };
}

function makeDrivers() {
  const calls = { vibrate: 0, speak: [] as string[], stopSpeaking: 0 };
  const drivers: SosAlertDrivers = {
    vibrate: () => {
      calls.vibrate += 1;
    },
    speak: (text) => {
      calls.speak.push(text);
    },
    stopSpeaking: () => {
      calls.stopSpeaking += 1;
    },
  };
  return { drivers, calls };
}

function makeLoop(options: { config?: Partial<typeof SOS_ALERT_CONFIG> } = {}) {
  const time = makeScheduler();
  const { drivers, calls } = makeDrivers();
  const loop = new SosAlertLoop({ drivers, scheduler: time.scheduler, config: options.config });
  return { loop, calls, time };
}

const EVENT_A: SosAlertEvent = {
  id: 'em-1',
  typeLabel: 'Medical emergency',
  busRegistrationNumber: 'MH-12 AB-3456',
  routeName: 'Palava City',
};

const EVENT_B: SosAlertEvent = {
  id: 'em-2',
  typeLabel: 'Breakdown',
  busRegistrationNumber: 'MH-14 CD-7788',
  routeName: null,
};

function frame(event: Record<string, unknown>) {
  return {
    id: 'em-1',
    status: EmergencyStatus.OPEN,
    type: 'MEDICAL',
    type_label: 'Medical emergency',
    bus_registration_number: 'MH-12 AB-3456',
    route_name: 'Palava City',
    ...event,
  };
}

// ---------------------------------------------------------------- role gate --

describe('the role gate', () => {
  test('only SCHOOL_ADMIN may ever alert', () => {
    assert.equal(sosAlertEnabledForRole('SCHOOL_ADMIN'), true);
    for (const role of ['DRIVER', 'CONDUCTOR', 'PARENT', 'SUPER_ADMIN', null, undefined, '']) {
      assert.equal(sosAlertEnabledForRole(role), false, `${String(role)} stays silent`);
    }
  });
});

// ------------------------------------------------------------------ runtime gate --

describe('shouldSosAlertLoopRun — when the loop runs and when it stops', () => {
  test('runs only while an active SOS exists, foregrounded, unmuted, inside the cap', () => {
    const base = { appActive: true, muted: false, activeCount: 1, withinDurationCap: true };
    assert.equal(shouldSosAlertLoopRun(base), true);
    assert.equal(shouldSosAlertLoopRun({ ...base, activeCount: 0 }), false, 'nothing to report');
    assert.equal(shouldSosAlertLoopRun({ ...base, appActive: false }), false, 'backgrounded');
    assert.equal(shouldSosAlertLoopRun({ ...base, muted: true }), false, 'admin muted it');
    assert.equal(
      shouldSosAlertLoopRun({ ...base, withinDurationCap: false }),
      false,
      'unattended cap reached',
    );
  });
});

// --------------------------------------------------------------- frame policy --

describe('the frame policy', () => {
  test('emergency:new with an OPEN event raises the loop', () => {
    const decision = sosAlertFrameDecision(EMERGENCY_EVENTS.new, frame({}));
    assert.equal(decision.action, 'raise');
    if (decision.action !== 'raise') return;
    assert.equal(decision.event.id, 'em-1');
    assert.equal(decision.event.typeLabel, 'Medical emergency');
    assert.equal(decision.event.busRegistrationNumber, 'MH-12 AB-3456');
    assert.equal(decision.event.routeName, 'Palava City');
  });

  test('emergency:updated away from OPEN silences exactly that event', () => {
    for (const status of [
      EmergencyStatus.ACKNOWLEDGED,
      EmergencyStatus.RESOLVED,
      EmergencyStatus.CANCELLED,
    ]) {
      const decision = sosAlertFrameDecision(EMERGENCY_EVENTS.updated, frame({ status }));
      assert.deepEqual(decision, { action: 'silence', id: 'em-1' }, status);
    }
  });

  test('emergency:updated that keeps OPEN leaves the loop alone', () => {
    assert.deepEqual(sosAlertFrameDecision(EMERGENCY_EVENTS.updated, frame({})), {
      action: 'ignore',
    });
  });

  test('a stale emergency:new (not OPEN) is ignored — a replay must not alert', () => {
    assert.deepEqual(
      sosAlertFrameDecision(EMERGENCY_EVENTS.new, frame({ status: EmergencyStatus.RESOLVED })),
      { action: 'ignore' },
    );
  });

  test('anything else is ignored and can never throw', () => {
    for (const payload of [null, undefined, 42, 'x', {}, { id: 7 }, { id: 'x', status: 'LOUD' }]) {
      assert.deepEqual(sosAlertFrameDecision(EMERGENCY_EVENTS.new, payload), { action: 'ignore' });
    }
    assert.deepEqual(sosAlertFrameDecision('notification:new', frame({})), { action: 'ignore' });
    assert.equal(normalizeSosAlertEvent(null), null);
  });
});

// ------------------------------------------------------------------ the line --

describe('buildSosAlertSpeech', () => {
  test('a single event names the bus, the route and the type', () => {
    assert.equal(
      buildSosAlertSpeech([EVENT_A]),
      'Emergency alert. Bus MH-12 AB-3456, route Palava City, medical emergency. Tap to respond.',
    );
  });

  test('missing bus or route details are omitted, never guessed', () => {
    assert.equal(
      buildSosAlertSpeech([
        { id: 'x', typeLabel: 'Accident', busRegistrationNumber: null, routeName: null },
      ]),
      'Emergency alert. Accident. Tap to respond.',
    );
    assert.equal(
      buildSosAlertSpeech([EVENT_B]),
      'Emergency alert. Bus MH-14 CD-7788, breakdown. Tap to respond.',
    );
  });

  test('several active events lead with the count and the newest detail', () => {
    assert.equal(
      buildSosAlertSpeech([EVENT_A, EVENT_B]),
      '2 active emergencies. Latest: Bus MH-14 CD-7788, breakdown. Tap to respond.',
    );
  });

  test('nothing to report is nothing to say', () => {
    assert.equal(buildSosAlertSpeech([]), '');
  });
});

// ------------------------------------------------------------ the loop itself --

describe('SosAlertLoop', () => {
  test('raise starts the loop: immediate burst + line, then the two cadences', () => {
    const { loop, calls, time } = makeLoop();
    assert.equal(loop.getSnapshot().status, 'idle');

    loop.raise(EVENT_A);
    assert.equal(loop.getSnapshot().status, 'alerting');
    // Immediate feedback — not one cadence later.
    assert.equal(calls.vibrate, 1);
    assert.deepEqual(calls.speak, [buildSosAlertSpeech([EVENT_A])]);

    time.advance(SOS_ALERT_CONFIG.hapticIntervalMs);
    assert.equal(calls.vibrate, 2, 'the haptic cadence fires');
    time.advance(SOS_ALERT_CONFIG.speechIntervalMs - SOS_ALERT_CONFIG.hapticIntervalMs);
    assert.equal(calls.speak.length, 2, 'the speech cadence fires');
  });

  test('the speech cadence stays rare while haptics stay insistent', () => {
    const { loop, calls, time } = makeLoop();
    loop.raise(EVENT_A);

    time.advance(35_000); // 10 haptic ticks, ~3 speech ticks past start
    assert.equal(calls.vibrate, 1 + 10);
    assert.ok(calls.speak.length <= 1 + 4, `speech stayed throttled (${calls.speak.length})`);
  });

  test('a duplicated raise never stacks a second loop', () => {
    const { loop, calls, time } = makeLoop();
    loop.raise(EVENT_A);
    loop.raise(EVENT_A);

    time.advance(35_000);
    assert.equal(calls.vibrate, 1 + 10, 'one haptic timer only');
    assert.equal(loop.getSnapshot().activeCount, 1);
  });

  test('a second SOS joins the count and the line follows the newest', () => {
    const { loop, calls, time } = makeLoop();
    loop.raise(EVENT_A);
    loop.raise(EVENT_B);
    assert.equal(loop.getSnapshot().activeCount, 2);

    time.advance(SOS_ALERT_CONFIG.speechIntervalMs);
    const lastLine = calls.speak[calls.speak.length - 1]!;
    assert.ok(lastLine.startsWith('2 active emergencies.'), lastLine);
  });

  test('acknowledging the only emergency stops the loop the same instant', () => {
    const { loop, calls, time } = makeLoop();
    loop.raise(EVENT_A);
    const vibratedBefore = calls.vibrate;

    loop.silence(EVENT_A.id);
    assert.equal(loop.getSnapshot().status, 'idle');
    time.advance(60_000);
    assert.equal(calls.vibrate, vibratedBefore, 'not one more buzz');
    assert.equal(time.pending(), 0, 'no orphan timers');
  });

  test('acknowledging one of two keeps the other alerting', () => {
    const { loop, time } = makeLoop();
    loop.raise(EVENT_A);
    loop.raise(EVENT_B);

    loop.silence(EVENT_A.id);
    assert.equal(loop.getSnapshot().status, 'alerting');

    loop.silence(EVENT_B.id);
    assert.equal(loop.getSnapshot().status, 'idle');
    time.advance(60_000);
    assert.equal(time.pending(), 0);
  });

  test('mute cuts the loop immediately without touching the incident', () => {
    const { loop, calls, time } = makeLoop();
    loop.raise(EVENT_A);
    const before = calls.vibrate + calls.speak.length;

    loop.setMuted(true);
    const snapshot = loop.getSnapshot();
    assert.equal(snapshot.status, 'muted');
    assert.equal(snapshot.muted, true);
    assert.equal(snapshot.activeCount, 1, 'muted must never hide the emergency');
    assert.equal(calls.stopSpeaking, 1, 'an in-flight line is cut short');
    time.advance(60_000);
    assert.equal(calls.vibrate + calls.speak.length, before, 'total silence while muted');
  });

  test('un-muting re-arms the loop while the SOS is still open', () => {
    const { loop, calls, time } = makeLoop();
    loop.raise(EVENT_A);
    loop.setMuted(true);

    loop.setMuted(false);
    assert.equal(loop.getSnapshot().status, 'alerting');
    time.advance(SOS_ALERT_CONFIG.hapticIntervalMs);
    assert.ok(calls.vibrate >= 2);
  });

  test('the app going to the background stills the loop; foreground resumes it', () => {
    const { loop, calls, time } = makeLoop();
    loop.raise(EVENT_A);
    const before = calls.vibrate + calls.speak.length;

    loop.setAppActive(false);
    assert.equal(loop.getSnapshot().status, 'quiet');
    time.advance(60_000);
    assert.equal(calls.vibrate + calls.speak.length, before, 'background does no work');

    loop.setAppActive(true);
    assert.equal(loop.getSnapshot().status, 'alerting');
    time.advance(SOS_ALERT_CONFIG.hapticIntervalMs);
    assert.ok(calls.vibrate >= 2);
  });

  test('the safety cap quiets an unattended episode; a new SOS re-arms it', () => {
    const { loop, calls, time } = makeLoop();
    loop.raise(EVENT_A);

    time.advance(SOS_ALERT_CONFIG.maxAlertDurationMs);
    assert.equal(loop.getSnapshot().status, 'quiet', 'capped, not endless');
    const before = calls.vibrate + calls.speak.length;
    time.advance(60_000);
    assert.equal(calls.vibrate + calls.speak.length, before, 'stays quiet');
    assert.equal(loop.getSnapshot().activeCount, 1, 'the banner still shows it');

    loop.raise(EVENT_B);
    assert.equal(loop.getSnapshot().status, 'alerting', 'a new emergency earns new noise');
  });

  test('a throwing driver degrades into lastError, never into the socket handler', () => {
    const time = makeScheduler();
    const loop = new SosAlertLoop({
      scheduler: time.scheduler,
      drivers: {
        vibrate: () => {
          throw new Error('no haptic engine');
        },
        speak: () => undefined,
        stopSpeaking: () => undefined,
      },
    });

    loop.raise(EVENT_A);
    assert.equal(loop.getSnapshot().lastError, 'no haptic engine');
    time.advance(60_000); // and the loop carries on reporting, degraded
  });

  test('the snapshot reaches subscribers on every transition', () => {
    const { loop } = makeLoop();
    const seen: string[] = [];
    const unsubscribe = loop.subscribe((snapshot) => seen.push(snapshot.status));

    loop.raise(EVENT_A);
    loop.setMuted(true);
    loop.setMuted(false);
    loop.silence(EVENT_A.id);
    assert.deepEqual(seen, ['alerting', 'muted', 'alerting', 'idle']);

    unsubscribe();
    loop.raise(EVENT_A);
    assert.equal(seen.length, 4, 'unsubscribed listeners hear nothing');
    loop.dispose();
  });
});
