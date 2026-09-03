import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  EMERGENCY_EVENTS,
  NOTIFICATION_EVENTS,
  EmergencyStatus,
  EmergencyType,
} from '@school-bus-tracking/shared-types';
import {
  EMERGENCY_ALARM_BURST_MS,
  EMERGENCY_ALARM_CONFIG,
  EMERGENCY_ALARM_REPEAT_MS,
  EmergencyAlarmPlayer,
  createBrowserAudioContext,
  getEmergencyAlarmPlayer,
  resetEmergencyAlarmPlayer,
  type AlarmAudioContext,
  type AlarmAudioNode,
  type AlarmAudioParam,
  type AlarmCompressorNode,
  type AlarmGainNode,
  type AlarmOscillatorNode,
  type AlarmScheduler,
} from './emergency-alarm.ts';
import { attachEmergencyAlarm } from './helpers.ts';

/**
 * The school-admin emergency siren (Task 44 follow-up).
 *
 * Everything here runs on the Node test runner: the Web Audio graph and the
 * timers are injected, so the whole state machine — synthesis, autoplay
 * queueing, muting, repeat cap, teardown — is asserted without a browser and
 * without waiting for a single real millisecond.
 */

interface ParamEvent {
  kind: 'set' | 'ramp';
  value: number;
  time: number;
}

interface FakeParam extends AlarmAudioParam {
  events: ParamEvent[];
}

interface FakeOscillator extends AlarmOscillatorNode {
  frequency: FakeParam;
  started: number[];
  stopped: number[];
}

interface FakeGain extends AlarmGainNode {
  gain: FakeParam;
}

interface FakeNode extends AlarmAudioNode {
  connectedTo: AlarmAudioNode[];
  disconnects: number;
}

type ResumeOutcome = 'running' | 'stay-suspended' | 'reject';

interface FakeAudioOptions {
  state?: 'suspended' | 'running' | 'closed';
  currentTime?: number;
  onResume?: () => ResumeOutcome;
  failCreateOscillator?: boolean;
}

function fakeParam(initial = 0): FakeParam {
  const events: ParamEvent[] = [];
  const param: FakeParam = {
    value: initial,
    events,
    setValueAtTime(value: number, time: number) {
      events.push({ kind: 'set', value, time });
      return param;
    },
    linearRampToValueAtTime(value: number, time: number) {
      events.push({ kind: 'ramp', value, time });
      return param;
    },
  };
  return param;
}

/** A Web Audio stand-in that records the whole graph it was asked to build. */
function createFakeAudio(options: FakeAudioOptions = {}) {
  let state = options.state ?? 'running';
  const oscillators: Array<FakeOscillator & FakeNode> = [];
  const gains: Array<FakeGain & FakeNode> = [];
  const compressors: Array<AlarmCompressorNode & FakeNode> = [];

  const asNode = <T>(node: T): T & FakeNode =>
    Object.assign(node as T & Partial<FakeNode>, {
      connectedTo: [] as AlarmAudioNode[],
      disconnects: 0,
      connect(destination: AlarmAudioNode) {
        (node as T & FakeNode).connectedTo.push(destination);
        return destination;
      },
      disconnect() {
        (node as T & FakeNode).disconnects += 1;
      },
    }) as T & FakeNode;

  const destination = asNode({ name: 'destination' }) as unknown as AlarmAudioNode & FakeNode;

  const context = {
    get state() {
      return state;
    },
    currentTime: options.currentTime ?? 10,
    destination,
    resumeCalls: 0,
    closeCalls: 0,
    async resume() {
      context.resumeCalls += 1;
      const outcome = options.onResume ? options.onResume() : 'running';
      if (outcome === 'reject') {
        throw new Error('autoplay blocked: needs a user gesture');
      }
      if (outcome === 'running') {
        state = 'running';
      }
    },
    createOscillator() {
      if (options.failCreateOscillator) {
        throw new Error('oscillator allocation failed');
      }
      const oscillator = asNode<FakeOscillator>({
        type: 'sine',
        frequency: fakeParam(440),
        started: [],
        stopped: [],
        start(when?: number) {
          oscillator.started.push(when ?? 0);
        },
        stop(when?: number) {
          oscillator.stopped.push(when ?? 0);
        },
      });
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain() {
      const gain = asNode<FakeGain>({ gain: fakeParam(1) });
      gains.push(gain);
      return gain;
    },
    createDynamicsCompressor() {
      const compressor = asNode<AlarmCompressorNode>({
        threshold: fakeParam(-24),
        knee: fakeParam(30),
        ratio: fakeParam(12),
        attack: fakeParam(0.003),
        release: fakeParam(0.25),
      });
      compressors.push(compressor);
      return compressor;
    },
    async close() {
      context.closeCalls += 1;
      state = 'closed';
    },
  };

  return {
    context: context as unknown as AlarmAudioContext & {
      resumeCalls: number;
      closeCalls: number;
    },
    oscillators,
    gains,
    compressors,
    destination,
    setState(next: 'suspended' | 'running' | 'closed') {
      state = next;
    },
  };
}

interface SchedulerTask {
  id: number;
  at: number;
  handler: () => void;
}

/** Manual clock: `advance()` is the only thing that makes time pass. */
function createFakeScheduler() {
  const tasks: SchedulerTask[] = [];
  const delays: number[] = [];
  let clock = 0;
  let nextId = 1;

  const scheduler: AlarmScheduler & {
    advance(milliseconds: number): void;
    readonly pending: number;
    readonly clock: number;
    readonly delays: number[];
  } = {
    setTimeout(handler, milliseconds) {
      const id = nextId;
      nextId += 1;
      delays.push(milliseconds);
      tasks.push({ id, at: clock + milliseconds, handler });
      return id;
    },
    clearTimeout(handle) {
      const index = tasks.findIndex((task) => task.id === handle);
      if (index >= 0) {
        tasks.splice(index, 1);
      }
    },
    advance(milliseconds) {
      const target = clock + milliseconds;
      for (;;) {
        const due = tasks
          .filter((task) => task.at <= target)
          .sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) {
          break;
        }
        tasks.splice(tasks.indexOf(due), 1);
        clock = Math.max(clock, due.at);
        due.handler();
      }
      clock = target;
    },
    get pending() {
      return tasks.length;
    },
    get clock() {
      return clock;
    },
    delays,
  };
  return scheduler;
}

function harness(options: { audio?: FakeAudioOptions; config?: object } = {}) {
  const scheduler = createFakeScheduler();
  const audio = createFakeAudio(options.audio);
  const player = new EmergencyAlarmPlayer({
    audioContextFactory: () => audio.context,
    scheduler,
    config: options.config as Partial<typeof EMERGENCY_ALARM_CONFIG>,
  });
  return { player, scheduler, audio };
}

/** One SOS as the gateway broadcasts it into the tenant's room. */
function sosPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    school_id: 'school-a',
    raised_by_user_id: 'driver-1',
    raised_by_name: 'Asha Rane',
    raised_by_role: 'DRIVER',
    type: EmergencyType.ACCIDENT,
    status: EmergencyStatus.OPEN,
    message: 'Bus hit a divider',
    triggered_at: '2026-09-03T08:15:00.000Z',
    ...overrides,
  };
}

function alarmEvent(overrides: Record<string, unknown> = {}) {
  const normalized = {
    id: 'event-1',
    status: EmergencyStatus.OPEN,
    type: EmergencyType.ACCIDENT,
    typeLabel: 'Accident',
    raisedByName: 'Asha Rane',
    raisedByRole: 'DRIVER' as const,
    triggeredAt: '2026-09-03T08:15:00.000Z',
    schoolId: 'school-a',
    ...overrides,
  };
  return normalized;
}

/** Lets the queued `resume().then(…)` microtasks settle. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** A stand-in for the shared `/emergencies` socket. */
function fakeSocket() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return {
    on(event: string, handler: (payload: unknown) => void) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
      return this;
    },
    off(event: string, handler: (payload: unknown) => void) {
      handlers.get(event)?.delete(handler);
      return this;
    },
    emit(event: string, payload?: unknown) {
      for (const handler of [...(handlers.get(event) ?? [])]) {
        handler(payload);
      }
    },
  };
}

describe('the emergency siren', () => {
  it('sounds a prominent two-tone burst for a new SOS', () => {
    const { player, scheduler, audio } = harness();

    player.raise(alarmEvent());
    assert.equal(player.getSnapshot().status, 'sounding');
    scheduler.advance(0);

    const beeps = EMERGENCY_ALARM_CONFIG.beepsPerBurst;
    assert.equal(audio.oscillators.length, beeps);
    assert.deepEqual(
      audio.oscillators.map((oscillator) => oscillator.frequency.value),
      Array.from({ length: beeps }, (_, index) =>
        index % 2 === 0
          ? EMERGENCY_ALARM_CONFIG.highFrequencyHz
          : EMERGENCY_ALARM_CONFIG.lowFrequencyHz,
      ),
      'the siren must alternate two tones, not play a single chime',
    );
    assert.ok(
      audio.oscillators.every((oscillator) => oscillator.type === EMERGENCY_ALARM_CONFIG.waveform),
    );
    for (const oscillator of audio.oscillators) {
      assert.equal(oscillator.started.length, 1);
      assert.equal(oscillator.stopped.length, 1);
      assert.ok(
        Math.abs(
          oscillator.stopped[0] - oscillator.started[0] - EMERGENCY_ALARM_CONFIG.beepSeconds,
        ) < 1e-9,
      );
    }

    // Loud, but limited: one shared gain envelope through a compressor.
    assert.equal(audio.gains.length, 1);
    assert.equal(audio.compressors.length, 1);
    assert.ok(audio.gains[0].connectedTo.includes(audio.compressors[0]));
    assert.ok(audio.compressors[0].connectedTo.includes(audio.destination));
    const peaks = audio.gains[0].gain.events.filter(
      (event) => event.value === EMERGENCY_ALARM_CONFIG.peakGain,
    );
    assert.equal(peaks.length, beeps * 2, 'every beep reaches the alarm peak gain');
    assert.ok(EMERGENCY_ALARM_CONFIG.peakGain >= 0.4, 'the alarm must be prominent');
  });

  it('keeps a burst clearly longer than a notification blip', () => {
    assert.ok(EMERGENCY_ALARM_BURST_MS >= 1000, `burst is ${EMERGENCY_ALARM_BURST_MS}ms`);
    assert.ok(EMERGENCY_ALARM_REPEAT_MS > EMERGENCY_ALARM_BURST_MS, 'bursts must never overlap');
  });

  it('repeats while the emergency is still open', () => {
    const { player, scheduler, audio } = harness();

    player.raise(alarmEvent());
    scheduler.advance(0);
    assert.equal(audio.oscillators.length, EMERGENCY_ALARM_CONFIG.beepsPerBurst);
    assert.ok(scheduler.delays.includes(EMERGENCY_ALARM_REPEAT_MS));

    scheduler.advance(EMERGENCY_ALARM_REPEAT_MS);
    assert.equal(audio.oscillators.length, EMERGENCY_ALARM_CONFIG.beepsPerBurst * 2);

    scheduler.advance(EMERGENCY_ALARM_REPEAT_MS);
    assert.equal(audio.oscillators.length, EMERGENCY_ALARM_CONFIG.beepsPerBurst * 3);
  });

  it('stops the moment the school acknowledges the SOS', () => {
    const { player, scheduler, audio } = harness();

    player.raise(alarmEvent());
    scheduler.advance(0);
    const played = audio.oscillators.length;

    player.silence('event-1');

    assert.equal(player.getSnapshot().status, 'idle');
    assert.equal(player.getSnapshot().active.length, 0);
    // The burst in flight is cut off instead of being allowed to finish.
    assert.ok(audio.oscillators.every((oscillator) => oscillator.stopped.includes(0)));
    assert.ok(audio.oscillators.every((oscillator) => oscillator.disconnects >= 1));
    assert.equal(audio.gains[0].disconnects, 1);

    scheduler.advance(EMERGENCY_ALARM_REPEAT_MS * 5);
    assert.equal(audio.oscillators.length, played, 'no further burst may be scheduled');
    assert.equal(scheduler.pending, 0);
  });

  it('keeps sounding for a second SOS raised while the first is open', () => {
    const { player, scheduler, audio } = harness();

    player.raise(alarmEvent());
    scheduler.advance(0);
    player.raise(alarmEvent({ id: 'event-2' }));
    assert.equal(player.getSnapshot().active.length, 2);
    assert.equal(scheduler.pending > 0, true, 'the siren keeps repeating');

    // Handling one of them must not silence the other.
    player.silence('event-1');
    assert.equal(player.getSnapshot().status, 'sounding');
    scheduler.advance(EMERGENCY_ALARM_REPEAT_MS);
    assert.equal(audio.oscillators.length, EMERGENCY_ALARM_CONFIG.beepsPerBurst * 2);

    player.silence('event-2');
    assert.equal(player.getSnapshot().status, 'idle');
  });

  it('never stacks a second siren for the same event id', () => {
    const { player, scheduler, audio } = harness();

    player.raise(alarmEvent());
    player.raise(alarmEvent());
    scheduler.advance(0);

    assert.equal(player.getSnapshot().active.length, 1);
    assert.equal(audio.oscillators.length, EMERGENCY_ALARM_CONFIG.beepsPerBurst);
    assert.equal(audio.gains.length, 1);
  });

  it('gives up after the configured number of bursts', () => {
    const { player, scheduler, audio } = harness({ config: { maxBursts: 3 } });

    player.raise(alarmEvent());
    scheduler.advance(EMERGENCY_ALARM_REPEAT_MS * 10);

    assert.equal(audio.oscillators.length, EMERGENCY_ALARM_CONFIG.beepsPerBurst * 3);
    assert.equal(player.getSnapshot().status, 'sounding', 'the emergency is still open');
  });

  it('releases the finished nodes of every burst', () => {
    const { player, scheduler, audio } = harness();

    player.raise(alarmEvent());
    scheduler.advance(EMERGENCY_ALARM_BURST_MS + 400);

    assert.equal(audio.oscillators[0].disconnects, 1);
    assert.equal(audio.gains[0].disconnects, 1);
    player.silence('event-1');
    assert.equal(scheduler.pending, 0);
  });
});

describe('browser autoplay policy', () => {
  it('queues a blocked alarm and plays it on the first user gesture', async () => {
    let mayResume = false;
    const { player, scheduler, audio } = harness({
      audio: {
        state: 'suspended',
        onResume: () => (mayResume ? 'running' : 'stay-suspended'),
      },
    });

    player.raise(alarmEvent());
    await tick();

    const blocked = player.getSnapshot();
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.pendingCount, 1, 'the alarm is queued, not dropped');
    assert.equal(blocked.active.length, 1, 'the indicator still shows the SOS');
    assert.equal(blocked.unlocked, false);
    assert.equal(audio.oscillators.length, 0);

    // The admin clicks somewhere — the shell calls unlock() from that gesture.
    mayResume = true;
    assert.equal(await player.unlock(), true);

    const sounding = player.getSnapshot();
    assert.equal(sounding.status, 'sounding');
    assert.equal(sounding.unlocked, true);
    assert.equal(sounding.pendingCount, 0);
    scheduler.advance(0);
    assert.equal(audio.oscillators.length, EMERGENCY_ALARM_CONFIG.beepsPerBurst);
  });

  it('plays immediately when the browser resumes without a gesture', async () => {
    const { player, scheduler, audio } = harness({ audio: { state: 'suspended' } });

    player.raise(alarmEvent());
    await tick();

    assert.equal(player.getSnapshot().status, 'sounding');
    scheduler.advance(0);
    assert.equal(audio.oscillators.length, EMERGENCY_ALARM_CONFIG.beepsPerBurst);
  });

  it('reports a rejected resume instead of failing silently', async () => {
    const { player, audio } = harness({
      audio: { state: 'suspended', onResume: () => 'reject' },
    });

    player.raise(alarmEvent());
    await tick();

    const snapshot = player.getSnapshot();
    assert.equal(snapshot.status, 'blocked');
    assert.equal(snapshot.pendingCount, 1);
    assert.match(snapshot.lastError ?? '', /autoplay blocked/);
    assert.equal(audio.oscillators.length, 0);
    assert.equal(audio.context.resumeCalls, 1);
  });

  it('does not re-resume a context that is already running', async () => {
    const { player, audio } = harness();

    await player.unlock();
    await player.unlock();

    assert.equal(audio.context.resumeCalls, 0);
    assert.equal(player.getSnapshot().unlocked, true);
  });
});

describe('degradation — the notification must survive the audio', () => {
  it('stays usable without a Web Audio API', async () => {
    const scheduler = createFakeScheduler();
    const player = new EmergencyAlarmPlayer({
      audioContextFactory: () => null,
      scheduler,
    });

    player.raise(alarmEvent());

    const snapshot = player.getSnapshot();
    assert.equal(snapshot.status, 'unavailable');
    assert.equal(snapshot.active.length, 1, 'the visual alarm still reports the SOS');
    assert.equal(snapshot.pendingCount, 0);
    assert.match(snapshot.lastError ?? '', /Web Audio/);
    assert.equal(await player.unlock(), false);
    assert.equal(scheduler.pending, 0);
  });

  it('contains a factory that throws', () => {
    const player = new EmergencyAlarmPlayer({
      audioContextFactory: () => {
        throw new Error('context creation refused');
      },
      scheduler: createFakeScheduler(),
    });

    assert.doesNotThrow(() => player.raise(alarmEvent()));
    assert.equal(player.getSnapshot().status, 'unavailable');
    assert.equal(player.getSnapshot().lastError, 'context creation refused');
  });

  it('contains a failure inside the audio graph and stops trying', () => {
    const { player, scheduler, audio } = harness({
      audio: { failCreateOscillator: true },
    });

    player.raise(alarmEvent());
    assert.doesNotThrow(() => scheduler.advance(0));

    const snapshot = player.getSnapshot();
    assert.equal(snapshot.status, 'unavailable');
    assert.equal(snapshot.lastError, 'oscillator allocation failed');
    assert.equal(snapshot.active.length, 1);

    const gains = audio.gains.length;
    scheduler.advance(EMERGENCY_ALARM_REPEAT_MS * 5);
    assert.equal(audio.gains.length, gains, 'no further burst is attempted');
    assert.equal(audio.oscillators.length, 0);
  });

  it('returns no audio context outside a browser', () => {
    // The Node test runner has no `window`; the factory must say so quietly.
    assert.equal(createBrowserAudioContext(), null);
  });

  it('keeps a throwing subscriber from breaking the alarm', () => {
    const { player, scheduler, audio } = harness();
    const seen: string[] = [];

    player.subscribe(() => {
      throw new Error('subscriber blew up');
    });
    player.subscribe((snapshot) => seen.push(snapshot.status));

    assert.doesNotThrow(() => player.raise(alarmEvent()));
    scheduler.advance(0);

    assert.ok(seen.includes('sounding'));
    assert.equal(audio.oscillators.length, EMERGENCY_ALARM_CONFIG.beepsPerBurst);
  });
});

describe('muting', () => {
  it('is silent while muted but keeps the emergency visible', () => {
    const { player, scheduler, audio } = harness();

    player.setMuted(true);
    player.raise(alarmEvent());
    scheduler.advance(EMERGENCY_ALARM_REPEAT_MS * 2);

    assert.equal(player.getSnapshot().status, 'muted');
    assert.equal(player.getSnapshot().muted, true);
    assert.equal(player.getSnapshot().active.length, 1);
    assert.equal(audio.oscillators.length, 0);
    assert.equal(audio.gains.length, 0);
  });

  it('starts the siren when an open emergency is unmuted', () => {
    const { player, scheduler, audio } = harness();

    player.setMuted(true);
    player.raise(alarmEvent());
    player.setMuted(false);

    assert.equal(player.getSnapshot().status, 'sounding');
    scheduler.advance(0);
    assert.equal(audio.oscillators.length, EMERGENCY_ALARM_CONFIG.beepsPerBurst);
  });

  it('cuts a running siren off at once', () => {
    const { player, scheduler, audio } = harness();

    player.raise(alarmEvent());
    scheduler.advance(0);
    player.setMuted(true);

    assert.ok(audio.oscillators.every((oscillator) => oscillator.disconnects >= 1));
    const played = audio.oscillators.length;
    scheduler.advance(EMERGENCY_ALARM_REPEAT_MS * 3);
    assert.equal(audio.oscillators.length, played);
    assert.equal(player.getSnapshot().status, 'muted');
  });

  it('ignores a redundant mute change', () => {
    const { player } = harness();
    const snapshots: string[] = [];
    player.subscribe((snapshot) => snapshots.push(snapshot.status));

    player.setMuted(false);

    assert.deepEqual(snapshots, []);
  });
});

describe('teardown', () => {
  it('silences everything and closes the context on dispose', async () => {
    const { player, scheduler, audio } = harness();

    player.raise(alarmEvent());
    scheduler.advance(0);
    player.dispose();
    await tick();

    assert.equal(player.getSnapshot().status, 'idle');
    assert.equal(player.getSnapshot().active.length, 0);
    assert.equal(scheduler.pending, 0);
    assert.equal(audio.context.closeCalls, 1);
  });

  it('stops every alarm on silenceAll', () => {
    const { player, scheduler, audio } = harness();

    player.raise(alarmEvent());
    player.raise(alarmEvent({ id: 'event-2' }));
    scheduler.advance(0);
    player.silenceAll();

    assert.equal(player.getSnapshot().active.length, 0);
    assert.equal(player.getSnapshot().status, 'idle');
    scheduler.advance(EMERGENCY_ALARM_REPEAT_MS * 3);
    assert.equal(audio.oscillators.length, EMERGENCY_ALARM_CONFIG.beepsPerBurst);
  });
});

describe('the tab-wide player', () => {
  it('is a singleton until it is reset', () => {
    const first = getEmergencyAlarmPlayer();

    assert.equal(getEmergencyAlarmPlayer(), first);
    resetEmergencyAlarmPlayer();
    assert.notEqual(getEmergencyAlarmPlayer(), first);
    resetEmergencyAlarmPlayer();
  });
});

describe('the socket feed drives the siren', () => {
  it('sounds for emergency:new only, and stops on the status change', () => {
    const { player, scheduler, audio } = harness();
    const socket = fakeSocket();
    attachEmergencyAlarm(socket, player);

    socket.emit(EMERGENCY_EVENTS.new, sosPayload());
    assert.equal(player.getSnapshot().status, 'sounding');
    scheduler.advance(0);
    assert.equal(audio.oscillators.length, EMERGENCY_ALARM_CONFIG.beepsPerBurst);

    // A normal notification crosses the same shell — it must add no sound.
    socket.emit(NOTIFICATION_EVENTS.new, {
      notification_id: 'notification-1',
      type: 'STUDENT_BOARDED',
      title: 'Boarded',
      message: 'Aarav boarded the bus.',
      student_id: 'student-1',
      trip_id: 'trip-1',
      stop_id: null,
      created_at: '2026-09-03T08:16:00.000Z',
    });
    scheduler.advance(EMERGENCY_ALARM_REPEAT_MS);
    assert.equal(
      audio.oscillators.length,
      EMERGENCY_ALARM_CONFIG.beepsPerBurst * 2,
      'only the emergency repeats',
    );

    socket.emit(
      EMERGENCY_EVENTS.updated,
      sosPayload({ status: EmergencyStatus.ACKNOWLEDGED, acknowledged_at: '2026-09-03T08:20:00Z' }),
    );
    assert.equal(player.getSnapshot().status, 'idle');
    const played = audio.oscillators.length;
    scheduler.advance(EMERGENCY_ALARM_REPEAT_MS * 5);
    assert.equal(audio.oscillators.length, played);
  });

  it('is silenced when the shell detaches (sign-out, role change)', () => {
    const { player, scheduler, audio } = harness();
    const socket = fakeSocket();
    const detach = attachEmergencyAlarm(socket, player);

    socket.emit(EMERGENCY_EVENTS.new, sosPayload());
    scheduler.advance(0);
    detach();

    assert.equal(player.getSnapshot().status, 'idle');
    assert.ok(audio.oscillators.every((oscillator) => oscillator.disconnects >= 1));
    scheduler.advance(EMERGENCY_ALARM_REPEAT_MS * 3);
    assert.equal(audio.oscillators.length, EMERGENCY_ALARM_CONFIG.beepsPerBurst);
  });
});
